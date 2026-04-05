import type { GraphStore, Process, GraphEdge } from "@codeintel/core";

export interface ProcessDetectionOptions {
  entryPoints?: EntryPointPattern[];
  maxSteps?: number;
  strategy?: "bfs" | "dfs" | "hybrid";
}

export interface EntryPointPattern {
  kind: Process["kind"];
  namePattern?: RegExp;
  nodeKindFilter?: string[];
  decoratorPattern?: RegExp;
}

const DEFAULT_ENTRY_PATTERNS: EntryPointPattern[] = [
  // Express/Koa/Fastify route handlers
  {
    kind: "api_route",
    namePattern: /^(get|post|put|patch|delete|head|options|handle|route)/i,
  },
  // Event handlers
  {
    kind: "event_handler",
    namePattern: /^(on[A-Z]|handle[A-Z]|emit|dispatch|listen|subscribe)/,
  },
  // Lifecycle hooks
  {
    kind: "lifecycle",
    namePattern: /^(init|setup|teardown|destroy|mount|unmount|ngOnInit|componentDidMount|useEffect|created|beforeCreate)/,
  },
  // Main / entry
  {
    kind: "lifecycle",
    namePattern: /^(main|run|start|bootstrap|execute)$/,
  },
  // Scheduled tasks
  {
    kind: "scheduled",
    namePattern: /^(cron|schedule|job|task|worker|process)/i,
  },
];

/**
 * Detects execution flow "processes" in the code graph.
 *
 * A process is a chain of function calls starting from an entry point
 * (API handler, event listener, lifecycle hook, etc.) traced through
 * the call graph.
 *
 * Uses a hybrid BFS+DFS strategy:
 * - BFS to find all reachable nodes within depth limit
 * - DFS to extract linear call chains (ordered execution paths)
 */
export async function detectProcesses(
  store: GraphStore,
  opts?: ProcessDetectionOptions
): Promise<Process[]> {
  const maxSteps = opts?.maxSteps ?? 100;
  const strategy = opts?.strategy ?? "hybrid";
  const patterns = opts?.entryPoints ?? DEFAULT_ENTRY_PATTERNS;

  // Find entry point nodes
  const allNodes = await store.query<{ id: string; name: string; kind: string }>(
    "SELECT id, name, kind FROM nodes WHERE kind IN ('function', 'method')"
  );

  const entryPoints: Array<{ nodeId: string; processKind: Process["kind"] }> = [];

  for (const node of allNodes) {
    for (const pattern of patterns) {
      if (pattern.namePattern && pattern.namePattern.test(node.name)) {
        if (!pattern.nodeKindFilter || pattern.nodeKindFilter.includes(node.kind)) {
          entryPoints.push({ nodeId: node.id, processKind: pattern.kind });
          break; // only match first pattern
        }
      }
    }
  }

  // Trace call chains from each entry point
  const processes: Process[] = [];

  for (const entry of entryPoints) {
    const steps = await traceCallChain(store, entry.nodeId, maxSteps, strategy);
    if (steps.length < 2) continue; // need at least entry + one call

    const name = entry.nodeId.split("::")[2] ?? entry.nodeId;

    processes.push({
      id: `process::${entry.nodeId}`,
      name,
      entryPoint: entry.nodeId,
      steps,
      kind: entry.processKind,
    });

    await store.upsertProcess({
      id: `process::${entry.nodeId}`,
      name,
      entryPoint: entry.nodeId,
      steps,
      kind: entry.processKind,
    });
  }

  return processes;
}

async function traceCallChain(
  store: GraphStore,
  startId: string,
  maxSteps: number,
  strategy: "bfs" | "dfs" | "hybrid"
): Promise<string[]> {
  if (strategy === "bfs") {
    return traceBFS(store, startId, maxSteps);
  } else if (strategy === "dfs") {
    return traceDFS(store, startId, maxSteps);
  } else {
    // Hybrid: use BFS to discover reachable set, then DFS to order
    return traceHybrid(store, startId, maxSteps);
  }
}

async function traceBFS(
  store: GraphStore,
  startId: string,
  maxSteps: number
): Promise<string[]> {
  const visited = new Set<string>();
  const order: string[] = [];
  const queue = [startId];

  while (queue.length > 0 && order.length < maxSteps) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    order.push(current);

    const edges = await store.getEdgesFrom(current, "calls");
    for (const edge of edges) {
      if (!visited.has(edge.target)) {
        queue.push(edge.target);
      }
    }
  }

  return order;
}

async function traceDFS(
  store: GraphStore,
  startId: string,
  maxSteps: number
): Promise<string[]> {
  const visited = new Set<string>();
  const order: string[] = [];

  async function dfs(nodeId: string): Promise<void> {
    if (visited.has(nodeId) || order.length >= maxSteps) return;
    visited.add(nodeId);
    order.push(nodeId);

    const edges = await store.getEdgesFrom(nodeId, "calls");
    // Sort by line number for deterministic ordering
    edges.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));

    for (const edge of edges) {
      await dfs(edge.target);
    }
  }

  await dfs(startId);
  return order;
}

async function traceHybrid(
  store: GraphStore,
  startId: string,
  maxSteps: number
): Promise<string[]> {
  // Phase 1: BFS to find reachable set (bounded)
  const reachable = new Set<string>();
  const bfsQueue = [startId];
  while (bfsQueue.length > 0 && reachable.size < maxSteps) {
    const current = bfsQueue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);

    const edges = await store.getEdgesFrom(current, "calls");
    for (const edge of edges) {
      if (!reachable.has(edge.target)) {
        bfsQueue.push(edge.target);
      }
    }
  }

  // Phase 2: DFS within the reachable set for linear ordering
  const visited = new Set<string>();
  const order: string[] = [];

  async function dfs(nodeId: string): Promise<void> {
    if (visited.has(nodeId) || !reachable.has(nodeId)) return;
    visited.add(nodeId);
    order.push(nodeId);

    const edges = await store.getEdgesFrom(nodeId, "calls");
    edges.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));

    for (const edge of edges) {
      await dfs(edge.target);
    }
  }

  await dfs(startId);
  return order;
}
