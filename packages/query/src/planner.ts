import type { GraphStore, GraphNode, NodeKind, QueryResult } from "@codeintel/core";
import { TextSearch, type ScoredNode, type TextSearchOptions } from "./text-search.js";
import { GraphWalk, type ImpactResult, type ContextResult, type FlowStep } from "./graph-walk.js";
import { RankFusion, type FusedResult, type FusionWeights } from "./rank-fusion.js";

export interface QueryPlan {
  textPhase: { bm25: boolean; vector: boolean };
  graphPhase: {
    expandCommunity: boolean;
    traceProcesses: boolean;
    impactRadius?: number;
  };
  fusionWeights: FusionWeights;
}

export interface QueryOptions {
  limit?: number;
  kind?: NodeKind;
  filePath?: string;
  plan?: Partial<QueryPlan>;
}

export type QueryType = "keyword" | "natural_language" | "structural" | "impact";

/**
 * Query engine that orchestrates text search, graph traversal, and rank fusion.
 *
 * Automatically selects the best query plan based on the query structure,
 * or accepts a manual plan override.
 */
export class QueryEngine {
  private textSearch: TextSearch;
  private graphWalk: GraphWalk;
  private rankFusion: RankFusion;

  constructor(private store: GraphStore) {
    this.textSearch = new TextSearch(store);
    this.graphWalk = new GraphWalk(store);
    this.rankFusion = new RankFusion();
  }

  /**
   * Execute a unified query that combines text search + graph signals.
   */
  async query(queryText: string, opts?: QueryOptions): Promise<FusedResult[]> {
    const plan = this.buildPlan(queryText, opts?.plan);
    const limit = opts?.limit ?? 50;

    // Phase 1: Text search
    const textResults = await this.textSearch.search(queryText, {
      limit: limit * 2,
      kind: opts?.kind,
      filePath: opts?.filePath,
      bm25: plan.textPhase.bm25,
      vector: plan.textPhase.vector,
    });

    if (textResults.items.length === 0) {
      return [];
    }

    // Phase 2: Graph expansion
    let graphNeighbors: GraphNode[] = [];

    if (plan.graphPhase.expandCommunity) {
      // Find communities represented in text results and pull in siblings
      const communities = new Set<number>();
      for (const node of textResults.items) {
        if (node.communityId !== undefined) {
          communities.add(node.communityId);
        }
      }

      if (communities.size > 0) {
        const communityIds = Array.from(communities).slice(0, 5); // limit communities
        for (const cid of communityIds) {
          const members = await this.store.query<{ id: string }>(
            "SELECT id FROM nodes WHERE community_id = ? LIMIT 20",
            { 1: cid } as unknown as Record<string, unknown>
          );
          for (const m of members) {
            const node = await this.store.getNode(m.id);
            if (node) graphNeighbors.push(node);
          }
        }
      }
    }

    if (plan.graphPhase.impactRadius) {
      // Expand neighbors around top results
      const topIds = textResults.items.slice(0, 5).map((n) => n.id);
      for (const id of topIds) {
        const neighbors = await this.store.getNeighbors(id, {
          direction: "both",
          maxDepth: plan.graphPhase.impactRadius,
        });
        graphNeighbors.push(...neighbors);
      }
    }

    // Phase 3: Fusion
    const queryCommunities = new Set<number>();
    for (const node of textResults.items) {
      if (node.communityId !== undefined) {
        queryCommunities.add(node.communityId);
      }
    }

    const fused = this.rankFusion.fuse(textResults.items, graphNeighbors, {
      limit,
      queryCommunities,
    });

    return fused;
  }

  /**
   * Impact analysis: find everything affected by a symbol.
   */
  async impact(nodeId: string, opts?: { maxDepth?: number }): Promise<ImpactResult[]> {
    return this.graphWalk.analyzeImpact(nodeId, opts);
  }

  /**
   * Gather full context for a symbol.
   */
  async context(nodeId: string): Promise<ContextResult | null> {
    return this.graphWalk.gatherContext(nodeId);
  }

