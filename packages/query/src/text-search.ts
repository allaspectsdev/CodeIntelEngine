import type { GraphStore, GraphNode, NodeKind, QueryResult } from "@codeintel/core";

export interface TextSearchOptions {
  limit?: number;
  kind?: NodeKind;
  filePath?: string;
  bm25?: boolean;
  vector?: boolean;
}

export interface ScoredNode extends GraphNode {
  textScore: number;
  bm25Score?: number;
  vectorScore?: number;
}

/**
 * Hybrid text search combining BM25 (via FTS5) and optional vector similarity.
 *
 * BM25 is always available through SQLite FTS5. Vector search requires
 * pre-computed embeddings stored on nodes.
 */
export class TextSearch {
  constructor(private store: GraphStore) {}

  async search(
    queryText: string,
    opts?: TextSearchOptions
  ): Promise<QueryResult<ScoredNode>> {
    const start = performance.now();
    const limit = opts?.limit ?? 50;
    const useBM25 = opts?.bm25 !== false;
    const useVector = opts?.vector === true;

    let bm25Results: ScoredNode[] = [];
    let vectorResults: ScoredNode[] = [];

    if (useBM25) {
      bm25Results = await this.bm25Search(queryText, limit * 2, opts?.kind, opts?.filePath);
    }

    if (useVector) {
      vectorResults = await this.vectorSearch(queryText, limit * 2, opts?.kind);
    }

    // Merge results
    let results: ScoredNode[];
    if (useBM25 && useVector) {
      results = this.mergeResults(bm25Results, vectorResults, limit);
    } else if (useBM25) {
      results = bm25Results.slice(0, limit);
    } else {
      results = vectorResults.slice(0, limit);
    }

    return {
      items: results,
      totalCount: results.length,
      queryTimeMs: performance.now() - start,
    };
  }

  private async bm25Search(
    query: string,
    limit: number,
    kind?: NodeKind,
    filePath?: string
  ): Promise<ScoredNode[]> {
    // FTS5 query — sanitize for safety
    const ftsQuery = sanitizeFtsQuery(query);
    if (!ftsQuery) return [];

    let sql = `
      SELECT nodes.*, -nodes_fts.rank as bm25_score
      FROM nodes_fts
      JOIN nodes ON nodes.rowid = nodes_fts.rowid
      WHERE nodes_fts MATCH @query
    `;
    const params: Record<string, unknown> = { query: ftsQuery };

    if (kind) {
      sql += " AND nodes.kind = @kind";
      params.kind = kind;
    }
    if (filePath) {
      sql += " AND nodes.file_path LIKE @filePath";
      params.filePath = `${filePath}%`;
    }

    sql += " ORDER BY bm25_score DESC LIMIT @limit";
    params.limit = limit;

    type Row = {
      id: string; kind: string; name: string; file_path: string;
      start_line: number; end_line: number; content_hash: string;
      language: string; signature: string | null; docstring: string | null;
      exported: number; last_indexed: number; community_id: number | null;
      page_rank: number | null; metadata: string | null; bm25_score: number;
    };

    const rows = await this.store.query<Row>(sql, params);

    return rows.map((row) => ({
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
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      textScore: row.bm25_score,
      bm25Score: row.bm25_score,
    }));
  }

  private async vectorSearch(
    query: string,
    limit: number,
    kind?: NodeKind
  ): Promise<ScoredNode[]> {
    // Vector search requires embeddings to be pre-computed.
    // For now, return empty — this is a hook for future embedding support.
    // In a full implementation, this would:
    // 1. Embed the query text using the same model used for node embeddings
    // 2. Compute cosine similarity against all node embeddings
    // 3. Return top-k results
    return [];
  }

  /**
   * Merge BM25 and vector results using Reciprocal Rank Fusion.
   */
  private mergeResults(
    bm25: ScoredNode[],
    vector: ScoredNode[],
    limit: number
  ): ScoredNode[] {
    const k = 60; // RRF constant
    const scores = new Map<string, { node: ScoredNode; rrfScore: number }>();

    // BM25 contributions
    for (let i = 0; i < bm25.length; i++) {
      const node = bm25[i];
      const existing = scores.get(node.id);
      const rrfContrib = 1 / (k + i + 1);
      if (existing) {
        existing.rrfScore += rrfContrib;
        existing.node.bm25Score = node.bm25Score;
      } else {
        scores.set(node.id, {
          node: { ...node },
          rrfScore: rrfContrib,
        });
      }
    }

    // Vector contributions
    for (let i = 0; i < vector.length; i++) {
      const node = vector[i];
      const existing = scores.get(node.id);
      const rrfContrib = 1 / (k + i + 1);
      if (existing) {
        existing.rrfScore += rrfContrib;
        existing.node.vectorScore = node.vectorScore;
      } else {
        scores.set(node.id, {
          node: { ...node },
          rrfScore: rrfContrib,
        });
      }
    }

    return Array.from(scores.values())
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, limit)
      .map((entry) => ({
        ...entry.node,
        textScore: entry.rrfScore,
      }));
  }
}

/**
 * Sanitize a query string for FTS5 MATCH syntax.
 * Escapes special characters and wraps terms.
 */
function sanitizeFtsQuery(query: string): string {
  // Remove FTS5 special characters that could cause syntax errors
  const cleaned = query.replace(/[{}()\[\]^~*:"/\\]/g, " ").trim();
  if (!cleaned) return "";

  // Split into terms and join with implicit AND
  const terms = cleaned.split(/\s+/).filter((t) => t.length > 0);
  if (terms.length === 0) return "";

  // For single terms, use prefix matching; for multi-term, use phrase matching
  if (terms.length === 1) {
    return `"${terms[0]}"*`;
  }

  return terms.map((t) => `"${t}"`).join(" ");
}
