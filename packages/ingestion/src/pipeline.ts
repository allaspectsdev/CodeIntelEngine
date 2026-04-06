import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import { glob } from "glob";
import type { GraphStore, GraphMutation, GraphNode, GraphEdge } from "@codeintel/core";
import { RegexParser, type ParserBackend, type ParsedTree } from "./parsers/parser.js";
import { getSupportedExtensions, getLanguageForFile } from "./parsers/language-config.js";
import { extractSymbols, type ExtractedSymbol } from "./extractors/symbol-extractor.js";
import { extractImports, type ExtractedImport } from "./extractors/import-extractor.js";
import { resolveImports, resolveCallEdges } from "./resolvers/import-resolver.js";
import { detectCommunities } from "./enrichers/community-detection.js";
import { detectProcesses } from "./enrichers/process-detection.js";
import { computePageRank } from "./enrichers/pagerank.js";
import type { ProcessDetectionOptions } from "./enrichers/process-detection.js";

export interface PipelineOptions {
  parser?: ParserBackend;
  incremental?: boolean;
  enrichCommunities?: boolean;
  enrichProcesses?: boolean;
  enrichPageRank?: boolean;
  processOptions?: ProcessDetectionOptions;
  ignorePatterns?: string[];
  concurrency?: number;
  onProgress?: (event: ProgressEvent) => void;
}

export interface ProgressEvent {
  phase: "parse" | "extract" | "resolve" | "enrich" | "complete";
  current: number;
  total: number;
  filePath?: string;
}

export interface PipelineResult {
  filesProcessed: number;
  filesSkipped: number;
  nodesCreated: number;
  edgesCreated: number;
  communitiesDetected: number;
  processesDetected: number;
  elapsedMs: number;
}

const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.git/**",
  "**/vendor/**",
  "**/target/**",
  "**/__pycache__/**",
  "**/.venv/**",
  "**/coverage/**",
  "**/*.min.js",
  "**/*.bundle.js",
  "**/*.map",
];

/** Cached result from Phase 1 for reuse in Phase 2 */
interface FileParseResult {
  tree: ParsedTree;
  symbols: ExtractedSymbol[];
  imports: ExtractedImport[];
  nodeIds: string[];
}

/**
 * Streaming incremental ingestion pipeline.
 *
 * Unlike GitNexus (which builds the entire graph in memory then bulk-loads),
 * this pipeline writes nodes and edges to the DB as they are produced.
 * Files are processed with bounded concurrency using a work-stealing pool.
 */
export class IngestionPipeline {
  private store: GraphStore;
  private parser: ParserBackend;
  private opts: Required<
    Pick<PipelineOptions, "incremental" | "enrichCommunities" | "enrichProcesses" | "enrichPageRank" | "ignorePatterns" | "concurrency">
  > & Pick<PipelineOptions, "processOptions" | "onProgress">;

  constructor(store: GraphStore, opts?: PipelineOptions) {
    this.store = store;
    this.parser = opts?.parser ?? new RegexParser();
    this.opts = {
      incremental: opts?.incremental ?? true,
      enrichCommunities: opts?.enrichCommunities ?? true,
      enrichProcesses: opts?.enrichProcesses ?? true,
      enrichPageRank: opts?.enrichPageRank ?? true,
      ignorePatterns: opts?.ignorePatterns ?? DEFAULT_IGNORE,
      concurrency: Math.max(1, opts?.concurrency ?? 4),
      processOptions: opts?.processOptions,
      onProgress: opts?.onProgress,
    };
  }

