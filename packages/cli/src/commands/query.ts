import { Command } from "commander";
import chalk from "chalk";
import { getRepoInfo, createStore, createToolContext } from "./shared.js";
import { formatNode, formatScore } from "../output/formatter.js";

export const queryCommand = new Command("query")
  .description("Search the codebase knowledge graph")
  .argument("<text>", "Search query")
  .option("-k, --kind <kind>", "Filter by symbol kind")
  .option("-f, --file <path>", "Filter by file path prefix")
  .option("-n, --limit <n>", "Max results", "20")
  .option("--json", "Output as JSON")
  .action(async (text: string, opts: Record<string, unknown>) => {
    const repo = getRepoInfo();
    const store = await createStore(repo);
    const { queryEngine } = createToolContext(store, repo);

    try {
      const results = await queryEngine.query(text, {
        limit: parseInt(opts.limit as string) || 20,
        kind: opts.kind as any,
        filePath: opts.file as string | undefined,
      });

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log(chalk.yellow(`No results for "${text}"`));
        return;
      }

      console.log(chalk.bold(`${results.length} results for "${text}":\n`));

      for (const [i, result] of results.entries()) {
        const rank = chalk.dim(`${(i + 1).toString().padStart(3)}.`);
        console.log(`${rank} ${formatNode(result.node)}`);
        console.log(`     Score: ${formatScore(result.score)}`);
      }
    } finally {
      await store.close();
    }
  });
