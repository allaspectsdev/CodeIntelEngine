import { Command } from "commander";
import chalk from "chalk";
import { getRepoInfo, createStore, createToolContext } from "./shared.js";
import { HttpServer } from "@codeintel/server";

export const serveCommand = new Command("serve")
  .description("Start HTTP server with REST API and WebSocket")
  .option("-p, --port <port>", "Port number", "3100")
  .option("-h, --host <host>", "Host to bind to", "localhost")
  .action(async (opts: Record<string, unknown>) => {
    const repo = getRepoInfo();
    const store = await createStore(repo);
    const { ctx, registry } = createToolContext(store, repo);

    const port = parseInt(opts.port as string) || 3100;
    const host = (opts.host as string) ?? "localhost";

    const server = new HttpServer(registry, ctx, { port, host });
    await server.start();

    console.log(chalk.green("CodeIntelEngine server running at"), chalk.bold(server.address));
    console.log(chalk.dim("  REST API:    "), chalk.cyan(`${server.address}/api/tools`));
    console.log(chalk.dim("  WebSocket:   "), chalk.cyan(`ws://${host}:${port}`));
    console.log(chalk.dim("  Health:      "), chalk.cyan(`${server.address}/health`));
    console.log();
    console.log(chalk.dim("Press Ctrl+C to stop"));

    process.on("SIGINT", async () => {
      console.log(chalk.dim("\nShutting down..."));
      await server.close();
      await store.close();
      process.exit(0);
    });
  });
