import type { ToolPlugin, ToolContext, ToolResult } from "../types.js";

export const impactTool: ToolPlugin = {
  name: "impact",
  description:
    "Analyze the blast radius of changing a symbol. Shows all upstream consumers " +
    "that would be affected, ranked by impact severity and PageRank importance.",
  inputSchema: {
    type: "object",
    properties: {
      nodeId: {
        type: "string",
        description: "ID of the symbol to analyze impact for",
      },
      name: {
        type: "string",
        description: "Symbol name to look up (if nodeId not provided)",
      },
      maxDepth: {
        type: "number",
        description: "Maximum traversal depth (default: 5)",
        default: 5,
      },
      limit: {
        type: "number",
        description: "Maximum number of impacted nodes to return (default: 30)",
        default: 30,
      },
    },
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    let nodeId = args.nodeId as string | undefined;

    if (!nodeId && args.name) {
      const matches = await ctx.query.findByName(args.name as string);
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

    const maxDepth = (args.maxDepth as number) ?? 5;
    const limit = (args.limit as number) ?? 30;

    const results = await ctx.query.impact(nodeId, { maxDepth });
    const limited = results.slice(0, limit);

    if (limited.length === 0) {
      return {
        content: [{ type: "text", text: `No upstream consumers found for "${nodeId}"` }],
      };
    }

    // Group by distance
    const byDistance = new Map<number, typeof limited>();
    for (const r of limited) {
      if (!byDistance.has(r.distance)) byDistance.set(r.distance, []);
      byDistance.get(r.distance)!.push(r);
    }

    // Count affected files
    const affectedFiles = new Set(limited.map((r) => r.target.filePath));

    const formatted = {
      totalAffected: results.length,
      shown: limited.length,
      affectedFiles: affectedFiles.size,
      byDistance: Object.fromEntries(
        Array.from(byDistance.entries()).map(([dist, items]) => [
          `depth_${dist}`,
          items.map((r) => ({
            name: r.target.name,
            kind: r.target.kind,
            file: r.target.filePath,
            line: r.target.startLine,
            impactScore: Math.round(r.impactScore * 1000) / 1000,
            pathLength: r.path.length,
          })),
        ])
      ),
    };

    return {
      content: [
        {
          type: "text",
          text: `Impact analysis: ${results.length} symbols affected across ${affectedFiles.size} files`,
        },
        { type: "json", data: formatted },
      ],
    };
  },
};
