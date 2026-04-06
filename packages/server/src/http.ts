import express, { type Request, type Response, type NextFunction, type Express } from "express";
import cors from "cors";
import { WebSocketServer, type WebSocket } from "ws";
import { createServer, type Server as HTTPServer } from "node:http";
import type { Duplex } from "node:stream";
import type { ToolRegistry, ToolContext } from "@codeintel/tools";
import type { GraphStore } from "@codeintel/core";

export interface HttpServerOptions {
  port?: number;
  host?: string;
  corsOrigin?: string | string[];
}

/**
 * HTTP + WebSocket bridge for the CodeIntelEngine.
 *
 * Exposes:
 * - REST API for tool execution
 * - WebSocket for live index status updates
 * - SSE endpoint for streaming query results
 */
export class HttpServer {
  private app: Express;
  private httpServer: HTTPServer;
  private wss: WebSocketServer;
  private registry: ToolRegistry;
  private ctx: ToolContext;
  private clients = new Set<WebSocket>();
  private port: number;
  private host: string;

  constructor(registry: ToolRegistry, ctx: ToolContext, opts?: HttpServerOptions) {
    this.registry = registry;
    this.ctx = ctx;
    this.port = opts?.port ?? 3100;
    this.host = opts?.host ?? "localhost";

    this.app = express();
    this.app.use(cors({ origin: opts?.corsOrigin ?? "*" }));
    this.app.use(express.json());

    this.httpServer = createServer(this.app);
    this.wss = new WebSocketServer({ noServer: true });

    // Only upgrade requests on /ws path to WebSocket
    this.httpServer.on("upgrade", (request, socket: Duplex, head) => {
      const pathname = new URL(request.url ?? "/", `http://${request.headers.host}`).pathname;
      if (pathname === "/ws") {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit("connection", ws, request);
        });
      } else {
        socket.destroy();
      }
    });

    this.setupRoutes();
    this.setupWebSocket();
  }

  private setupRoutes(): void {
    // Health check
    this.app.get("/health", (_req: Request, res: Response) => {
      res.json({ status: "ok", version: "0.1.0" });
    });

    // List tools
    this.app.get("/api/tools", (_req: Request, res: Response) => {
      res.json({ tools: this.registry.list() });
    });

    // Execute tool
    this.app.post("/api/tools/:name", async (req: Request, res: Response, next: NextFunction) => {
      try {
        const name = String(req.params.name);
        const args = req.body ?? {};
        const result = await this.registry.execute(name, args as Record<string, unknown>, this.ctx);
        if (result.isError) {
          res.status(400).json(result);
        } else {
          res.json(result);
        }
      } catch (err) {
        next(err);
      }
    });

    // Graph stats
    this.app.get("/api/stats", async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const [nodeCount, edgeCount, communities, processes] = await Promise.all([
          this.ctx.store.getNodeCount(),
          this.ctx.store.getEdgeCount(),
          this.ctx.store.getCommunities(),
          this.ctx.store.getProcesses(),
        ]);

        res.json({
          nodes: nodeCount,
          edges: edgeCount,
          communities: communities.length,
          processes: processes.length,
        });
      } catch (err) {
        next(err);
      }
    });

    // Get node by ID
    this.app.get("/api/nodes/:id", async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = decodeURIComponent(String(req.params.id));
        const node = await this.ctx.store.getNode(id);
        if (!node) {
          res.status(404).json({ error: "Node not found" });
          return;
        }
        res.json(node);
      } catch (err) {
        next(err);
      }
    });

    // Get nodes by file
    this.app.get("/api/files/:path", async (req: Request, res: Response, next: NextFunction) => {
      try {
        const filePath = decodeURIComponent(String(req.params.path));
        const nodes = await this.ctx.store.getNodesByFile(filePath);
        res.json({ nodes });
      } catch (err) {
        next(err);
      }
    });

    // SSE stream for query results
    this.app.get("/api/stream/query", async (req: Request, res: Response) => {
      const query = req.query.q as string | undefined;
      if (!query) {
        res.status(400).json({ error: "Query parameter 'q' is required" });
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      try {
        const result = await this.registry.execute("query", { query, limit: 50 }, this.ctx);
        for (const content of result.content) {
          let data: string;
          if (content.type === "json") {
            data = JSON.stringify(content.data);
          } else if (content.type === "text") {
            data = JSON.stringify({ text: content.text });
          } else {
            data = JSON.stringify({ code: content.code });
          }
          res.write(`data: ${data}\n\n`);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
      }

      res.write("event: done\ndata: {}\n\n");
      res.end();
    });

    // Global error handler
    this.app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      console.error("Server error:", err.message);
      res.status(500).json({ error: "Internal server error" });
    });
  }

  private setupWebSocket(): void {
    this.wss.on("connection", (ws: WebSocket) => {
      this.clients.add(ws);

      ws.on("close", () => {
        this.clients.delete(ws);
      });

      ws.on("message", async (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "ping") {
            ws.send(JSON.stringify({ type: "pong" }));
          }
        } catch {
          // Ignore malformed messages
        }
      });

      ws.send(JSON.stringify({ type: "connected", timestamp: Date.now() }));
    });
  }

  broadcast(event: { type: string; data: unknown }): void {
    const message = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(message);
      }
    }
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.port, this.host, () => {
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    for (const client of this.clients) {
      client.close();
    }
    this.wss.close();
    return new Promise((resolve) => {
      this.httpServer.close(() => resolve());
    });
  }

  get address(): string {
    return `http://${this.host}:${this.port}`;
  }
}
