#!/usr/bin/env node

import { Command } from "commander";
import { analyzeCommand } from "./commands/analyze.js";
import { queryCommand } from "./commands/query.js";
import { impactCommand } from "./commands/impact.js";
import { serveCommand } from "./commands/serve.js";
import { mcpCommand } from "./commands/mcp.js";
import { watchCommand } from "./commands/watch.js";
import { initCommand } from "./commands/init.js";
import { statsCommand } from "./commands/stats.js";

const program = new Command();

program
  .name("codeintel")
  .description("CodeIntelEngine — deep, queryable knowledge graphs from your repositories")
  .version("0.1.0");

program.addCommand(initCommand);
program.addCommand(analyzeCommand);
program.addCommand(queryCommand);
program.addCommand(impactCommand);
program.addCommand(watchCommand);
program.addCommand(serveCommand);
program.addCommand(mcpCommand);
program.addCommand(statsCommand);

program.parse();
