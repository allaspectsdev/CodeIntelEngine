import type { ToolPlugin, ToolContext, ToolResult, ToolDefinition, JSONSchema } from "./types.js";

/**
 * Tool plugin registry.
 *
 * Manages registration and execution of tool plugins.
 * Built-in tools register at startup; third-party plugins can be added dynamically.
 */
export class ToolRegistry {
  private plugins = new Map<string, ToolPlugin>();

  register(plugin: ToolPlugin): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Tool "${plugin.name}" is already registered`);
    }
    this.plugins.set(plugin.name, plugin);
  }

  unregister(name: string): boolean {
    return this.plugins.delete(name);
  }

  get(name: string): ToolPlugin | undefined {
    return this.plugins.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.plugins.values()).map((p) => ({
      name: p.name,
      description: p.description,
      inputSchema: p.inputSchema,
    }));
  }

  has(name: string): boolean {
    return this.plugins.has(name);
  }

  get size(): number {
    return this.plugins.size;
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      return {
        content: [{ type: "text", text: `Unknown tool: "${name}"` }],
        isError: true,
      };
    }

    // Validate required fields and basic types against the input schema
    const validationError = validateArgs(args, plugin.inputSchema, plugin.name);
    if (validationError) {
      return validationError;
    }

    try {
      return await plugin.execute(args, ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Tool "${name}" failed: ${message}` }],
        isError: true,
      };
    }
  }
}

/**
 * Lightweight runtime validation of tool arguments against the input schema.
 * Checks required fields exist and values match declared types.
 * Returns a ToolResult error if validation fails, null if valid.
 */
function validateArgs(
  args: Record<string, unknown>,
  schema: JSONSchema,
  toolName: string
): ToolResult | null {
  if (schema.type !== "object") return null;

  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (args[field] === undefined || args[field] === null) {
        return {
          content: [{ type: "text", text: `Tool "${toolName}": missing required argument "${field}"` }],
          isError: true,
        };
      }
    }
  }

  // Check types for provided fields
  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      const value = args[key];
      if (value === undefined || value === null) continue;

      const expectedType = propSchema.type;
      if (!expectedType) continue;

      const actualType = typeof value;
      let valid = false;

      switch (expectedType) {
        case "string":
          valid = actualType === "string";
          break;
        case "number":
        case "integer":
          valid = actualType === "number" && !Number.isNaN(value);
          break;
        case "boolean":
          valid = actualType === "boolean";
          break;
        case "array":
          valid = Array.isArray(value);
          break;
        case "object":
          valid = actualType === "object" && !Array.isArray(value);
          break;
        default:
          valid = true; // unknown type, skip validation
      }

      if (!valid) {
        return {
          content: [{
            type: "text",
            text: `Tool "${toolName}": argument "${key}" must be ${expectedType}, got ${actualType}`,
          }],
          isError: true,
        };
      }

      // Check enum constraint
      if (propSchema.enum && !propSchema.enum.includes(value as string)) {
        return {
          content: [{
            type: "text",
            text: `Tool "${toolName}": argument "${key}" must be one of [${propSchema.enum.join(", ")}], got "${value}"`,
          }],
          isError: true,
        };
      }
    }
  }

  return null;
}
