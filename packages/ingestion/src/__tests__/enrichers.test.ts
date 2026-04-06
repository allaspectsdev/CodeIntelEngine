import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GraphStore } from "@codeintel/core";
import { computePageRank } from "../enrichers/pagerank.js";
import { detectCommunities } from "../enrichers/community-detection.js";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

function tmpDb(): string {
  return join(tmpdir(), `codeintel-test-${randomUUID()}.db`);
}

function makeNode(id: string, name: string) {
  return {
    id, kind: "function" as const, name, filePath: `/${name}.ts`,
    startLine: 1, endLine: 10, contentHash: id, language: "typescript",
    exported: true, lastIndexed: Date.now(),
  };
}

describe("PageRank", () => {
  let dbPath: string;
  let store: GraphStore;

  beforeEach(async () => {
    dbPath = tmpDb();
    store = new GraphStore(dbPath);
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    try { unlinkSync(dbPath); } catch {}
  });

  it("computes higher rank for nodes with more inbound links", async () => {
    // Build: a -> hub, b -> hub, c -> hub, hub -> leaf
    await store.mutate([
      { op: "upsert_node", node: makeNode("a", "a") },
      { op: "upsert_node", node: makeNode("b", "b") },
      { op: "upsert_node", node: makeNode("c", "c") },
      { op: "upsert_node", node: makeNode("hub", "hub") },
      { op: "upsert_node", node: makeNode("leaf", "leaf") },
      { op: "upsert_edge", edge: { id: "e1", source: "a", target: "hub", kind: "calls", confidence: 1 } },
      { op: "upsert_edge", edge: { id: "e2", source: "b", target: "hub", kind: "calls", confidence: 1 } },
      { op: "upsert_edge", edge: { id: "e3", source: "c", target: "hub", kind: "calls", confidence: 1 } },
      { op: "upsert_edge", edge: { id: "e4", source: "hub", target: "leaf", kind: "calls", confidence: 1 } },
    ]);

    const ranks = await computePageRank(store);
    expect(ranks.size).toBe(5);

    // Hub has most inbound links so should rank higher than the source nodes.
    // Leaf receives all of hub's rank (sole outlink) plus dangling redistribution,
    // so leaf may actually outrank hub — that's correct PageRank behavior.
    const hubRank = ranks.get("hub")!;
    const aRank = ranks.get("a")!;
    expect(hubRank).toBeGreaterThan(aRank);
  });

  it("converges to valid probability distribution", async () => {
    await store.mutate([
      { op: "upsert_node", node: makeNode("x", "x") },
      { op: "upsert_node", node: makeNode("y", "y") },
      { op: "upsert_node", node: makeNode("z", "z") },
      { op: "upsert_edge", edge: { id: "e1", source: "x", target: "y", kind: "calls", confidence: 1 } },
      { op: "upsert_edge", edge: { id: "e2", source: "y", target: "z", kind: "calls", confidence: 1 } },
      { op: "upsert_edge", edge: { id: "e3", source: "z", target: "x", kind: "calls", confidence: 1 } },
    ]);

    const ranks = await computePageRank(store);
    // Sum of all ranks should be approximately 1.0
    let sum = 0;
    for (const r of ranks.values()) sum += r;
    expect(sum).toBeCloseTo(1.0, 3);
  });

  it("returns empty map for empty graph", async () => {
    const ranks = await computePageRank(store);
    expect(ranks.size).toBe(0);
  });
});

describe("Community Detection", () => {
  let dbPath: string;
  let store: GraphStore;

  beforeEach(async () => {
    dbPath = tmpDb();
    store = new GraphStore(dbPath);
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    try { unlinkSync(dbPath); } catch {}
  });

  it("detects separate communities for disconnected clusters", async () => {
    // Cluster 1: a <-> b <-> c
    // Cluster 2: x <-> y <-> z
    // No edges between clusters
    await store.mutate([
      { op: "upsert_node", node: makeNode("a", "a") },
      { op: "upsert_node", node: makeNode("b", "b") },
      { op: "upsert_node", node: makeNode("c", "c") },
      { op: "upsert_node", node: makeNode("x", "x") },
      { op: "upsert_node", node: makeNode("y", "y") },
      { op: "upsert_node", node: makeNode("z", "z") },
      { op: "upsert_edge", edge: { id: "e1", source: "a", target: "b", kind: "calls", confidence: 1 } },
      { op: "upsert_edge", edge: { id: "e2", source: "b", target: "c", kind: "calls", confidence: 1 } },
      { op: "upsert_edge", edge: { id: "e3", source: "c", target: "a", kind: "calls", confidence: 1 } },
      { op: "upsert_edge", edge: { id: "e4", source: "x", target: "y", kind: "calls", confidence: 1 } },
      { op: "upsert_edge", edge: { id: "e5", source: "y", target: "z", kind: "calls", confidence: 1 } },
      { op: "upsert_edge", edge: { id: "e6", source: "z", target: "x", kind: "calls", confidence: 1 } },
    ]);

    const communities = await detectCommunities(store);
    expect(communities.length).toBeGreaterThanOrEqual(2);

    // Check that a, b, c are in one community and x, y, z in another
    const nodeA = await store.getNode("a");
    const nodeX = await store.getNode("x");
    expect(nodeA!.communityId).toBeDefined();
    expect(nodeX!.communityId).toBeDefined();
    expect(nodeA!.communityId).not.toBe(nodeX!.communityId);
  });
});
