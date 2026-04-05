import { Command } from "commander";
import { getRepoInfo, createStore, createToolContext } from "./shared.js";
import { MCPServer } from "@codeintel/server";

export const mcpCommand = new Command("mcp")
  .description("Start MCP stdio server for AI editor integration")
  .action(async () => {
    const repo = getRepoInfo();
    const store = await createStore(repo);
    const { ctx, registry } = createToolContext(store, repo);

    const server = new MCPServer(registry, ctx);
    await server.start();

    process.on("SIGINT", async () => {
      await server.close();
      await store.close();
      process.exit(0);
    });
  });
