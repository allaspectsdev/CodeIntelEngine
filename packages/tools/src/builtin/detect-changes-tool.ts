import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { ToolPlugin, ToolContext, ToolResult } from "../types.js";

export const detectChangesTool: ToolPlugin = {
  name: "detect_changes",
  description:
    "Detect what changed since a given git ref and map changes to graph nodes. " +
    "Shows which symbols were added, modified, or deleted.",
  inputSchema: {
    type: "object",
    properties: {
      since: {
        type: "string",
        description: "Git ref to compare against (default: HEAD~1)",
        default: "HEAD~1",
      },
      includeImpact: {
        type: "boolean",
        description: "Also show downstream impact of changes (default: false)",
        default: false,
      },
    },
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const since = (args.since as string) ?? "HEAD~1";
    const includeImpact = (args.includeImpact as boolean) ?? false;

    let diffOutput: string;
    try {
      diffOutput = execFileSync("git", ["diff", "--name-status", since], {
        cwd: ctx.repo.rootPath,
        encoding: "utf-8",
        timeout: 10_000,
      });
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to get git diff: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }

    const changes: Array<{
      status: "added" | "modified" | "deleted" | "renamed";
      filePath: string;
      oldPath?: string;
    }> = [];

    for (const line of diffOutput.trim().split("\n")) {
      if (!line) continue;
      const parts = line.split("\t");
      const status = parts[0];
      const filePath = parts[parts.length - 1];

      if (status.startsWith("A")) {
        changes.push({ status: "added", filePath });
      } else if (status.startsWith("M")) {
        changes.push({ status: "modified", filePath });
      } else if (status.startsWith("D")) {
        changes.push({ status: "deleted", filePath });
      } else if (status.startsWith("R")) {
        changes.push({ status: "renamed", filePath, oldPath: parts[1] });
      }
    }

    // Map changed files to graph nodes
    const changedNodes: Array<{
      file: string;
      status: string;
      symbols: Array<{ name: string; kind: string; line: number }>;
    }> = [];

    for (const change of changes) {
      const fullPath = join(ctx.repo.rootPath, change.filePath);
      const nodes = await ctx.store.getNodesByFile(fullPath);

      changedNodes.push({
        file: change.filePath,
        status: change.status,
        symbols: nodes
          .filter((n) => n.kind !== "file")
          .map((n) => ({
            name: n.name,
            kind: n.kind,
            line: n.startLine,
          })),
      });
    }

    // Optionally compute impact
    let impactSummary: unknown = null;
    if (includeImpact) {
      const allImpacted = new Set<string>();
      for (const change of changedNodes) {
        const fullPath = join(ctx.repo.rootPath, change.file);
        const nodes = await ctx.store.getNodesByFile(fullPath);
        for (const node of nodes) {
          const impact = await ctx.query.impact(node.id, { maxDepth: 3 });
          for (const r of impact) {
            allImpacted.add(r.target.filePath);
          }
        }
      }

      impactSummary = {
        totalFilesImpacted: allImpacted.size,
        files: Array.from(allImpacted),
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `${changes.length} files changed since ${since}`,
        },
        {
          type: "json",
          data: {
            since,
            changes: changedNodes,
            impact: impactSummary,
          },
        },
      ],
    };
  },
};
