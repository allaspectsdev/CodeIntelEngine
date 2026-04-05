import type { GraphNode } from "@codeintel/core";
import type { ScoredNode } from "./text-search.js";
import type { ImpactResult } from "./graph-walk.js";

export interface FusedResult {
  node: GraphNode;
  score: number;
  textScore: number;
  graphScore: number;
  pageRankScore: number;
  communityRelevance: number;
}

export interface FusionWeights {
  text: number;
  graph: number;
  pagerank: number;
  community: number;
}

const DEFAULT_WEIGHTS: FusionWeights = {
  text: 0.4,
  graph: 0.3,
  pagerank: 0.2,
  community: 0.1,
};

/**
 * Reciprocal Rank Fusion enhanced with graph signals.
 *
 * Combines text search results with graph-based signals:
 * - Text relevance (BM25 + vector, already fused)
 * - Graph proximity (how close to query-relevant nodes)
 * - PageRank (global importance in the codebase)
 * - Community relevance (whether it co-occurs with other matches)
 */
export class RankFusion {
  private weights: FusionWeights;

  constructor(weights?: Partial<FusionWeights>) {
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  /**
   * Fuse text search results with graph signals.
   */
  fuse(
    textResults: ScoredNode[],
    graphNeighbors: GraphNode[],
    opts?: { limit?: number; queryCommunities?: Set<number> }
  ): FusedResult[] {
    const limit = opts?.limit ?? 50;
    const queryCommunities = opts?.queryCommunities ?? new Set<number>();

    // Build score maps
    const textScores = new Map<string, number>();
    const nodeMap = new Map<string, GraphNode>();

    // RRF scores for text results
    const k = 60;
    for (let i = 0; i < textResults.length; i++) {
      const node = textResults[i];
      textScores.set(node.id, 1 / (k + i + 1));
      nodeMap.set(node.id, node);
    }

    // Add graph neighbors that aren't in text results
    const graphScores = new Map<string, number>();
    for (let i = 0; i < graphNeighbors.length; i++) {
      const node = graphNeighbors[i];
      graphScores.set(node.id, 1 / (k + i + 1));
      if (!nodeMap.has(node.id)) {
        nodeMap.set(node.id, node);
      }
    }

    // Compute fused scores
    const results: FusedResult[] = [];

    for (const [id, node] of nodeMap) {
      const textScore = textScores.get(id) ?? 0;
      const graphScore = graphScores.get(id) ?? 0;
      const pageRankScore = node.pageRank ?? 0;

      // Community relevance: boost if in the same community as other matches
      let communityRelevance = 0;
      if (node.communityId !== undefined && queryCommunities.has(node.communityId)) {
        communityRelevance = 1;
      }

      const score =
        this.weights.text * textScore +
        this.weights.graph * graphScore +
        this.weights.pagerank * normalizePageRank(pageRankScore) +
        this.weights.community * communityRelevance;

      results.push({
        node,
        score,
        textScore,
        graphScore,
        pageRankScore,
        communityRelevance,
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Fuse impact analysis results with text relevance for context-aware impact.
   */
  fuseImpact(
    impactResults: ImpactResult[],
    textResults: ScoredNode[]
  ): FusedResult[] {
    const textScoreMap = new Map<string, number>();
    for (let i = 0; i < textResults.length; i++) {
      textScoreMap.set(textResults[i].id, 1 / (60 + i + 1));
    }

    return impactResults.map((impact) => {
      const textScore = textScoreMap.get(impact.target.id) ?? 0;
      const graphScore = impact.impactScore;
      const pageRankScore = impact.target.pageRank ?? 0;

      const score =
        0.2 * textScore +
        0.5 * normalizeImpact(graphScore) +
        0.3 * normalizePageRank(pageRankScore);

      return {
        node: impact.target,
        score,
        textScore,
        graphScore,
        pageRankScore,
        communityRelevance: 0,
      };
    });
  }
}

function normalizePageRank(pr: number): number {
  // PageRank values are typically very small; scale to [0, 1]
  return Math.min(1, pr * 1000);
}

function normalizeImpact(impact: number): number {
  // Impact scores are unbounded; use sigmoid-like normalization
  return impact / (1 + impact);
}
