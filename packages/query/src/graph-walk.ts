import type { GraphStore, GraphNode, GraphEdge, EdgeKind } from "@codeintel/core";

export interface ImpactResult {
  target: GraphNode;
  path: GraphEdge[];
  distance: number;
  impactScore: number;
}

export interface ContextResult {
  node: GraphNode;
  callers: GraphNode[];
  callees: GraphNode[];
  imports: GraphNode[];
  importedBy: GraphNode[];
  siblings: GraphNode[];     // same community
  process?: string;          // process this node belongs to
}

export interface FlowStep {
  node: GraphNode;
  edge: GraphEdge | null;
  depth: number;
}

/**
 * Graph traversal engine for impact analysis, context gathering, and flow tracing.
 */
export class GraphWalk {
  constructor(private store: GraphStore) {}

  /**
   * Impact analysis: find all nodes affected by changing a given node.
   * Traverses the reverse call graph (who calls this?) and import graph.
   */
  async analyzeImpact(
    nodeId: string,
    opts?: { maxDepth?: number; edgeKinds?: EdgeKind[] }
  ): Promise<ImpactResult[]> {
    const maxDepth = opts?.maxDepth ?? 5;
    const edgeKinds = opts?.edgeKinds ?? ["calls", "imports", "uses", "extends", "implements"];
    const visited = new Map<string, { path: GraphEdge[]; distance: number }>();
    const results: ImpactResult[] = [];

    // BFS from the target node, following reverse edges
    const queue: Array<{ id: string; depth: number; path: GraphEdge[] }> = [
      { id: nodeId, depth: 0, path: [] },
    ];

    while (queue.length > 0) {
      const { id, depth, path } = queue.shift()!;

      if (visited.has(id)) continue;
      visited.set(id, { path, distance: depth });

      if (depth > 0) {
        const node = await this.store.getNode(id);
        if (node) {
          // Impact score decays with distance, boosted by PageRank
          const pageRankBoost = node.pageRank ?? 0;
          const impactScore = (1 / (depth + 1)) + pageRankBoost * 10;

          results.push({
            target: node,
            path,
            distance: depth,
            impactScore,
          });
        }
      }

      if (depth < maxDepth) {
        // Find all nodes that reference this node (reverse edges)
        const inEdges = await this.store.getEdgesTo(id);
        for (const edge of inEdges) {
          if (!edgeKinds.includes(edge.kind)) continue;
          if (visited.has(edge.source)) continue;
          queue.push({
            id: edge.source,
            depth: depth + 1,
            path: [...path, edge],
          });
        }
      }
    }

    // Sort by impact score descending
    results.sort((a, b) => b.impactScore - a.impactScore);
    return results;
  }

  /**
   * Gather full context around a node: callers, callees, imports, community siblings.
   */
  async gatherContext(nodeId: string): Promise<ContextResult | null> {
    const node = await this.store.getNode(nodeId);
    if (!node) return null;

    // Parallel queries for different relationship types
    const [callEdgesOut, callEdgesIn, importEdgesOut, importEdgesIn] = await Promise.all([
      this.store.getEdgesFrom(nodeId, "calls"),
      this.store.getEdgesTo(nodeId, "calls"),
      this.store.getEdgesFrom(nodeId, "imports"),
      this.store.getEdgesTo(nodeId, "imports"),
    ]);

    const resolveNodes = async (ids: string[]): Promise<GraphNode[]> => {
      const results: GraphNode[] = [];
      for (const id of ids) {
        const n = await this.store.getNode(id);
        if (n) results.push(n);
      }
      return results;
    };

    const [callees, callers, imports, importedBy] = await Promise.all([
      resolveNodes(callEdgesOut.map((e) => e.target)),
      resolveNodes(callEdgesIn.map((e) => e.source)),
      resolveNodes(importEdgesOut.map((e) => e.target)),
      resolveNodes(importEdgesIn.map((e) => e.source)),
    ]);

    // Community siblings
    let siblings: GraphNode[] = [];
    if (node.communityId !== undefined) {
      const siblingRows = await this.store.query<{ id: string }>(
        "SELECT id FROM nodes WHERE community_id = @communityId AND id != @nodeId LIMIT 20",
        { communityId: node.communityId, nodeId }
      );
      siblings = await resolveNodes(siblingRows.map((r) => r.id));
    }

    // Check if this node is part of any process
    const processes = await this.store.query<{ id: string; steps: string }>(
      "SELECT id, steps FROM processes"
    );
    let processId: string | undefined;
    for (const proc of processes) {
      const steps = JSON.parse(proc.steps) as string[];
      if (steps.includes(nodeId)) {
        processId = proc.id;
        break;
      }
    }

    return {
      node,
      callers,
      callees,
      imports,
      importedBy,
      siblings,
      process: processId,
    };
  }

