import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ToolRegistry, ToolContext } from "@codeintel/tools";

export interface MCPServerOptions {
  name?: string;
  version?: string;
}

/**
 * MCP server that exposes CodeIntelEngine tools via stdio transport.
 *
 * This is a thin adapter over the ToolRegistry — no tool logic lives here.
 * The server simply translates MCP protocol messages into ToolRegistry calls.
 */
export class MCPServer {
  private server: Server;
  private registry: ToolRegistry;
  private ctx: ToolContext;

  constructor(registry: ToolRegistry, ctx: ToolContext, opts?: MCPServerOptions) {
    this.registry = registry;
    this.ctx = ctx;

    this.server = new Server(
      {
        name: opts?.name ?? "codeintel",
        version: opts?.version ?? "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = this.registry.list();
      return {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, unknown>,
        })),
      };
    });

    // Execute a tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      const result = await this.registry.execute(
        name,
        (args ?? {}) as Record<string, unknown>,
        this.ctx
      );

      return {
        content: result.content.map((c) => {
          if (c.type === "json") {
            return { type: "text" as const, text: JSON.stringify(c.data, null, 2) };
          }
          if (c.type === "code") {
            return { type: "text" as const, text: `\`\`\`${c.language ?? ""}\n${c.code}\n\`\`\`` };
          }
          return { type: "text" as const, text: c.text };
        }),
        isError: result.isError,
      };
    });
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  async close(): Promise<void> {
    await this.server.close();
  }
}
