import type { GraphStore, Community } from "@codeintel/core";

/**
 * Leiden-inspired community detection on the code graph.
 *
 * This is a simplified version of the Leiden algorithm adapted for code graphs:
 * 1. Build an adjacency structure from edges
 * 2. Initialize each node as its own community
 * 3. Iteratively move nodes to neighboring communities if modularity improves
 * 4. Refine communities using local merge/split
 *
 * The full Leiden algorithm uses random neighbor selection and refinement phases;
 * this implementation uses a deterministic greedy approach which is simpler but
 * produces reasonable results for code structure.
 */
export async function detectCommunities(
  store: GraphStore,
  opts?: { resolution?: number; maxIterations?: number }
): Promise<Community[]> {
  const resolution = opts?.resolution ?? 1.0;
  const maxIterations = opts?.maxIterations ?? 50;

  // Load the graph structure
  const nodes = await store.query<{ id: string }>("SELECT id FROM nodes");
  const edges = await store.query<{ source: string; target: string; confidence: number }>(
    "SELECT source, target, confidence FROM edges WHERE kind IN ('calls', 'imports', 'uses', 'contains')"
  );

  if (nodes.length === 0) return [];

  // Build adjacency list
  const nodeIds = nodes.map((n) => n.id);
  const nodeIndex = new Map(nodeIds.map((id, i) => [id, i]));
  const adj: Map<number, Array<{ neighbor: number; weight: number }>> = new Map();

  for (let i = 0; i < nodeIds.length; i++) {
    adj.set(i, []);
  }

  let totalWeight = 0;
  for (const edge of edges) {
    const s = nodeIndex.get(edge.source);
    const t = nodeIndex.get(edge.target);
    if (s === undefined || t === undefined) continue;
    const w = edge.confidence;
    adj.get(s)!.push({ neighbor: t, weight: w });
    adj.get(t)!.push({ neighbor: s, weight: w });
    totalWeight += w;
  }

  if (totalWeight === 0) totalWeight = 1;

  // Initialize: each node is its own community
  const community = new Int32Array(nodeIds.length);
  for (let i = 0; i < community.length; i++) {
    community[i] = i;
  }

  // Degree (weighted) of each node
  const degree = new Float64Array(nodeIds.length);
  for (let i = 0; i < nodeIds.length; i++) {
    const neighbors = adj.get(i)!;
    degree[i] = neighbors.reduce((sum, n) => sum + n.weight, 0);
  }

  // Community total weight
  const communityWeight = new Float64Array(nodeIds.length);
  for (let i = 0; i < nodeIds.length; i++) {
    communityWeight[i] = degree[i];
  }

  // Louvain-style greedy modularity optimization
  let improved = true;
  let iteration = 0;

  while (improved && iteration < maxIterations) {
    improved = false;
    iteration++;

    for (let i = 0; i < nodeIds.length; i++) {
      const currentCom = community[i];
      const neighbors = adj.get(i)!;

      // Calculate weight to each neighboring community
      const comWeights = new Map<number, number>();
      for (const { neighbor, weight } of neighbors) {
        const nCom = community[neighbor];
        comWeights.set(nCom, (comWeights.get(nCom) ?? 0) + weight);
      }

      // Find the best community to move to
      let bestCom = currentCom;
      let bestDelta = 0;

      // Remove node from current community for calculation
      communityWeight[currentCom] -= degree[i];
      const weightToCurrent = comWeights.get(currentCom) ?? 0;

      for (const [targetCom, weightToTarget] of comWeights) {
        if (targetCom === currentCom) continue;

        // Modularity gain from moving i from currentCom to targetCom
        const delta =
          (weightToTarget - weightToCurrent) / totalWeight -
          resolution *
            degree[i] *
            (communityWeight[targetCom] - communityWeight[currentCom]) /
            (2 * totalWeight * totalWeight);

        if (delta > bestDelta) {
          bestDelta = delta;
          bestCom = targetCom;
        }
      }

      // Move to best community
      communityWeight[currentCom] += degree[i]; // restore
      if (bestCom !== currentCom) {
        communityWeight[currentCom] -= degree[i];
        communityWeight[bestCom] += degree[i];
        community[i] = bestCom;
        improved = true;
      }
    }
  }

  // Compact community IDs
  const communityMap = new Map<number, number>();
  let nextId = 0;
  for (let i = 0; i < community.length; i++) {
    if (!communityMap.has(community[i])) {
      communityMap.set(community[i], nextId++);
    }
    community[i] = communityMap.get(community[i])!;
  }

  // Build community objects
  const communities = new Map<number, { members: string[]; internalEdges: number; totalEdges: number }>();
  for (let i = 0; i < nodeIds.length; i++) {
    const cid = community[i];
    if (!communities.has(cid)) {
      communities.set(cid, { members: [], internalEdges: 0, totalEdges: 0 });
    }
    communities.get(cid)!.members.push(nodeIds[i]);
  }

  // Calculate cohesion (ratio of internal edges to total edges)
  for (const edge of edges) {
    const s = nodeIndex.get(edge.source);
    const t = nodeIndex.get(edge.target);
    if (s === undefined || t === undefined) continue;

    const sCom = community[s];
    const tCom = community[t];
    const com = communities.get(sCom);
    if (com) {
      com.totalEdges++;
      if (sCom === tCom) com.internalEdges++;
    }
  }

  // Update database
  const mutations: Array<{ op: "upsert_node"; node: { id: string; communityId: number } }> = [];
  const result: Community[] = [];

  for (const [cid, data] of communities) {
    const cohesion = data.totalEdges > 0 ? data.internalEdges / data.totalEdges : 0;

    // Generate a label from the most common file paths in the community
    const label = generateCommunityLabel(data.members);

    result.push({
      id: cid,
      label,
      memberCount: data.members.length,
      cohesion,
    });

    await store.upsertCommunity({
      id: cid,
      label,
      memberCount: data.members.length,
      cohesion,
    });
  }

  // Update node community assignments
  for (let i = 0; i < nodeIds.length; i++) {
    await store.run(
      "UPDATE nodes SET community_id = ? WHERE id = ?",
      { 1: community[i], 2: nodeIds[i] } as unknown as Record<string, unknown>
    );
  }

  return result;
}

function generateCommunityLabel(memberIds: string[]): string {
  // Extract file paths from member IDs (format: filePath::kind::name::line)
  const pathCounts = new Map<string, number>();
  for (const id of memberIds) {
    const filePath = id.split("::")[0];
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    if (dir) {
      pathCounts.set(dir, (pathCounts.get(dir) ?? 0) + 1);
    }
  }

  // Find the most common directory
  let bestDir = "";
  let bestCount = 0;
  for (const [dir, count] of pathCounts) {
    if (count > bestCount) {
      bestCount = count;
      bestDir = dir;
    }
  }

  if (bestDir) {
    const parts = bestDir.split("/");
    return parts.slice(-2).join("/");
  }

  return `community-${memberIds.length}`;
}
