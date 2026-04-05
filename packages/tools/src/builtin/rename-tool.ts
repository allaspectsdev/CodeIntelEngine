import type { ToolPlugin, ToolContext, ToolResult } from "../types.js";

export const renameTool: ToolPlugin = {
  name: "rename",
  description:
    "Preview the impact of renaming a symbol. Shows all locations where " +
    "the symbol is referenced, across files and edge types.",
  inputSchema: {
    type: "object",
    properties: {
      nodeId: {
        type: "string",
        description: "ID of the symbol to rename",
      },
      name: {
        type: "string",
        description: "Current symbol name (if nodeId not provided)",
      },
      newName: {
        type: "string",
        description: "Proposed new name for the symbol",
      },
    },
    required: ["newName"],
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    let nodeId = args.nodeId as string | undefined;
    const newName = args.newName as string;

    if (!nodeId && args.name) {
      const matches = await ctx.query.findByName(args.name as string);
      if (matches.length === 0) {
        return {
          content: [{ type: "text", text: `Symbol "${args.name}" not found` }],
        };
      }
      // If multiple matches, list them
      if (matches.length > 1) {
        return {
          content: [
            { type: "text", text: `Multiple symbols named "${args.name}" found:` },
            {
              type: "json",
              data: matches.map((m) => ({
                id: m.id,
                kind: m.kind,
                file: m.filePath,
                line: m.startLine,
              })),
            },
          ],
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

    const node = await ctx.store.getNode(nodeId);
    if (!node) {
      return {
        content: [{ type: "text", text: `Node "${nodeId}" not found` }],
      };
    }

    // Find all references: edges pointing TO this node
    const inEdges = await ctx.store.getEdgesTo(nodeId);
    // Also find containing relationships
    const containEdges = await ctx.store.getEdgesTo(nodeId, "contains");

    const references = inEdges.map((e) => ({
      from: e.source,
      kind: e.kind,
      file: e.filePath,
      line: e.line,
    }));

    const affectedFiles = new Set(
      [...inEdges, ...containEdges]
        .map((e) => e.filePath)
        .filter((f): f is string => f !== undefined)
    );
    affectedFiles.add(node.filePath);

    // Check for naming conflicts
    const existing = await ctx.query.findByName(newName);
    const conflicts = existing.filter((n) => n.id !== nodeId);

    return {
      content: [
        {
          type: "text",
          text: `Rename "${node.name}" → "${newName}" in ${node.filePath}:${node.startLine}`,
        },
        {
          type: "json",
          data: {
            symbol: {
              id: node.id,
              kind: node.kind,
              currentName: node.name,
              newName,
              file: node.filePath,
              line: node.startLine,
            },
            references: references.length,
            affectedFiles: Array.from(affectedFiles),
            referenceDetails: references,
            conflicts: conflicts.length > 0
              ? conflicts.map((c) => ({
                  name: c.name,
                  kind: c.kind,
                  file: c.filePath,
                  line: c.startLine,
                }))
              : null,
            warning: conflicts.length > 0
              ? `Name "${newName}" already exists in ${conflicts.length} location(s)`
              : null,
          },
        },
      ],
    };
  },
};
