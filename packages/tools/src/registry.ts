import type { ToolPlugin, ToolContext, ToolResult, ToolDefinition } from "./types.js";

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
