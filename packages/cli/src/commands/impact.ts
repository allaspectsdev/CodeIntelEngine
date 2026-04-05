import { Command } from "commander";
import chalk from "chalk";
import { getRepoInfo, createStore, createToolContext } from "./shared.js";

export const impactCommand = new Command("impact")
  .description("Analyze the blast radius of changing a symbol")
  .argument("<symbol>", "Symbol name to analyze")
  .option("-d, --depth <n>", "Max traversal depth", "5")
  .option("-n, --limit <n>", "Max results", "30")
  .option("--json", "Output as JSON")
  .action(async (symbol: string, opts: Record<string, unknown>) => {
    const repo = getRepoInfo();
    let store;
    try {
      store = await createStore(repo);
    } catch (error) {
      console.error(chalk.red("Failed to open database:"), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

    try {
      const { queryEngine } = createToolContext(store, repo);

      const matches = await queryEngine.findByName(symbol);
      if (matches.length === 0) {
        console.log(chalk.yellow(`Symbol "${symbol}" not found`));
        return;
      }

      const target = matches[0];
      const maxDepth = parseInt(opts.depth as string) || 5;
      const limit = parseInt(opts.limit as string) || 30;

      const results = await queryEngine.impact(target.id, { maxDepth });
      const limited = results.slice(0, limit);

      if (opts.json) {
        console.log(JSON.stringify(limited, null, 2));
        return;
      }

      if (limited.length === 0) {
        console.log(chalk.green(`No upstream consumers found for "${symbol}"`));
        return;
      }

      const affectedFiles = new Set(limited.map((r) => r.target.filePath));
      console.log(
        chalk.bold(
          `Blast radius for ${chalk.cyan(symbol)}: ${results.length} symbols in ${affectedFiles.size} files\n`
        )
      );

      const groups = new Map<number, typeof limited>();
      for (const r of limited) {
        if (!groups.has(r.distance)) groups.set(r.distance, []);
        groups.get(r.distance)!.push(r);
      }

      for (const [dist, items] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
        console.log(chalk.bold.dim(`\n  Distance ${dist}:`));
        for (const item of items) {
          const score = chalk.dim(`(impact: ${item.impactScore.toFixed(3)})`);
          console.log(
            `    ${chalk.yellow(item.target.kind.padEnd(12))} ${chalk.white(item.target.name)} ${chalk.dim(item.target.filePath + ":" + item.target.startLine)} ${score}`
          );
        }
      }
    } finally {
      await store.close();
    }
  });
