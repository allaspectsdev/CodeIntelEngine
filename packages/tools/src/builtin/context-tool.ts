import type { ToolPlugin, ToolContext, ToolResult } from "../types.js";

export const contextTool: ToolPlugin = {
  name: "context",
  description:
    "Gather comprehensive context around a symbol: callers, callees, imports, " +
    "community siblings, and execution flows it participates in.",
  inputSchema: {
    type: "object",
    properties: {
      nodeId: {
        type: "string",
        description: "ID of the symbol node to get context for",
      },
      name: {
        type: "string",
        description: "Symbol name to look up (if nodeId not provided)",
      },
      kind: {
        type: "string",
        enum: ["function", "class", "method", "interface", "type_alias", "variable"],
        description: "Symbol kind filter (used with name lookup)",
      },
    },
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    let nodeId = args.nodeId as string | undefined;

    // If name provided instead of ID, look it up
    if (!nodeId && args.name) {
      const matches = await ctx.query.findByName(
        args.name as string,
        args.kind as any
      );
      if (matches.length === 0) {
        return {
          content: [{ type: "text", text: `Symbol "${args.name}" not found` }],
        };
      }
      nodeId = matches[0].id;
    }

    if (!nodeId) {
      return {
        content: [{ type: "text", text: "Either nodeId or name is required" }],
        isError: true,
      };
    }

    const result = await ctx.query.context(nodeId);
    if (!result) {
      return {
        content: [{ type: "text", text: `Node "${nodeId}" not found` }],
      };
    }

    const summary = {
      symbol: {
        name: result.node.name,
        kind: result.node.kind,
        file: result.node.filePath,
        lines: `${result.node.startLine}-${result.node.endLine}`,
        signature: result.node.signature,
        docstring: result.node.docstring,
        exported: result.node.exported,
        community: result.node.communityId,
        pageRank: result.node.pageRank,
      },
      callers: result.callers.map((n) => ({
        name: n.name,
        kind: n.kind,
        file: n.filePath,
        line: n.startLine,
      })),
      callees: result.callees.map((n) => ({
        name: n.name,
        kind: n.kind,
        file: n.filePath,
        line: n.startLine,
      })),
      imports: result.imports.map((n) => ({
        name: n.name,
        kind: n.kind,
        file: n.filePath,
      })),
      importedBy: result.importedBy.map((n) => ({
        name: n.name,
        file: n.filePath,
      })),
      communitySiblings: result.siblings.slice(0, 10).map((n) => ({
        name: n.name,
        kind: n.kind,
        file: n.filePath,
      })),
      process: result.process,
    };

    return {
      content: [
        {
          type: "text",
          text: `Context for ${result.node.kind} "${result.node.name}" in ${result.node.filePath}:`,
        },
        { type: "json", data: summary },
      ],
    };
  },
};
