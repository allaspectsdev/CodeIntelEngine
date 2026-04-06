import type Database from "better-sqlite3";
import { ConnectionPool } from "../pool/connection-pool.js";
import { runMigrations } from "./migrations.js";
import type {
  GraphNode,
  GraphEdge,
  GraphMutation,
  NodeKind,
  EdgeKind,
  Community,
  Process,
  QueryResult,
} from "../types.js";

export interface GraphStoreOptions {
  maxConnections?: number;
}

export interface Transaction {
  query<T>(sql: string, params?: Record<string, unknown>): T[];
  run(sql: string, params?: Record<string, unknown>): void;
  getNode(id: string): GraphNode | null;
  getEdge(id: string): GraphEdge | null;
  mutate(operations: GraphMutation[]): void;
}

export class GraphStore {
  private pool: ConnectionPool;
  private initialized = false;

  constructor(dbPath: string, opts?: GraphStoreOptions) {
    this.pool = new ConnectionPool(dbPath, {
      maxConnections: opts?.maxConnections ?? 8,
    });
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    const db = await this.pool.acquire();
    try {
      runMigrations(db);
      this.initialized = true;
    } finally {
      this.pool.release(db);
    }
  }

  async query<T>(sql: string, params?: Record<string, unknown>): Promise<T[]> {
    const db = await this.pool.acquire();
    try {
      const stmt = db.prepare(sql);
      return (params ? stmt.all(params) : stmt.all()) as T[];
    } finally {
      this.pool.release(db);
    }
  }

  async run(sql: string, params?: Record<string, unknown>): Promise<void> {
    const db = await this.pool.acquire();
    try {
      const stmt = db.prepare(sql);
      params ? stmt.run(params) : stmt.run();
    } finally {
      this.pool.release(db);
    }
  }

  async mutate(operations: GraphMutation[]): Promise<void> {
    const db = await this.pool.acquire();
    try {
      const tx = db.transaction(() => {
        for (const op of operations) {
          this.applyMutation(db, op);
        }
      });
      tx();
    } finally {
      this.pool.release(db);
    }
  }

  /**
   * Run a synchronous transaction. The callback receives a Transaction
   * object with synchronous query/run/mutate methods. better-sqlite3
   * transactions are inherently synchronous — use mutate() for async
   * batched writes instead.
   */
  async transaction<T>(fn: (tx: Transaction) => T): Promise<T> {
    const db = await this.pool.acquire();
    try {
      let result: T;
      const sqliteTx = db.transaction(() => {
        const tx: Transaction = {
          query: <R>(sql: string, params?: Record<string, unknown>) => {
            const stmt = db.prepare(sql);
            return (params ? stmt.all(params) : stmt.all()) as R[];
          },
          run: (sql: string, params?: Record<string, unknown>) => {
            const stmt = db.prepare(sql);
            params ? stmt.run(params) : stmt.run();
          },
          getNode: (id: string) => this.rowToNode(
            db.prepare("SELECT * FROM nodes WHERE id = ?").get(id) as NodeRow | undefined
          ),
          getEdge: (id: string) => this.rowToEdge(
            db.prepare("SELECT * FROM edges WHERE id = ?").get(id) as EdgeRow | undefined
          ),
          mutate: (ops: GraphMutation[]) => {
            for (const op of ops) {
              this.applyMutation(db, op);
            }
          },
        };
        result = fn(tx);
      });
      sqliteTx();
      return result!;
    } finally {
      this.pool.release(db);
    }
  }

  // ── Node operations ─────────────────────────────────

  async getNode(id: string): Promise<GraphNode | null> {
    const db = await this.pool.acquire();
    try {
      const row = db.prepare("SELECT * FROM nodes WHERE id = ?").get(id) as NodeRow | undefined;
      return this.rowToNode(row);
    } finally {
      this.pool.release(db);
    }
  }

  async getNodesByFile(filePath: string): Promise<GraphNode[]> {
    const db = await this.pool.acquire();
    try {
      const rows = db.prepare("SELECT * FROM nodes WHERE file_path = ?").all(filePath) as NodeRow[];
      return rows.map((r) => this.rowToNode(r)!);
    } finally {
      this.pool.release(db);
    }
  }

  async getNodesByKind(kind: NodeKind): Promise<GraphNode[]> {
    const db = await this.pool.acquire();
    try {
      const rows = db.prepare("SELECT * FROM nodes WHERE kind = ?").all(kind) as NodeRow[];
      return rows.map((r) => this.rowToNode(r)!);
    } finally {
      this.pool.release(db);
    }
  }

  async getNodeCount(): Promise<number> {
    const rows = await this.query<{ count: number }>("SELECT count(*) as count FROM nodes");
    return rows[0]?.count ?? 0;
  }

  // ── Edge operations ─────────────────────────────────

  async getEdge(id: string): Promise<GraphEdge | null> {
    const db = await this.pool.acquire();
    try {
      const row = db.prepare("SELECT * FROM edges WHERE id = ?").get(id) as EdgeRow | undefined;
      return this.rowToEdge(row);
    } finally {
      this.pool.release(db);
    }
  }