  /**
   * Trace execution flow from a starting point.
   */
  async traceFlow(startNodeId: string, opts?: { maxDepth?: number }): Promise<FlowStep[]> {
    return this.graphWalk.traceFlow(startNodeId, opts);
  }

  /**
   * Find a node by exact name.
   */
  async findByName(name: string, kind?: NodeKind): Promise<GraphNode[]> {
    let sql = "SELECT * FROM nodes WHERE name = @name";
    const params: Record<string, unknown> = { name };
    if (kind) {
      sql += " AND kind = @kind";
      params.kind = kind;
    }

    type NodeRow = {
      id: string; kind: string; name: string; file_path: string;
      start_line: number; end_line: number; content_hash: string;
      language: string; signature: string | null; docstring: string | null;
      exported: number; last_indexed: number; community_id: number | null;
      page_rank: number | null; metadata: string | null;
    };

    const rows = await this.store.query<NodeRow>(sql, params);
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as NodeKind,
      name: r.name,
      filePath: r.file_path,
      startLine: r.start_line,
      endLine: r.end_line,
      contentHash: r.content_hash,
      language: r.language,
      signature: r.signature ?? undefined,
      docstring: r.docstring ?? undefined,
      exported: r.exported === 1,
      lastIndexed: r.last_indexed,
      communityId: r.community_id ?? undefined,
      pageRank: r.page_rank ?? undefined,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
  }

  /**
   * Build or merge a query plan based on query analysis.
   */
  private buildPlan(query: string, override?: Partial<QueryPlan>): QueryPlan {
    const queryType = classifyQuery(query);

    const basePlan: QueryPlan = {
      textPhase: { bm25: true, vector: false },
      graphPhase: {
        expandCommunity: false,
        traceProcesses: false,
      },
      fusionWeights: { text: 0.6, graph: 0.2, pagerank: 0.15, community: 0.05 },
    };

    switch (queryType) {
      case "keyword":
        // Pure keyword search: rely heavily on text
        basePlan.fusionWeights = { text: 0.7, graph: 0.1, pagerank: 0.15, community: 0.05 };
        break;

      case "natural_language":
        // NL query: use vector search too, expand communities
        basePlan.textPhase.vector = true;
        basePlan.graphPhase.expandCommunity = true;
        basePlan.fusionWeights = { text: 0.4, graph: 0.3, pagerank: 0.2, community: 0.1 };
        break;

      case "structural":
        // Structural query (file paths, specific symbols): lean on graph
        basePlan.graphPhase.impactRadius = 2;
        basePlan.fusionWeights = { text: 0.3, graph: 0.4, pagerank: 0.2, community: 0.1 };
        break;

      case "impact":
        // Impact-style query: heavy graph expansion
        basePlan.graphPhase.expandCommunity = true;
        basePlan.graphPhase.traceProcesses = true;
        basePlan.graphPhase.impactRadius = 3;
        basePlan.fusionWeights = { text: 0.2, graph: 0.5, pagerank: 0.2, community: 0.1 };
        break;
    }

    // Apply overrides
    if (override) {
      if (override.textPhase) {
        Object.assign(basePlan.textPhase, override.textPhase);
      }
      if (override.graphPhase) {
        Object.assign(basePlan.graphPhase, override.graphPhase);
      }
      if (override.fusionWeights) {
        Object.assign(basePlan.fusionWeights, override.fusionWeights);
      }
    }

    return basePlan;
  }
}

/**
 * Classify the query type to pick an appropriate plan.
 */
function classifyQuery(query: string): QueryType {
  const words = query.split(/\s+/);

  // Impact-related keywords
  if (/\b(impact|affects?|breaks?|depends?|downstream|upstream|blast\s*radius)\b/i.test(query)) {
    return "impact";
  }

  // Structural patterns: file paths, dot-separated identifiers
  if (/[./\\]/.test(query) || /\w+\.\w+\.\w+/.test(query)) {
    return "structural";
  }

  // Natural language: contains common English words, longer queries
  const nlIndicators = /\b(what|where|how|why|which|find|show|list|all|the|is|are|does|can)\b/i;
  if (nlIndicators.test(query) || words.length > 4) {
    return "natural_language";
  }

  // Default: keyword search
  return "keyword";
}
