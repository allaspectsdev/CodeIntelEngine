import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GraphStore } from "@codeintel/core";
import { TextSearch } from "../text-search.js";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

function tmpDb(): string {
  return join(tmpdir(), `codeintel-test-${randomUUID()}.db`);
}

describe("TextSearch", () => {
  let dbPath: string;
  let store: GraphStore;
  let search: TextSearch;

  beforeEach(async () => {
    dbPath = tmpDb();
    store = new GraphStore(dbPath);
    await store.init();
    search = new TextSearch(store);

    await store.mutate([
      {
        op: "upsert_node",
        node: {
          id: "auth", kind: "function", name: "authenticateUser",
          filePath: "/auth.ts", startLine: 1, endLine: 20,
          contentHash: "x", language: "typescript",
          signature: "function authenticateUser(token: string)",
          docstring: "Validates a JWT token and returns the user",
          exported: true, lastIndexed: Date.now(),
        },
      },
      {
        op: "upsert_node",
        node: {
          id: "pay", kind: "class", name: "PaymentProcessor",
          filePath: "/payment.ts", startLine: 1, endLine: 50,
          contentHash: "y", language: "typescript",
          signature: "class PaymentProcessor",
          exported: true, lastIndexed: Date.now(),
        },
      },
    ]);
  });

  afterEach(async () => {
    await store.close();
    try { unlinkSync(dbPath); } catch {}
  });

  it("finds nodes by name keyword", async () => {
    const result = await search.search("authenticate");
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0].name).toBe("authenticateUser");
  });

  it("returns empty for non-matching query", async () => {
    const result = await search.search("zznonexistentzz");
    expect(result.items).toHaveLength(0);
  });

  it("handles special characters in query without crashing", async () => {
    // These should not throw, even if they return no results
    await search.search('he said "hello"');
    await search.search("-negated +forced");
    await search.search("AND OR NOT");
    await search.search("{}()[]^~*");
    await search.search("");
  });

  it("filters by kind", async () => {
    const result = await search.search("Payment", { kind: "class" });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0].kind).toBe("class");
  });
});
