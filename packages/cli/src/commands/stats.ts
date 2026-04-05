import { Command } from "commander";
import chalk from "chalk";
import { getRepoInfo, createStore } from "./shared.js";

export const statsCommand = new Command("stats")
  .description("Show graph statistics")
  .option("--json", "Output as JSON")
  .action(async (opts: Record<string, unknown>) => {
    const repo = getRepoInfo();
    let store;
    try {
      store = await createStore(repo);
    } catch (error) {
      console.error(chalk.red("Failed to open database:"), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

    try {
      const [nodeCount, edgeCount, communities, processes] = await Promise.all([
        store.getNodeCount(),
        store.getEdgeCount(),
        store.getCommunities(),
        store.getProcesses(),
      ]);

      const kindCounts = await store.query<{ kind: string; count: number }>(
        "SELECT kind, count(*) as count FROM nodes GROUP BY kind ORDER BY count DESC"
      );

      const edgeKindCounts = await store.query<{ kind: string; count: number }>(
        "SELECT kind, count(*) as count FROM edges GROUP BY kind ORDER BY count DESC"
      );

      const langCounts = await store.query<{ language: string; count: number }>(
        "SELECT language, count(*) as count FROM nodes WHERE kind = 'file' GROUP BY language ORDER BY count DESC"
      );

      if (opts.json) {
        console.log(JSON.stringify({
          nodes: nodeCount,
          edges: edgeCount,
          communities: communities.length,
          processes: processes.length,
          nodesByKind: Object.fromEntries(kindCounts.map((r) => [r.kind, r.count])),
          edgesByKind: Object.fromEntries(edgeKindCounts.map((r) => [r.kind, r.count])),
          languages: Object.fromEntries(langCounts.map((r) => [r.language, r.count])),
        }, null, 2));
        return;
      }

      console.log(chalk.bold("\nCodeIntelEngine Graph Statistics\n"));
      console.log(`  Nodes:        ${chalk.cyan(nodeCount)}`);
      console.log(`  Edges:        ${chalk.cyan(edgeCount)}`);
      console.log(`  Communities:  ${chalk.magenta(communities.length)}`);
      console.log(`  Processes:    ${chalk.blue(processes.length)}`);

      if (kindCounts.length > 0) {
        console.log(chalk.bold("\n  Nodes by kind:"));
        for (const { kind, count } of kindCounts) {
          console.log(`    ${kind.padEnd(14)} ${chalk.green(count)}`);
        }
      }

      if (edgeKindCounts.length > 0) {
        console.log(chalk.bold("\n  Edges by kind:"));
        for (const { kind, count } of edgeKindCounts) {
          console.log(`    ${kind.padEnd(14)} ${chalk.green(count)}`);
        }
      }

      if (langCounts.length > 0) {
        console.log(chalk.bold("\n  Languages:"));
        for (const { language, count } of langCounts) {
          console.log(`    ${language.padEnd(14)} ${chalk.green(count)} files`);
        }
      }

      console.log();
    } finally {
      await store.close();
    }
  });