  /**
   * Index an entire project directory.
   */
  async indexProject(projectRoot: string): Promise<PipelineResult> {
    const start = performance.now();
    await this.store.init();

    // Discover files
    const extensions = getSupportedExtensions();
    const patterns = extensions.map((ext) => `**/*${ext}`);
    const files = await glob(patterns, {
      cwd: projectRoot,
      ignore: this.opts.ignorePatterns,
      absolute: true,
      nodir: true,
    });

    const result: PipelineResult = {
      filesProcessed: 0,
      filesSkipped: 0,
      nodesCreated: 0,
      edgesCreated: 0,
      communitiesDetected: 0,
      processesDetected: 0,
      elapsedMs: 0,
    };

    // Phase 1: Parse, extract, and write nodes — with bounded concurrency.
    // Cache parsed trees + extracted imports for reuse in Phase 2.
    const fileCache = new Map<string, FileParseResult>();
    const fileIndex = new Map<string, string[]>();     // filePath -> nodeIds
    const symbolIndex = new Map<string, string[]>();   // symbolName -> nodeIds
    const allCallSites: Array<{
      callerNodeId: string;
      calleeName: string;
      line: number;
      qualifier?: string;
      filePath: string;
    }> = [];

    let completed = 0;
    await runWithConcurrency(files, this.opts.concurrency, async (filePath) => {
      completed++;
      this.opts.onProgress?.({
        phase: "parse",
        current: completed,
        total: files.length,
        filePath: relative(projectRoot, filePath),
      });

      const processed = await this.processFile(filePath, projectRoot);
      if (!processed) {
        result.filesSkipped++;
        return;
      }

      result.filesProcessed++;
      result.nodesCreated += processed.nodes.length;

      const nodeIds = processed.nodes.map((n) => n.id);
      fileIndex.set(filePath, nodeIds);

      // Cache the parsed tree and imports for Phase 2
      fileCache.set(filePath, {
        tree: processed.tree,
        symbols: processed.symbols,
        imports: processed.imports,
        nodeIds,
      });

      for (const symbol of processed.symbols) {
        const name = symbol.node.name;
        if (!symbolIndex.has(name)) symbolIndex.set(name, []);
        symbolIndex.get(name)!.push(symbol.node.id);

        for (const call of symbol.callSites) {
          allCallSites.push({ ...call, filePath });
        }
      }
    });

    // Phase 2: Resolve imports and calls — using cached results, no re-parsing
    this.opts.onProgress?.({
      phase: "resolve",
      current: 0,
      total: fileCache.size,
    });

    for (const [filePath, cached] of fileCache) {
      if (cached.imports.length === 0 || cached.nodeIds.length === 0) continue;

      const sourceNodeId = cached.nodeIds[0];
      const resolved = resolveImports(
        cached.imports, filePath, sourceNodeId, projectRoot, fileIndex
      );

      const importEdgeMutations: GraphMutation[] = [];
      for (const imp of resolved) {
        if (imp.resolvedPath !== null || imp.edge.target.startsWith("external::")) {
          importEdgeMutations.push({ op: "upsert_edge", edge: imp.edge });
          result.edgesCreated++;
        }
      }

      if (importEdgeMutations.length > 0) {
        await this.store.mutate(importEdgeMutations);
      }
    }

    // Resolve call edges
    const callEdges = resolveCallEdges(allCallSites, symbolIndex);
    if (callEdges.length > 0) {
      const callMutations: GraphMutation[] = callEdges.map((edge) => ({
        op: "upsert_edge" as const,
        edge,
      }));
      await this.store.mutate(callMutations);
      result.edgesCreated += callEdges.length;
    }

    // Free the cache — no longer needed
    fileCache.clear();

    // Phase 3: Enrichment
    if (this.opts.enrichPageRank) {
      this.opts.onProgress?.({ phase: "enrich", current: 1, total: 3 });
      await computePageRank(this.store);
    }

    if (this.opts.enrichCommunities) {
      this.opts.onProgress?.({ phase: "enrich", current: 2, total: 3 });
      const communities = await detectCommunities(this.store);
      result.communitiesDetected = communities.length;
    }

    if (this.opts.enrichProcesses) {
      this.opts.onProgress?.({ phase: "enrich", current: 3, total: 3 });
      const processes = await detectProcesses(this.store, this.opts.processOptions);
      result.processesDetected = processes.length;
    }

    result.elapsedMs = performance.now() - start;
    this.opts.onProgress?.({
      phase: "complete",
      current: result.filesProcessed,
      total: files.length,
    });

    return result;
  }

  /**
   * Incrementally re-index a single file.
   * Only re-processes if the file content has changed.
   */
  async indexFile(filePath: string, projectRoot: string): Promise<boolean> {
    const source = safeReadFile(filePath);
    if (!source) return false;

    const fileHash = createHash("sha256").update(source).digest("hex");

    if (this.opts.incremental) {
      const existing = await this.store.query<{ content_hash: string }>(
        "SELECT content_hash FROM nodes WHERE file_path = @filePath AND kind = 'file' LIMIT 1",
        { filePath }
      );
      if (existing.length > 0 && existing[0].content_hash === fileHash) {
        return false; // file unchanged, skip re-index
      }
    }

    // Delete existing nodes for this file (cascade deletes edges)
    await this.store.mutate([{ op: "delete_file_nodes", filePath }]);

    // Re-process
    await this.processFile(filePath, projectRoot);
    return true;
  }

  /**
   * Process a single file: parse, extract symbols + imports, write nodes to DB.
   * Returns the parsed tree and imports for reuse in the resolution phase.
   */
  private async processFile(
    filePath: string,
    projectRoot: string
  ): Promise<{
    nodes: GraphNode[];
    symbols: ExtractedSymbol[];
    tree: ParsedTree;
    imports: ExtractedImport[];
  } | null> {
    const source = safeReadFile(filePath);
    if (!source) return null;

    const tree = this.parser.parse(source, filePath);
    if (!tree) return null;

    const symbols = extractSymbols(tree, filePath);
    const imports = extractImports(tree);

    if (symbols.length === 0 && imports.length === 0) return null;

    // Create a file node
    const fileHash = createHash("sha256").update(source).digest("hex");
    const lang = getLanguageForFile(filePath);
    const fileNode: GraphNode = {
      id: filePath,
      kind: "file",
      name: relative(projectRoot, filePath),
      filePath,
      startLine: 1,
      endLine: source.split("\n").length,
      contentHash: fileHash,
      language: lang?.id ?? "unknown",
      exported: true,
      lastIndexed: Date.now(),
    };

    // Build mutations: file node + all symbol nodes + contains edges
    const mutations: GraphMutation[] = [
      { op: "upsert_node", node: fileNode },
    ];

    for (const symbol of symbols) {
      mutations.push({ op: "upsert_node", node: symbol.node });
      mutations.push({
        op: "upsert_edge",
        edge: {
          id: `${filePath}->contains->${symbol.node.id}`,
          source: filePath,
          target: symbol.node.id,
          kind: "contains",
          confidence: 1.0,
        },
      });
    }

    // Write to DB (streaming — not batching all files first)
    await this.store.mutate(mutations);

    return {
      nodes: [fileNode, ...symbols.map((s) => s.node)],
      symbols,
      tree,
      imports,
    };
  }
}

function safeReadFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Process items with bounded concurrency (p-limit pattern).
 * Runs up to `limit` tasks in parallel, starting the next as each completes.
 */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}
