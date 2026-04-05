import type { ToolPlugin, ToolContext, ToolResult } from "../types.js";

export const queryTool: ToolPlugin = {
  name: "query",
  description:
    "Search the codebase knowledge graph using natural language or keywords. " +
    "Returns symbols ranked by text relevance, graph importance, and community context.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query — natural language or keywords",
      },
      kind: {
        type: "string",
        enum: ["function", "class", "method", "interface", "type_alias", "variable", "constant", "enum", "module", "file"],
        description: "Filter results by symbol kind",
      },
      filePath: {
        type: "string",
        description: "Filter results to symbols in files matching this path prefix",
      },
      limit: {
        type: "number",
        description: "Maximum number of results (default: 20)",
        default: 20,
      },
    },
    required: ["query"],
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const query = args.query as string;
    const limit = (args.limit as number) ?? 20;

    const results = await ctx.query.query(query, {
      limit,
      kind: args.kind as any,
      filePath: args.filePath as string | undefined,
    });

    if (results.length === 0) {
      return {
        content: [{ type: "text", text: `No results found for: "${query}"` }],
      };
    }

    const formatted = results.map((r, i) => ({
      rank: i + 1,
      name: r.node.name,
      kind: r.node.kind,
      file: r.node.filePath,
      lines: `${r.node.startLine}-${r.node.endLine}`,
      signature: r.node.signature,
      score: Math.round(r.score * 1000) / 1000,
      exported: r.node.exported,
    }));

    return {
      content: [
        { type: "text", text: `Found ${results.length} results for "${query}":` },
        { type: "json", data: formatted },
      ],
    };
  },
};
