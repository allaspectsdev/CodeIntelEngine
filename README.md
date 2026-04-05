# CodeIntelEngine 🧠⚡

### *GitNexus walked so CodeIntelEngine could fly.*

> **CodeIntelEngine** is a next-generation code intelligence platform that builds deep, queryable knowledge graphs from your repositories — giving AI agents (and humans) true architectural understanding of any codebase.

Inspired by [GitNexus](https://github.com/abhigyanpatwari/GitNexus), CodeIntelEngine takes the concept of codebase knowledge graphs and cranks every dial to 11.

---

## 🤔 The Problem

Your AI coding assistant can write code. Cool. But does it *understand* your codebase?

- It doesn't know that `UserService` is a load-bearing wall you shouldn't casually refactor.
- It doesn't see that changing `PaymentProcessor.validate()` breaks 47 downstream consumers.
- It treats your monorepo like a collection of unrelated text files.

**That's like hiring a contractor who can swing a hammer but can't read blueprints.**

CodeIntelEngine gives your AI the blueprints.

---

## 🚀 What Makes This Different

| Capability | GitNexus (v1) | CodeIntelEngine |
|---|---|---|
| **Indexing** | Batch-only, full repo each time | ⚡ Incremental — only re-indexes what changed |
| **Database** | Module-global singleton, manual locking | 🏊 Connection-pooled, multi-tenant per repo |
| **Graph Construction** | Entire graph built in RAM, then bulk-loaded | 🌊 Streaming — nodes/edges written as produced |
| **Search** | Flat BM25, optional vector, merged at file level | 🎯 Graph-native retrieval with symbol-level RRF + PageRank boosting |
| **Type Resolution** | Heuristic, capped at 2000 files | 🔍 Demand-driven, follows import chains lazily |
| **Flow Analysis** | BFS-only, hardcoded 75-process cap | 🌀 Hybrid BFS+DFS, configurable entry points, no caps |
| **Diff Awareness** | Reads git diffs at query time, doesn't update graph | 🔄 Live graph patching via file watcher |
| **MCP Server** | All tools in one file, one backend object | 🔌 Plugin-based tool registry, third-party extensible |
| **Languages** | JS/TS focused | 🌍 TypeScript, JavaScript, Python, Go, Rust, Java |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CodeIntelEngine                       │
├──────────┬──────────┬───────────┬───────────┬───────────┤
│   CLI    │ MCP Srv  │ HTTP API  │  Watcher  │  Plugins  │
├──────────┴──────────┴───────────┴───────────┴───────────┤
│                  Tool Registry (plugin system)           │
├─────────────────────────────────────────────────────────┤
│                  Query Engine                            │
│  ┌────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ Graph Walk │  │ Text Search  │  │ Rank Fusion     │  │
│  │ (traversal │  │ (BM25 + Vec) │  │ (RRF + PageRank)│  │
│  │  + impact) │  │              │  │                 │  │
│  └────────────┘  └──────────────┘  └─────────────────┘  │
│               score = w_t·RRF(bm25,vec)                 │
│                    + w_g·communityRelevance              │
│                    + w_pr·pageRank(node)                 │
├─────────────────────────────────────────────────────────┤
│                  Graph Store                             │
│  ┌─────────────────┐  ┌──────────────────────────────┐  │
│  │  Connection Pool │  │  Schema (typed, versioned)   │  │
│  │  (per-repo, WAL) │  │  + auto-migrations           │  │
│  └─────────────────┘  └──────────────────────────────┘  │
├─────────────────────────────────────────────────────────┤
│               Ingestion Pipeline                        │
│  ┌────────┐ ┌─────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Parse  │→│ Extract │→│ Resolve  │→│ Enrich       │  │
│  │(T-sit) │ │(symbols)│ │(imports, │ │(communities, │  │
│  │        │ │         │ │ calls,   │ │ processes,   │  │
│  │        │ │         │ │ types)   │ │ PageRank)    │  │
│  └────────┘ └─────────┘ └──────────┘ └──────────────┘  │
│       ↑ incremental: only changed files re-enter        │
├─────────────────────────────────────────────────────────┤
│              File Watcher + Git Integration              │
│  chokidar  ·  debounced re-index  ·  diff tracking      │
└─────────────────────────────────────────────────────────┘
```

Seven packages, one turborepo, zero module-global singletons:

```
CodeIntelEngine/
├── packages/
│   ├── core/          @codeintel/core        Graph store, pool, schema, migrations
│   ├── ingestion/     @codeintel/ingestion   Parser, extractors, resolvers, enrichers
│   ├── query/         @codeintel/query       Text search, graph walk, rank fusion
│   ├── tools/         @codeintel/tools       Plugin registry + 7 built-in tools
│   ├── server/        @codeintel/server      MCP stdio + HTTP/WS bridge
│   ├── cli/           @codeintel/cli         Commander-based CLI (8 commands)
│   └── web/           @codeintel/web         Vite + React graph explorer
├── turbo.json
├── tsconfig.base.json
└── package.json
```

---

## 🧪 Quick Start

```bash
# Clone & install
git clone https://github.com/yourusername/CodeIntelEngine.git
cd CodeIntelEngine
npm install

# Build all packages
npm run build

# Index a repo
cd /path/to/your/project
npx codeintel init
npx codeintel analyze

# Search your codebase
npx codeintel query "authentication middleware"

# Blast radius analysis
npx codeintel impact "UserService"

# Watch for changes (live incremental re-indexing)
npx codeintel watch

# Start the HTTP API + web explorer
npx codeintel serve
# → http://localhost:3100

# Start MCP server for AI editor integration
npx codeintel mcp
```

---

## 🔌 7 Intelligence Tools (MCP & API)

Every tool is a self-contained plugin. Use them via CLI, MCP, or HTTP API.

| Tool | What it does | Example |
|---|---|---|
| **`query`** | Graph-boosted semantic search | *"Find everything related to authentication"* |
| **`context`** | Full context around a symbol — callers, callees, imports, community | *"What's the world around `PaymentProcessor`?"* |
| **`impact`** | Blast radius analysis — who breaks if you touch this? | *"What happens if I change `validateToken`?"* |
| **`flow`** | Trace execution chains from entry points | *"What gets called when `handleLogin` fires?"* |
| **`rename`** | Preview rename impact across the graph | *"Can I safely rename `processOrder` to `submitOrder`?"* |
| **`detect_changes`** | Map git diffs to graph nodes | *"What symbols changed since last commit?"* |
| **`cypher`** | Raw SQL queries against the graph DB | *For when you need to go off-road* |

### Writing Your Own Tool

Drop a plugin into `~/.codeintel/plugins/` or register it programmatically:

```typescript
import type { ToolPlugin } from "@codeintel/tools";

const myTool: ToolPlugin = {
  name: "dead_code",
  description: "Find symbols with zero inbound references",
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", description: "Filter by symbol kind" },
    },
  },
  async execute(args, ctx) {
    const orphans = await ctx.store.query(
      `SELECT n.* FROM nodes n
       LEFT JOIN edges e ON e.target = n.id
       WHERE e.id IS NULL AND n.kind != 'file'
       LIMIT 50`
    );
    return {
      content: [{ type: "json", data: orphans }],
    };
  },
};
```

---

## 🧠 How the Ingestion Pipeline Works

Most code indexers batch-process: parse everything → build giant in-memory graph → bulk-load to database. That's fine for small repos. For anything serious, you run out of RAM or patience.

CodeIntelEngine **streams**:

```
File Change Detected (or full scan on first run)
        │
        ▼
