import { resolve, join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { GraphStore, type RepoInfo } from "@codeintel/core";
import { QueryEngine } from "@codeintel/query";
import { createDefaultRegistry, type ToolContext, type ToolRegistry } from "@codeintel/tools";

const CODEINTEL_DIR = ".codeintel";
const DB_FILE = "graph.db";

export function getRepoInfo(rootPath?: string): RepoInfo {
  const root = resolve(rootPath ?? process.cwd());
  const codeintelDir = join(root, CODEINTEL_DIR);
  const dbPath = join(codeintelDir, DB_FILE);

  return {
    rootPath: root,
    name: root.split("/").pop() ?? "unknown",
    dbPath,
  };
}

export function ensureInitialized(repo: RepoInfo): void {
  const codeintelDir = resolve(repo.rootPath, CODEINTEL_DIR);
  if (!existsSync(codeintelDir)) {
    mkdirSync(codeintelDir, { recursive: true });
  }
}

export async function createStore(repo: RepoInfo): Promise<GraphStore> {
  ensureInitialized(repo);
  const store = new GraphStore(repo.dbPath);
  await store.init();
  return store;
}

export function createToolContext(store: GraphStore, repo: RepoInfo): {
  ctx: ToolContext;
  registry: ToolRegistry;
  queryEngine: QueryEngine;
} {
  const queryEngine = new QueryEngine(store);
  const registry = createDefaultRegistry();
  const ctx: ToolContext = { store, query: queryEngine, repo };
  return { ctx, registry, queryEngine };
}
