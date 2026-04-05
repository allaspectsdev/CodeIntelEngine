// ── Node Types ──────────────────────────────────────────

export type NodeKind =
  | "file"
  | "function"
  | "class"
  | "method"
  | "interface"
  | "type_alias"
  | "variable"
  | "constant"
  | "enum"
  | "module"
  | "namespace"
  | "property"
  | "parameter";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  contentHash: string;
  language: string;
  signature?: string;
  docstring?: string;
  exported: boolean;
  lastIndexed: number;
  communityId?: number;
  pageRank?: number;
  embedding?: Float64Array;
  metadata?: Record<string, unknown>;
}

// ── Edge Types ──────────────────────────────────────────

export type EdgeKind =
  | "calls"
  | "imports"
  | "exports"
  | "extends"
  | "implements"
  | "contains"
  | "type_of"
  | "returns"
  | "parameter_of"
  | "overrides"
  | "uses"
  | "member_of";

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  confidence: number;
  filePath?: string;
  line?: number;
  metadata?: Record<string, unknown>;
}

// ── Community ───────────────────────────────────────────

export interface Community {
  id: number;
  label: string;
  memberCount: number;
  cohesion: number;
}

// ── Process (execution flow) ────────────────────────────

export interface Process {
  id: string;
  name: string;
  entryPoint: string;
  steps: string[];       // ordered node IDs
  kind: "api_route" | "event_handler" | "scheduled" | "lifecycle" | "custom";
}

// ── Mutations ───────────────────────────────────────────

export type GraphMutation =
  | { op: "upsert_node"; node: GraphNode }
  | { op: "delete_node"; id: string }
  | { op: "upsert_edge"; edge: GraphEdge }
  | { op: "delete_edge"; id: string }
  | { op: "delete_edges_from"; source: string; kind?: EdgeKind }
  | { op: "delete_file_nodes"; filePath: string };

// ── Query results ───────────────────────────────────────

export interface QueryResult<T = GraphNode> {
  items: T[];
  totalCount: number;
  queryTimeMs: number;
}

// ── Repo info ───────────────────────────────────────────

export interface RepoInfo {
  rootPath: string;
  name: string;
  dbPath: string;
}

// ── Schema version ──────────────────────────────────────

export interface SchemaVersion {
  version: number;
  appliedAt: number;
}
