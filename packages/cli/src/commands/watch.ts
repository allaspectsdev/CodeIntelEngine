import { Command } from "commander";
import chalk from "chalk";
import { getRepoInfo, createStore } from "./shared.js";
import { FileWatcher } from "@codeintel/ingestion";

export const watchCommand = new Command("watch")
  .description("Watch for file changes and incrementally re-index")
  .option("--debounce <ms>", "Debounce interval in milliseconds", "500")
  .action(async (opts: Record<string, unknown>) => {
    const repo = getRepoInfo();
    let store;
    try {
      store = await createStore(repo);
    } catch (error) {
      console.error(chalk.red("Failed to open database:"), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

    const debounceMs = parseInt(opts.debounce as string) || 500;
    const watcher = new FileWatcher(store, repo.rootPath, { debounceMs });

    watcher.on("started", () => {
      console.log(chalk.green("Watching for changes in"), chalk.bold(repo.rootPath));
      console.log(chalk.dim(`Debounce: ${debounceMs}ms`));
      console.log(chalk.dim("Press Ctrl+C to stop\n"));
    });

    watcher.on("fileProcessed", (event: { type: string; filePath: string; reindexed: boolean }) => {
      const icon = event.type === "unlink" ? chalk.red("−") :
                   event.type === "add" ? chalk.green("+") : chalk.yellow("~");
      const status = event.reindexed ? chalk.green("indexed") : chalk.dim("skipped");
      console.log(`${icon} ${chalk.dim(event.filePath)} [${status}]`);
    });

    watcher.on("error", (error: Error) => {
      console.error(chalk.red("Watch error:"), error.message);
    });

    await watcher.start();

    process.on("SIGINT", async () => {
      console.log(chalk.dim("\nStopping watcher..."));
      await watcher.stop();
      await store.close();
      process.exit(0);
    });
  });