┌───────────────┐     ┌──────────────┐     ┌──────────────┐
│  Parse         │────▶│   Extract    │────▶│   Resolve    │
│  (Tree-sitter  │     │  symbols,    │     │  imports,    │
│   or regex     │     │  calls,      │     │  call edges, │
│   fallback)    │     │  docstrings  │     │  types       │
└───────────────┘     └──────────────┘     └──────┬───────┘
                                                   │
                              ┌─────────────────────┤
                              ▼                     ▼
                      ┌──────────────┐     ┌──────────────┐
                      │  DB Write    │     │  Invalidate  │
                      │  (streaming  │     │  dependents  │
                      │   upserts)   │     │  (mark stale)│
                      └──────────────┘     └──────────────┘
                              │
                              ▼ (async, debounced)
                      ┌──────────────┐
                      │  Enrichment  │
                      │  • Leiden    │
                      │    community │
                      │    detection │
                      │  • Process   │
                      │    tracing   │
                      │  • PageRank  │
                      └──────────────┘
```

**Incremental strategy:**
1. Each symbol node stores a `contentHash` (SHA-256 of its source text)
2. On file change, parse only that file, compare hashes
3. Changed symbol → upsert node, delete stale edges, re-resolve
4. Mark downstream dependents as "possibly stale" for lazy re-validation
5. Community/process re-enrichment runs debounced (not on every keystroke)

---

## 🔍 How the Query Engine Works

Not your average `ctrl+F`. The query engine auto-classifies your query and picks the right strategy:

| Query Type | Detection | Strategy |
|---|---|---|
| **Keyword** | Short, no English words | Heavy BM25, light graph |
| **Natural Language** | Contains "what", "where", "how", etc. | BM25 + vector + community expansion |
| **Structural** | Contains file paths, dot-notation | Graph traversal + text |
| **Impact** | Contains "affects", "breaks", "depends" | Deep graph expansion + process tracing |

Results are ranked by fusing signals:

```
score = w_text     · RRF(bm25, vector)
      + w_graph    · communityRelevance
      + w_pagerank · pageRank(node)
