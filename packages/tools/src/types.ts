import type { GraphStore, RepoInfo } from "@codeintel/core";
import type { QueryEngine } from "@codeintel/query";

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema & { description?: string }>;
  required?: string[];
  items?: JSONSchema;
  enum?: string[];
  description?: string;
  default?: unknown;
  [key: string]: unknown;
}

export interface ToolPlugin {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  store: GraphStore;
  query: QueryEngine;
  repo: RepoInfo;
}

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

export type ToolContent =
  | { type: "text"; text: string }
  | { type: "json"; data: unknown }
  | { type: "code"; code: string; language?: string };

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
}
