import Database from "better-sqlite3";
import { EventEmitter } from "node:events";

export interface PoolOptions {
  maxConnections: number;
  idleTimeoutMs: number;
  walMode: boolean;
}

const DEFAULT_OPTS: PoolOptions = {
  maxConnections: 8,
  idleTimeoutMs: 30_000,
  walMode: true,
};

interface PooledConnection {
  db: Database.Database;
  lastUsed: number;
  inUse: boolean;
}

export class ConnectionPool extends EventEmitter {
  private readonly dbPath: string;
  private readonly opts: PoolOptions;
  private connections: PooledConnection[] = [];
  private waitQueue: Array<(conn: PooledConnection) => void> = [];
  private closed = false;
  private sweepInterval: ReturnType<typeof setInterval> | null = null;

  constructor(dbPath: string, opts?: Partial<PoolOptions>) {
    super();
    this.dbPath = dbPath;
    this.opts = { ...DEFAULT_OPTS, ...opts };
    this.sweepInterval = setInterval(() => this.sweepIdle(), this.opts.idleTimeoutMs);
  }

  private createConnection(): PooledConnection {
    const db = new Database(this.dbPath);
    if (this.opts.walMode) {
      db.pragma("journal_mode = WAL");
    }
    db.pragma("busy_timeout = 5000");
    db.pragma("foreign_keys = ON");
    return { db, lastUsed: Date.now(), inUse: false };
  }

  async acquire(): Promise<Database.Database> {
    if (this.closed) throw new Error("Pool is closed");

    // Try to find an idle connection
    const idle = this.connections.find((c) => !c.inUse);
    if (idle) {
      idle.inUse = true;
      idle.lastUsed = Date.now();
      return idle.db;
    }

    // Create a new one if under limit
    if (this.connections.length < this.opts.maxConnections) {
      const conn = this.createConnection();
      conn.inUse = true;
      this.connections.push(conn);
      return conn.db;
    }

    // Wait for one to become available
    return new Promise<Database.Database>((resolve) => {
      this.waitQueue.push((conn) => {
        conn.inUse = true;
        conn.lastUsed = Date.now();
        resolve(conn.db);
      });
    });
  }

  release(db: Database.Database): void {
    const conn = this.connections.find((c) => c.db === db);
    if (!conn) return;

    conn.inUse = false;
    conn.lastUsed = Date.now();

    // Serve any waiting callers
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      next(conn);
    }
  }

  private sweepIdle(): void {
    const now = Date.now();
    // Keep at least one connection alive
    this.connections = this.connections.filter((conn, i) => {
      if (conn.inUse) return true;
      if (i === 0) return true; // keep at least one
      if (now - conn.lastUsed > this.opts.idleTimeoutMs) {
        conn.db.close();
        return false;
      }
      return true;
    });
  }

  get size(): number {
    return this.connections.length;
  }

  get activeCount(): number {
    return this.connections.filter((c) => c.inUse).length;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }
    for (const conn of this.connections) {
      conn.db.close();
    }
    this.connections = [];
    this.waitQueue = [];
  }
}