```

Weights auto-adjust per query type. A keyword search trusts text (0.7); an impact query trusts the graph (0.5).

---

## 📊 The Graph Model

### Nodes (13 kinds)

| Kind | Examples |
|---|---|
| `file` | `src/auth/middleware.ts` |
| `function` | `validateToken`, `hashPassword` |
| `class` | `UserService`, `DatabasePool` |
| `method` | `UserService.findById` |
| `interface` | `AuthProvider`, `Logger` |
| `type_alias` | `UserId`, `Config` |
| `variable` | `defaultTimeout`, `router` |
| `constant` | `MAX_RETRIES`, `API_VERSION` |
| `enum` | `UserRole`, `HttpStatus` |
| `module` | `auth`, `payments` |
| `namespace` | `Utils`, `Validators` |
| `property` | `user.email`, `config.port` |
| `parameter` | Function parameters |

### Edges (12 kinds)

| Kind | Meaning |
|---|---|
| `calls` | Function A calls function B |
| `imports` | File A imports from file B |
| `exports` | Module exports a symbol |
| `extends` | Class A extends class B |
| `implements` | Class A implements interface B |
| `contains` | File contains a symbol |
| `type_of` | Variable has a type |
| `returns` | Function returns a type |
| `parameter_of` | Parameter belongs to a function |
| `overrides` | Method overrides a parent method |
| `uses` | Symbol references another symbol |
| `member_of` | Property belongs to a class |

Every edge carries a `confidence` score (0.0–1.0) — because sometimes we're guessing, and it's better to say so.

---

## 🌍 Language Support

| Language | Parser | Symbols | Imports | Calls |
|---|---|---|---|---|
| TypeScript | Tree-sitter + regex fallback | ✅ | ✅ | ✅ |
| JavaScript | Tree-sitter + regex fallback | ✅ | ✅ | ✅ |
| Python | Tree-sitter + regex fallback | ✅ | ✅ | ✅ |
| Go | Tree-sitter + regex fallback | ✅ | ✅ | ✅ |
| Rust | Tree-sitter + regex fallback | ✅ | ✅ | ✅ |
| Java | Tree-sitter + regex fallback | ✅ | ✅ | ✅ |

The regex fallback means indexing works even without native Tree-sitter bindings installed. It's less precise, but it gets the job done — kind of like reading a map versus having GPS. Both get you there.

---

## 🖥️ Web Explorer

The browser UI (`codeintel serve` + open `http://localhost:3100`) features:

