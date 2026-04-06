export { ToolRegistry } from "./registry.js";
export type {
  ToolPlugin,
  ToolContext,
  ToolResult,
  ToolContent,
  ToolDefinition,
  JSONSchema,
} from "./types.js";

// Built-in tools
export { queryTool } from "./builtin/query-tool.js";
export { contextTool } from "./builtin/context-tool.js";
export { impactTool } from "./builtin/impact-tool.js";
export { renameTool } from "./builtin/rename-tool.js";
export { detectChangesTool } from "./builtin/detect-changes-tool.js";
export { sqlTool } from "./builtin/cypher-tool.js";
export { flowTool } from "./builtin/flow-tool.js";

import { ToolRegistry } from "./registry.js";
import { queryTool } from "./builtin/query-tool.js";
import { contextTool } from "./builtin/context-tool.js";
import { impactTool } from "./builtin/impact-tool.js";
import { renameTool } from "./builtin/rename-tool.js";
import { detectChangesTool } from "./builtin/detect-changes-tool.js";
import { sqlTool } from "./builtin/cypher-tool.js";
import { flowTool } from "./builtin/flow-tool.js";

/**
 * Create a ToolRegistry pre-loaded with all built-in tools.
 */
export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(queryTool);
  registry.register(contextTool);
  registry.register(impactTool);
  registry.register(renameTool);
  registry.register(detectChangesTool);
  registry.register(sqlTool);
  registry.register(flowTool);
  return registry;
}