  async getEdgesFrom(source: string, kind?: EdgeKind): Promise<GraphEdge[]> {
    const db = await this.pool.acquire();
    try {
      const sql = kind
        ? "SELECT * FROM edges WHERE source = ? AND kind = ?"
        : "SELECT * FROM edges WHERE source = ?";
      const rows = (kind
        ? db.prepare(sql).all(source, kind)
        : db.prepare(sql).all(source)) as EdgeRow[];
      return rows.map((r) => this.rowToEdge(r)!);
    } finally {
      this.pool.release(db);
    }
  }

  async getEdgesTo(target: string, kind?: EdgeKind): Promise<GraphEdge[]> {
    const db = await this.pool.acquire();
    try {
      const sql = kind
        ? "SELECT * FROM edges WHERE target = ? AND kind = ?"
        : "SELECT * FROM edges WHERE target = ?";
      const rows = (kind
        ? db.prepare(sql).all(target, kind)
        : db.prepare(sql).all(target)) as EdgeRow[];
      return rows.map((r) => this.rowToEdge(r)!);
    } finally {
      this.pool.release(db);
    }
  }

  async getEdgeCount(): Promise<number> {
    const rows = await this.query<{ count: number }>("SELECT count(*) as count FROM edges");
    return rows[0]?.count ?? 0;
  }

  // ── Community operations ────────────────────────────

  async upsertCommunity(community: Community): Promise<void> {
    await this.run(
      `INSERT OR REPLACE INTO communities (id, label, member_count, cohesion)
       VALUES (@id, @label, @memberCount, @cohesion)`,
      community as unknown as Record<string, unknown>
    );
  }

  async getCommunities(): Promise<Community[]> {
    return this.query<Community>(
      "SELECT id, label, member_count as memberCount, cohesion FROM communities"
    );
  }

  // ── Process operations ──────────────────────────────

  async upsertProcess(process: Process): Promise<void> {
    await this.run(
      `INSERT OR REPLACE INTO processes (id, name, entry_point, steps, kind)
       VALUES (@id, @name, @entryPoint, @steps, @kind)`,
      {
        ...process,
        steps: JSON.stringify(process.steps),
      } as unknown as Record<string, unknown>
    );
  }

