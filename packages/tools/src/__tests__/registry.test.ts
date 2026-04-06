import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../registry.js";
import type { ToolPlugin, ToolContext } from "../types.js";

const mockPlugin: ToolPlugin = {
  name: "test_tool",
  description: "A test tool",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      limit: { type: "number", description: "Max results" },
      kind: { type: "string", enum: ["function", "class", "method"] },
    },
    required: ["query"],
  },
  async execute(args) {
    return {
      content: [{ type: "text", text: `Got: ${args.query}` }],
    };
  },
};

const mockCtx = {} as ToolContext;

describe("ToolRegistry", () => {
  it("registers and lists tools", () => {
    const registry = new ToolRegistry();
    registry.register(mockPlugin);
    expect(registry.size).toBe(1);
    expect(registry.list()[0].name).toBe("test_tool");
  });

  it("executes a registered tool", async () => {
    const registry = new ToolRegistry();
    registry.register(mockPlugin);
    const result = await registry.execute("test_tool", { query: "hello" }, mockCtx);
    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toEqual({ type: "text", text: "Got: hello" });
  });

  it("returns error for unknown tool", async () => {
    const registry = new ToolRegistry();
    const result = await registry.execute("nonexistent", {}, mockCtx);
    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
  });

  it("validates required fields", async () => {
    const registry = new ToolRegistry();
    registry.register(mockPlugin);
    // Missing required "query" field
    const result = await registry.execute("test_tool", {}, mockCtx);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("missing required");
  });

  it("validates field types", async () => {
    const registry = new ToolRegistry();
    registry.register(mockPlugin);
    // query should be string, passing number
    const result = await registry.execute("test_tool", { query: 42 }, mockCtx);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("must be string");
  });

  it("validates enum constraints", async () => {
    const registry = new ToolRegistry();
    registry.register(mockPlugin);
    // kind should be one of function/class/method
    const result = await registry.execute("test_tool", { query: "test", kind: "banana" }, mockCtx);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("must be one of");
  });

  it("passes validation with correct types", async () => {
    const registry = new ToolRegistry();
    registry.register(mockPlugin);
    const result = await registry.execute(
      "test_tool",
      { query: "test", limit: 10, kind: "function" },
      mockCtx
    );
    expect(result.isError).toBeUndefined();
  });

  it("catches exceptions from tool execution", async () => {
    const throwingPlugin: ToolPlugin = {
      name: "thrower",
      description: "Always throws",
      inputSchema: { type: "object" },
      async execute() { throw new Error("boom"); },
    };
    const registry = new ToolRegistry();
    registry.register(throwingPlugin);
    const result = await registry.execute("thrower", {}, mockCtx);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("boom");
  });
});
