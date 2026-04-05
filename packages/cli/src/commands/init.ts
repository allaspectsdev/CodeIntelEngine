import { Command } from "commander";
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import chalk from "chalk";

export const initCommand = new Command("init")
  .description("Initialize CodeIntelEngine in the current repository")
  .argument("[path]", "Project root path", ".")
  .action(async (path: string) => {
    const root = resolve(path);
    const codeintelDir = join(root, ".codeintel");

    if (existsSync(codeintelDir)) {
      console.log(chalk.yellow("CodeIntelEngine is already initialized in this directory."));
      return;
    }

    mkdirSync(codeintelDir, { recursive: true });

    // Write default config
    const config = {
      version: 1,
      ignore: [
        "node_modules/**",
        "dist/**",
        "build/**",
        ".git/**",
        "vendor/**",
        "target/**",
        "__pycache__/**",
        ".venv/**",
      ],
      enrichment: {
        communities: true,
        processes: true,
        pageRank: true,
      },
      watch: {
        debounceMs: 500,
      },
    };

    writeFileSync(
      join(codeintelDir, "config.json"),
      JSON.stringify(config, null, 2) + "\n"
    );

    // Add .codeintel to .gitignore if not already present
    const gitignorePath = join(root, ".gitignore");
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, "utf-8");
      if (!content.includes(".codeintel")) {
        appendFileSync(gitignorePath, "\n.codeintel/\n");
        console.log(chalk.dim("Added .codeintel/ to .gitignore"));
      }
    }

    console.log(chalk.green("Initialized CodeIntelEngine in"), chalk.bold(root));
    console.log(chalk.dim("Run"), chalk.cyan("codeintel analyze"), chalk.dim("to index your codebase."));
  });
