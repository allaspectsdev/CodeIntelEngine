import type { GraphStore } from "@codeintel/core";

/**
 * Computes PageRank scores for all nodes in the graph.
 *
 * Uses the standard iterative PageRank algorithm:
 *   PR(v) = (1-d)/N + d * sum(PR(u)/L(u)) for all u linking to v
 *
 * Where d is the damping factor and L(u) is the out-degree of u.
 */
export async function computePageRank(
  store: GraphStore,
  opts?: { dampingFactor?: number; maxIterations?: number; tolerance?: number }
): Promise<Map<string, number>> {
  const damping = opts?.dampingFactor ?? 0.85;
  const maxIter = opts?.maxIterations ?? 100;
  const tolerance = opts?.tolerance ?? 1e-6;

  const nodes = await store.query<{ id: string }>("SELECT id FROM nodes");
  const edges = await store.query<{ source: string; target: string }>(
    "SELECT source, target FROM edges"
  );

  const N = nodes.length;
  if (N === 0) return new Map();

  const nodeIndex = new Map(nodes.map((n, i) => [n.id, i]));
  const nodeIds = nodes.map((n) => n.id);

  // Build adjacency: outgoing edges and in-degree
  const outDegree = new Float64Array(N);
  const inLinks: number[][] = Array.from({ length: N }, () => []);

  for (const edge of edges) {
    const s = nodeIndex.get(edge.source);
    const t = nodeIndex.get(edge.target);
    if (s === undefined || t === undefined) continue;
    outDegree[s]++;
    inLinks[t].push(s);
  }

  // Initialize
  let rank = new Float64Array(N).fill(1 / N);
  let newRank = new Float64Array(N);

  // Iterate
  for (let iter = 0; iter < maxIter; iter++) {
    newRank.fill((1 - damping) / N);

    // Distribute rank through edges
    for (let v = 0; v < N; v++) {
      for (const u of inLinks[v]) {
        if (outDegree[u] > 0) {
          newRank[v] += damping * (rank[u] / outDegree[u]);
        }
      }
    }

    // Handle dangling nodes (no outgoing edges): distribute their rank evenly
    let danglingRank = 0;
    for (let i = 0; i < N; i++) {
      if (outDegree[i] === 0) {
        danglingRank += rank[i];
      }
    }
    const danglingContrib = damping * danglingRank / N;
    for (let i = 0; i < N; i++) {
      newRank[i] += danglingContrib;
    }

    // Check convergence
    let diff = 0;
    for (let i = 0; i < N; i++) {
      diff += Math.abs(newRank[i] - rank[i]);
    }

    [rank, newRank] = [newRank, rank];

    if (diff < tolerance) break;
  }

  // Write back to DB
  const result = new Map<string, number>();
  for (let i = 0; i < N; i++) {
    result.set(nodeIds[i], rank[i]);
    await store.run(
      "UPDATE nodes SET page_rank = @rank WHERE id = @id",
      { rank: rank[i], id: nodeIds[i] }
    );
  }

  return result;
}
