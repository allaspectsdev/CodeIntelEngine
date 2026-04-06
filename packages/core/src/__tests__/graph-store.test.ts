import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GraphStore } from "../graph/store.js";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

function tmpDb(): string {
  return join(tmpdir(), `codeintel-test-${randomUUID()}.db`);
}

describe("GraphStore", () => {
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

  it("upserts and retrieves nodes", async () => {
    await store.mutate([{
      op: "upsert_node",
      node: {
        id: "test::function::foo::1",
        kind: "function",
        name: "foo",
        filePath: "/src/test.ts",
        startLine: 1,
        endLine: 10,
        contentHash: "abc123",
        language: "typescript",
        exported: true,
        lastIndexed: Date.now(),
      },
    }]);

    const node = await store.getNode("test::function::foo::1");
    expect(node).not.toBeNull();
    expect(node!.name).toBe("foo");
    expect(node!.kind).toBe("function");
    expect(node!.exported).toBe(true);
  });

  it("upserts and retrieves edges", async () => {
    // Create two nodes first
    await store.mutate([
      {
        op: "upsert_node",
        node: {
          id: "a", kind: "function", name: "a", filePath: "/a.ts",
          startLine: 1, endLine: 5, contentHash: "h1", language: "typescript",
          exported: true, lastIndexed: Date.now(),
        },
      },
      {
        op: "upsert_node",
        node: {
          id: "b", kind: "function", name: "b", filePath: "/b.ts",
          startLine: 1, endLine: 5, contentHash: "h2", language: "typescript",
          exported: true, lastIndexed: Date.now(),
        },
      },
      {
        op: "upsert_edge",
        edge: {
          id: "a->calls->b", source: "a", target: "b",
          kind: "calls", confidence: 1.0,
        },
      },
    ]);

    const edgesFrom = await store.getEdgesFrom("a", "calls");
    expect(edgesFrom).toHaveLength(1);
    expect(edgesFrom[0].target).toBe("b");

    const edgesTo = await store.getEdgesTo("b", "calls");
    expect(edgesTo).toHaveLength(1);
    expect(edgesTo[0].source).toBe("a");
  });

  it("deletes file nodes cascading to edges", async () => {
    await store.mutate([
      {
        op: "upsert_node",
        node: {
          id: "f", kind: "file", name: "test.ts", filePath: "/test.ts",
          startLine: 1, endLine: 50, contentHash: "h", language: "typescript",
          exported: true, lastIndexed: Date.now(),
        },
      },
      {
        op: "upsert_node",
        node: {
          id: "fn", kind: "function", name: "myFunc", filePath: "/test.ts",
          startLine: 5, endLine: 15, contentHash: "h2", language: "typescript",
          exported: true, lastIndexed: Date.now(),
        },
      },
      {
        op: "upsert_edge",
        edge: {
          id: "f->contains->fn", source: "f", target: "fn",
          kind: "contains", confidence: 1.0,
        },
      },
    ]);

    expect(await store.getNodeCount()).toBe(2);
    await store.mutate([{ op: "delete_file_nodes", filePath: "/test.ts" }]);
    expect(await store.getNodeCount()).toBe(0);
  });

  it("full-text search finds nodes by name", async () => {
    await store.mutate([{
      op: "upsert_node",
      node: {
        id: "auth", kind: "function", name: "authenticateUser",
        filePath: "/auth.ts", startLine: 1, endLine: 20,
        contentHash: "x", language: "typescript",
        signature: "function authenticateUser(token: string): Promise<User>",
        exported: true, lastIndexed: Date.now(),
      },
    }]);

    // FTS5 default tokenizer treats camelCase as a single token.
    // Use prefix match or the full token.
    const result = await store.searchNodes("authenticateUser");
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0].name).toBe("authenticateUser");

    // Also verify the signature is searchable
    const bySig = await store.searchNodes("token");
    expect(bySig.items.length).toBeGreaterThan(0);
  });

  it("transaction batches writes atomically", async () => {
    await store.transaction((tx) => {
      tx.run(
        `INSERT INTO nodes (id, kind, name, file_path, start_line, end_line, content_hash, language, exported, last_indexed)
         VALUES (@id, @kind, @name, @filePath, @startLine, @endLine, @hash, @lang, @exported, @lastIndexed)`,
        { id: "tx1", kind: "function", name: "txTest", filePath: "/tx.ts", startLine: 1, endLine: 5, hash: "h", lang: "typescript", exported: 1, lastIndexed: Date.now() }
      );
      tx.run(
        `INSERT INTO nodes (id, kind, name, file_path, start_line, end_line, content_hash, language, exported, last_indexed)
         VALUES (@id, @kind, @name, @filePath, @startLine, @endLine, @hash, @lang, @exported, @lastIndexed)`,
        { id: "tx2", kind: "function", name: "txTest2", filePath: "/tx.ts", startLine: 6, endLine: 10, hash: "h2", lang: "typescript", exported: 1, lastIndexed: Date.now() }
      );
    });

    expect(await store.getNodeCount()).toBe(2);
  });

  it("getNeighbors returns connected nodes via CTE", async () => {
    // Build a small graph: a -> b -> c
    await store.mutate([
      { op: "upsert_node", node: { id: "a", kind: "function", name: "a", filePath: "/a.ts", startLine: 1, endLine: 1, contentHash: "1", language: "typescript", exported: true, lastIndexed: Date.now() } },
      { op: "upsert_node", node: { id: "b", kind: "function", name: "b", filePath: "/b.ts", startLine: 1, endLine: 1, contentHash: "2", language: "typescript", exported: true, lastIndexed: Date.now() } },
      { op: "upsert_node", node: { id: "c", kind: "function", name: "c", filePath: "/c.ts", startLine: 1, endLine: 1, contentHash: "3", language: "typescript", exported: true, lastIndexed: Date.now() } },
      { op: "upsert_edge", edge: { id: "e1", source: "a", target: "b", kind: "calls", confidence: 1.0 } },
      { op: "upsert_edge", edge: { id: "e2", source: "b", target: "c", kind: "calls", confidence: 1.0 } },
    ]);

    // Depth 1 from a: should get b
    const depth1 = await store.getNeighbors("a", { direction: "out", maxDepth: 1 });
    expect(depth1.map((n) => n.id)).toEqual(["b"]);

    // Depth 2 from a: should get b and c
    const depth2 = await store.getNeighbors("a", { direction: "out", maxDepth: 2 });
    const ids = depth2.map((n) => n.id).sort();
    expect(ids).toEqual(["b", "c"]);

    // Reverse: depth 1 from c should get b
    const reverse = await store.getNeighbors("c", { direction: "in", maxDepth: 1 });
    expect(reverse.map((n) => n.id)).toEqual(["b"]);

    // Kind filter: only "imports" edges — should get nothing
    const filtered = await store.getNeighbors("a", { direction: "out", maxDepth: 2, kinds: ["imports"] });
    expect(filtered).toHaveLength(0);
  });
});
