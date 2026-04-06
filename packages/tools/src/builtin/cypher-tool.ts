import type { ToolPlugin, ToolContext, ToolResult } from "../types.js";

export const sqlTool: ToolPlugin = {
  name: "sql",
  description:
    "Execute a raw SQL query against the graph database (SQLite). Useful for ad-hoc " +
    "exploration and custom analysis not covered by other tools.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "SQL query to execute (SELECT only for safety)",
      },
      limit: {
        type: "number",
        description: "Maximum rows to return (default: 100)",
        default: 100,
      },
    },
    required: ["query"],
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const query = (args.query as string).trim();
    const limit = (args.limit as number) ?? 100;

    // Safety: only allow SELECT queries
    const normalized = query.toUpperCase().replace(/\s+/g, " ");
    if (!normalized.startsWith("SELECT")) {
      return {
        content: [
          {
            type: "text",
            text: "Only SELECT queries are allowed for safety. Use the graph store API for mutations.",
          },
        ],
        isError: true,
      };
    }

    // Prevent destructive subqueries
    const forbidden = [
      "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE",
      "ATTACH", "DETACH", "REINDEX", "ANALYZE", "VACUUM", "PRAGMA",
    ];
    for (const keyword of forbidden) {
      if (normalized.includes(keyword)) {
        return {
          content: [
            { type: "text", text: `Query contains forbidden keyword: ${keyword}` },
          ],
          isError: true,
        };
      }
    }

    // Add LIMIT if not present
    let finalQuery = query;
    if (!normalized.includes("LIMIT")) {
      finalQuery += ` LIMIT ${limit}`;
    }

    try {
      const rows = await ctx.store.query<Record<string, unknown>>(finalQuery);

      return {
        content: [
          { type: "text", text: `Query returned ${rows.length} rows` },
          { type: "json", data: rows },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Query failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
};
