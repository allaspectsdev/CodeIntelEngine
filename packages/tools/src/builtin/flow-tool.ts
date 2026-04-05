import type { ToolPlugin, ToolContext, ToolResult } from "../types.js";

export const flowTool: ToolPlugin = {
  name: "flow",
  description:
    "Trace execution flow from a starting symbol. Shows the call chain " +
    "in execution order, useful for understanding what happens when a " +
    "function is invoked.",
  inputSchema: {
    type: "object",
    properties: {
      nodeId: {
        type: "string",
        description: "ID of the starting symbol",
      },
      name: {
        type: "string",
        description: "Symbol name to look up (if nodeId not provided)",
      },
      maxDepth: {
        type: "number",
        description: "Maximum call chain depth (default: 10)",
        default: 10,
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

    const maxDepth = Math.min((args.maxDepth as number) ?? 10, 50);
    const steps = await ctx.query.traceFlow(nodeId, { maxDepth });

    if (steps.length === 0) {
      return {
        content: [{ type: "text", text: `No flow found starting from "${nodeId}"` }],
      };
    }

    const formatted = steps.map((step) => ({
      depth: step.depth,
      indent: "  ".repeat(step.depth) + "→ ",
      name: step.node.name,
      kind: step.node.kind,
      file: step.node.filePath,
      line: step.node.startLine,
      signature: step.node.signature,
      edgeKind: step.edge?.kind,
    }));

    // Also format as a readable tree
    const treeLines = formatted.map(
      (f) => `${f.indent}${f.name} (${f.kind}) — ${f.file}:${f.line}`
    );

    return {
      content: [
        { type: "text", text: `Execution flow (${steps.length} steps):\n${treeLines.join("\n")}` },
        { type: "json", data: formatted },
      ],
    };
  },
};