- **D3 force-directed graph visualization** — drag, zoom, explore your code's dependency web
- **Live updates** — WebSocket connection shows graph changes in real-time as you code
- **Search + click-to-explore** — find a symbol, click it, see its entire neighborhood
- **Dark theme** — because we're not animals

---

## 🔧 MCP Server Integration

Add CodeIntelEngine to your AI editor (Claude Code, Cursor, etc.):

```json
{
  "mcpServers": {
    "codeintel": {
      "command": "npx",
      "args": ["codeintel", "mcp"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

Now your AI assistant can ask questions like *"what breaks if I rename this function?"* and get real answers backed by graph analysis — not vibes.

---

## 📦 Package Details

| Package | Size | What's Inside |
|---|---|---|
| `@codeintel/core` | Foundation | `GraphStore`, `ConnectionPool`, typed schema, auto-migrations, FTS5 search index |
| `@codeintel/ingestion` | Heaviest | 6 language parsers, symbol/import/call extractors, Leiden community detection, PageRank, hybrid process tracing, file watcher |
| `@codeintel/query` | Brain | BM25 text search, graph walk (impact/context/flow/path), RRF rank fusion, auto query planner |
| `@codeintel/tools` | Extensible | Plugin registry, 7 built-in tools, `ToolPlugin` interface for third-party tools |
| `@codeintel/server` | Thin | MCP stdio adapter, Express HTTP API, WebSocket live updates, SSE streaming |
| `@codeintel/cli` | User-facing | 8 commands, colored output, progress spinners, JSON mode |
| `@codeintel/web` | Visual | React + D3 graph explorer, live WebSocket connection, dark UI |

---

## 🗺️ Roadmap

- [x] Project scaffolding & architecture design
- [x] Core graph store with connection pooling & migrations
- [x] Streaming incremental ingestion pipeline
- [x] Multi-language parsing (TS, JS, Python, Go, Rust, Java)
- [x] Symbol, import, and call extraction
- [x] Cross-file import & call resolution
- [x] Community detection (Leiden algorithm)
- [x] Process/execution flow detection (hybrid BFS+DFS)
- [x] PageRank computation
- [x] Graph-native query engine with rank fusion
- [x] Plugin-based tool system (7 built-in tools)
- [x] MCP server implementation
- [x] HTTP API with WebSocket & SSE
- [x] CLI with 8 commands
- [x] Web-based graph explorer
- [x] File watcher for live incremental re-indexing
- [ ] Vector embedding support (query + node embeddings)
- [ ] Cross-repo federation (org-wide graph)
- [ ] CI/CD integration & GitHub Action
- [ ] Plugin marketplace
- [ ] Architecture drift detection
- [ ] Change risk scoring

---

## 🛠️ Development

```bash
# Install dependencies
npm install

# Build all packages (respects dependency order)
npm run build

# Build a single package
npx turbo build --filter=@codeintel/core

# Run tests
npm test

# Development mode (watch + rebuild)
npm run dev
```

---

## 🤝 Contributing

This project is in active development. We'd love your help!

1. Fork it
2. Create your feature branch (`git checkout -b feature/amazing-analyzer`)
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

The codebase is a Turborepo monorepo with 7 packages. Each package builds independently. Start with `@codeintel/core` to understand the data model, then explore outward.

---

## 📜 License

MIT — because knowledge wants to be free.

---

<p align="center">
  <i>Built with mass quantities of caffeine, mass quantities of curiosity, and a mass refusal to let AI agents fly blind.</i>
  <br><br>
  <b>⭐ Star this repo if you think AI should understand code, not just generate it.</b>
</p>
