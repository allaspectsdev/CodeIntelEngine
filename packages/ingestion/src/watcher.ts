import { watch, type FSWatcher } from "chokidar";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { GraphStore } from "@codeintel/core";
import { IngestionPipeline, type PipelineOptions } from "./pipeline.js";
import { getSupportedExtensions } from "./parsers/language-config.js";

export interface WatcherOptions extends PipelineOptions {
  debounceMs?: number;
}

export interface WatcherEvent {
  type: "add" | "change" | "unlink";
  filePath: string;
  reindexed: boolean;
}

/**
 * File watcher that triggers incremental re-indexing on file changes.
 *
 * Uses chokidar for reliable cross-platform file watching, with a
 * debounce to avoid re-indexing on every keystroke.
 */
export class FileWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private pipeline: IngestionPipeline;
  private projectRoot: string;
  private store: GraphStore;
  private debounceMs: number;
  private pendingFiles = new Map<string, ReturnType<typeof setTimeout>>();
  private running = false;

  constructor(
    store: GraphStore,
    projectRoot: string,
    opts?: WatcherOptions
  ) {
    super();
    this.store = store;
    this.projectRoot = projectRoot;
    this.debounceMs = opts?.debounceMs ?? 500;
    this.pipeline = new IngestionPipeline(store, {
      ...opts,
      incremental: true,
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const extensions = getSupportedExtensions();
    const globs = extensions.map((ext) => `**/*${ext}`);

    this.watcher = watch(globs, {
      cwd: this.projectRoot,
      ignored: [
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**",
        "**/.git/**",
        "**/vendor/**",
        "**/target/**",
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    this.watcher.on("add", (path) => this.handleFileEvent("add", path));
    this.watcher.on("change", (path) => this.handleFileEvent("change", path));
    this.watcher.on("unlink", (path) => this.handleFileEvent("unlink", path));

    this.watcher.on("error", (error) => {
      this.emit("error", error);
    });

    this.emit("started");
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    // Clear pending debounces
    for (const timeout of this.pendingFiles.values()) {
      clearTimeout(timeout);
    }
    this.pendingFiles.clear();

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    this.emit("stopped");
  }

  private handleFileEvent(type: "add" | "change" | "unlink", relativePath: string): void {
    const fullPath = join(this.projectRoot, relativePath);

    // Clear existing debounce for this file
    const existing = this.pendingFiles.get(fullPath);
    if (existing) clearTimeout(existing);

    // Debounce
    const timeout = setTimeout(async () => {
      this.pendingFiles.delete(fullPath);

      try {
        let reindexed = false;

        if (type === "unlink") {
          // File deleted: remove its nodes from the graph
          await this.store.mutate([{ op: "delete_file_nodes", filePath: fullPath }]);
          reindexed = true;
        } else {
          // File added or changed: re-index it
          reindexed = await this.pipeline.indexFile(fullPath, this.projectRoot);
        }

        const event: WatcherEvent = { type, filePath: fullPath, reindexed };
        this.emit("fileProcessed", event);
      } catch (error) {
        this.emit("error", error);
      }
    }, this.debounceMs);

    this.pendingFiles.set(fullPath, timeout);
  }
}
