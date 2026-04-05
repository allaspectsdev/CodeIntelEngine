import { Command } from "commander";
import ora from "ora";
import chalk from "chalk";
import { IngestionPipeline } from "@codeintel/ingestion";
import { getRepoInfo, createStore } from "./shared.js";

export const analyzeCommand = new Command("analyze")
  .description("Index the codebase (full or incremental)")
  .argument("[path]", "Project root path", ".")
  .option("--full", "Force full re-index (ignore incremental cache)")
  .option("--no-communities", "Skip community detection")
  .option("--no-processes", "Skip process detection")
  .option("--no-pagerank", "Skip PageRank computation")
  .option("--concurrency <n>", "Number of parallel workers", "4")
  .action(async (path: string, opts: Record<string, unknown>) => {
    const repo = getRepoInfo(path);
    const store = await createStore(repo);

    const spinner = ora("Analyzing codebase...").start();
    let lastPhase = "";

    const pipeline = new IngestionPipeline(store, {
      incremental: !opts.full,
      enrichCommunities: opts.communities !== false,
      enrichProcesses: opts.processes !== false,
      enrichPageRank: opts.pagerank !== false,
      concurrency: parseInt(opts.concurrency as string) || 4,
      onProgress: (event) => {
        if (event.phase !== lastPhase) {
          lastPhase = event.phase;
          switch (event.phase) {
            case "parse":
              spinner.text = `Parsing files... (${event.current}/${event.total})`;
              break;
            case "resolve":
              spinner.text = "Resolving imports and calls...";
              break;
            case "enrich":
              spinner.text = "Enriching graph (communities, processes, PageRank)...";
              break;
            case "complete":
              break;
          }
        } else if (event.phase === "parse") {
          spinner.text = `Parsing ${event.filePath ?? ""}... (${event.current}/${event.total})`;
        }
      },
    });

    try {
      const result = await pipeline.indexProject(repo.rootPath);

      spinner.succeed("Analysis complete");
      console.log();
      console.log(chalk.bold("Results:"));
      console.log(`  Files processed:  ${chalk.cyan(result.filesProcessed)}`);
      console.log(`  Files skipped:    ${chalk.dim(result.filesSkipped)}`);
      console.log(`  Nodes created:    ${chalk.green(result.nodesCreated)}`);
      console.log(`  Edges created:    ${chalk.green(result.edgesCreated)}`);
      console.log(`  Communities:      ${chalk.magenta(result.communitiesDetected)}`);
      console.log(`  Processes:        ${chalk.blue(result.processesDetected)}`);
      console.log(`  Time:             ${chalk.yellow((result.elapsedMs / 1000).toFixed(2) + "s")}`);
    } catch (error) {
      spinner.fail("Analysis failed");
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    } finally {
      await store.close();
    }
  });