  async getProcesses(): Promise<Process[]> {
    const rows = await this.query<{
      id: string; name: string; entry_point: string; steps: string; kind: string;
    }>("SELECT * FROM processes");
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      entryPoint: r.entry_point,
      steps: JSON.parse(r.steps) as string[],
      kind: r.kind as Process["kind"],
    }));
  }

  // ── Full-text search ────────────────────────────────

  async searchNodes(
    queryText: string,
    opts?: { limit?: number; kind?: NodeKind }
  ): Promise<QueryResult<GraphNode & { rank: number }>> {
    const start = performance.now();
    const db = await this.pool.acquire();
    try {
      let sql = `
        SELECT nodes.*, nodes_fts.rank
        FROM nodes_fts
        JOIN nodes ON nodes.rowid = nodes_fts.rowid
        WHERE nodes_fts MATCH ?
      `;
      const params: unknown[] = [queryText];

      if (opts?.kind) {
        sql += " AND nodes.kind = ?";
        params.push(opts.kind);
      }

      sql += " ORDER BY nodes_fts.rank LIMIT ?";
      params.push(opts?.limit ?? 50);

      const rows = db.prepare(sql).all(...params) as (NodeRow & { rank: number })[];
      const items = rows.map((r) => ({
        ...this.rowToNode(r)!,
        rank: r.rank,
      }));

      return {
        items,
        totalCount: items.length,
        queryTimeMs: performance.now() - start,
      };
    } finally {
      this.pool.release(db);
    }
  }

  // ── Graph traversal helpers ─────────────────────────

  /**
   * Find neighbors of a node using a recursive CTE — single SQL round-trip
   * instead of N+1 queries per depth level.
   */
  async getNeighbors(
    nodeId: string,
    opts?: { direction?: "in" | "out" | "both"; kinds?: EdgeKind[]; maxDepth?: number }
  ): Promise<GraphNode[]> {
    const direction = opts?.direction ?? "both";
    const maxDepth = Math.min(opts?.maxDepth ?? 1, 10);
    const db = await this.pool.acquire();
    try {
      // Build the edge traversal clause based on direction
      let edgeJoin: string;
      if (direction === "out") {
        edgeJoin = "JOIN edges e ON e.source = t.node_id";
      } else if (direction === "in") {
        edgeJoin = "JOIN edges e ON e.target = t.node_id";
      } else {
        edgeJoin = "JOIN edges e ON e.source = t.node_id OR e.target = t.node_id";
      }

      // Build kind filter
      let kindFilter = "";
      if (opts?.kinds && opts.kinds.length > 0) {
        const kindList = opts.kinds.map((k) => `'${k}'`).join(",");
        kindFilter = `AND e.kind IN (${kindList})`;
      }

      // Next-node expression depends on direction
      let nextNode: string;
      if (direction === "out") {
        nextNode = "e.target";
      } else if (direction === "in") {
        nextNode = "e.source";
      } else {
        nextNode = "CASE WHEN e.source = t.node_id THEN e.target ELSE e.source END";
      }

      const sql = `
        WITH RECURSIVE traverse(node_id, depth) AS (
          SELECT @startId, 0
          UNION
          SELECT ${nextNode}, t.depth + 1
          FROM traverse t
          ${edgeJoin} ${kindFilter}
          WHERE t.depth < @maxDepth
        )
        SELECT DISTINCT n.*
        FROM traverse tr
        JOIN nodes n ON n.id = tr.node_id
        WHERE tr.node_id != @startId
      `;

      const rows = db.prepare(sql).all({
        startId: nodeId,
        maxDepth,
      }) as NodeRow[];

      return rows.map((r) => this.rowToNode(r)!);
    } finally {
      this.pool.release(db);
    }
  }

  // ── Lifecycle ───────────────────────────────────────

  async close(): Promise<void> {
    await this.pool.close();
  }

  // ── Private helpers ─────────────────────────────────

  private applyMutation(db: Database.Database, op: GraphMutation): void {
    switch (op.op) {
      case "upsert_node": {
        const n = op.node;
        db.prepare(`
          INSERT OR REPLACE INTO nodes
            (id, kind, name, file_path, start_line, end_line, content_hash, language,
             signature, docstring, exported, last_indexed, community_id, page_rank, embedding, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          n.id, n.kind, n.name, n.filePath, n.startLine, n.endLine,
          n.contentHash, n.language, n.signature ?? null, n.docstring ?? null,
          n.exported ? 1 : 0, n.lastIndexed, n.communityId ?? null,
          n.pageRank ?? 0, n.embedding ? Buffer.from(n.embedding.buffer) : null,
          n.metadata ? JSON.stringify(n.metadata) : null
        );
        break;
      }
      case "delete_node":
        db.prepare("DELETE FROM nodes WHERE id = ?").run(op.id);
        break;
      case "upsert_edge": {
        const e = op.edge;
        db.prepare(`
          INSERT OR REPLACE INTO edges (id, source, target, kind, confidence, file_path, line, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          e.id, e.source, e.target, e.kind, e.confidence,
          e.filePath ?? null, e.line ?? null,
          e.metadata ? JSON.stringify(e.metadata) : null
        );
        break;
      }
      case "delete_edge":
        db.prepare("DELETE FROM edges WHERE id = ?").run(op.id);
        break;
      case "delete_edges_from":
        if (op.kind) {
          db.prepare("DELETE FROM edges WHERE source = ? AND kind = ?").run(op.source, op.kind);
        } else {
          db.prepare("DELETE FROM edges WHERE source = ?").run(op.source);
        }
        break;
      case "delete_file_nodes":
        db.prepare("DELETE FROM nodes WHERE file_path = ?").run(op.filePath);
        break;
    }
  }

  private rowToNode(row: NodeRow | undefined): GraphNode | null {
    if (!row) return null;
    return {
      id: row.id,
      kind: row.kind as NodeKind,
      name: row.name,
      filePath: row.file_path,
      startLine: row.start_line,
      endLine: row.end_line,
      contentHash: row.content_hash,
      language: row.language,
      signature: row.signature ?? undefined,
      docstring: row.docstring ?? undefined,
      exported: row.exported === 1,
      lastIndexed: row.last_indexed,
      communityId: row.community_id ?? undefined,
      pageRank: row.page_rank ?? undefined,
      embedding: row.embedding
        ? new Float64Array(
            row.embedding instanceof Buffer
              ? row.embedding.buffer.slice(
                  row.embedding.byteOffset,
                  row.embedding.byteOffset + row.embedding.byteLength
                )
              : row.embedding as ArrayBuffer
          )
        : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  private rowToEdge(row: EdgeRow | undefined): GraphEdge | null {
    if (!row) return null;
    return {
      id: row.id,
      source: row.source,
      target: row.target,
      kind: row.kind as EdgeKind,
      confidence: row.confidence,
      filePath: row.file_path ?? undefined,
      line: row.line ?? undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }
}

// ── Row types (DB shape) ──────────────────────────────

interface NodeRow {
  id: string;
  kind: string;
  name: string;
  file_path: string;
  start_line: number;
  end_line: number;
  content_hash: string;
  language: string;
  signature: string | null;
  docstring: string | null;
  exported: number;
  last_indexed: number;
  community_id: number | null;
  page_rank: number | null;
  embedding: Buffer | ArrayBuffer | null;
  metadata: string | null;
}

interface EdgeRow {
  id: string;
  source: string;
  target: string;
  kind: string;
  confidence: number;
  file_path: string | null;
  line: number | null;
  metadata: string | null;
}
