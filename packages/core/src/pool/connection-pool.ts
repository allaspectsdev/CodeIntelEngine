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

interface QueuedWaiter {
  resolve: (conn: PooledConnection) => void;
  reject: (err: Error) => void;
}

export class ConnectionPool extends EventEmitter {
  private readonly dbPath: string;
  private readonly opts: PoolOptions;
  private connections: PooledConnection[] = [];
  private waitQueue: QueuedWaiter[] = [];
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
    return new Promise<Database.Database>((resolve, reject) => {
      this.waitQueue.push({
        resolve: (conn) => {
          resolve(conn.db);
        },
        reject,
      });
    });
  }

  release(db: Database.Database): void {
    const conn = this.connections.find((c) => c.db === db);
    if (!conn) return;

    // Serve any waiting callers first — mark in-use BEFORE handing off
    if (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift()!;
      conn.inUse = true;
      conn.lastUsed = Date.now();
      waiter.resolve(conn);
    } else {
      conn.inUse = false;
      conn.lastUsed = Date.now();
    }
  }

  private sweepIdle(): void {
    const now = Date.now();
    let keptOne = false;
    this.connections = this.connections.filter((conn) => {
      if (conn.inUse) return true;
      if (now - conn.lastUsed > this.opts.idleTimeoutMs && keptOne) {
        conn.db.close();
        return false;
      }
      keptOne = true;
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
    // Reject all waiting acquire() callers so they don't hang forever
    const closeError = new Error("Pool is closed");
    for (const waiter of this.waitQueue) {
      waiter.reject(closeError);
    }
    this.waitQueue = [];
    for (const conn of this.connections) {
      conn.db.close();
    }
    this.connections = [];
  }
}