  /**
   * Trace an execution flow forward from a starting node.
   */
  async traceFlow(
    startNodeId: string,
    opts?: { maxDepth?: number; edgeKinds?: EdgeKind[] }
  ): Promise<FlowStep[]> {
    const maxDepth = Math.min(opts?.maxDepth ?? 10, 50);
    const edgeKinds = opts?.edgeKinds ?? ["calls"];
    const visited = new Set<string>();
    const steps: FlowStep[] = [];

    // Iterative DFS using an explicit stack to avoid call stack overflow
    const stack: Array<{ nodeId: string; depth: number; edge: GraphEdge | null }> = [
      { nodeId: startNodeId, depth: 0, edge: null },
    ];

    while (stack.length > 0) {
      const { nodeId, depth, edge } = stack.pop()!;
      if (visited.has(nodeId) || depth > maxDepth) continue;
      visited.add(nodeId);

      const node = await this.store.getNode(nodeId);
      if (!node) continue;

      steps.push({ node, edge, depth });

      if (depth < maxDepth) {
        const outEdges = await this.store.getEdgesFrom(nodeId);
        const filtered = outEdges.filter((e) => edgeKinds.includes(e.kind));
        // Sort by line number descending — stack reverses order, so we get
        // ascending execution order when popping
        filtered.sort((a, b) => (b.line ?? 0) - (a.line ?? 0));

        for (const outEdge of filtered) {
          stack.push({ nodeId: outEdge.target, depth: depth + 1, edge: outEdge });
        }
      }
    }

    return steps;
  }

  /**
   * Find the shortest path between two nodes in the graph.
   */
  async findPath(
    fromId: string,
    toId: string,
    opts?: { maxDepth?: number; edgeKinds?: EdgeKind[] }
  ): Promise<FlowStep[] | null> {
    const maxDepth = opts?.maxDepth ?? 10;
    const edgeKinds = opts?.edgeKinds ?? ["calls", "imports", "uses", "extends", "implements"];

    const visited = new Map<string, { parent: string | null; edge: GraphEdge | null }>();
    const queue: Array<{ id: string; depth: number }> = [{ id: fromId, depth: 0 }];
    visited.set(fromId, { parent: null, edge: null });

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;

      if (id === toId) {
        // Reconstruct path
        const path: FlowStep[] = [];
        let current: string | null = toId;
        let d = depth;
        while (current !== null) {
          const node = await this.store.getNode(current);
          const info = visited.get(current) as { parent: string | null; edge: GraphEdge | null };
          if (node) {
            path.unshift({ node, edge: info.edge, depth: d-- });
          }
          current = info.parent;
        }
        return path;
      }

      if (depth >= maxDepth) continue;

      const outEdges = await this.store.getEdgesFrom(id);
      for (const edge of outEdges) {
        if (!edgeKinds.includes(edge.kind)) continue;
        if (visited.has(edge.target)) continue;
        visited.set(edge.target, { parent: id, edge });
        queue.push({ id: edge.target, depth: depth + 1 });
      }
    }

    return null;
  }
}
