# VisNeucla

> **AMD Hackathon — Team Voyager**
> _Point it at any REST API. Talk to it instantly._

VisNeucla is a two-part system that turns any OpenAPI spec into a conversational AI agent in minutes — no boilerplate, no glue code.

**Vis** generates a production-ready MCP server from an OpenAPI spec. **Neuclea** connects that server to a chat frontend through an agentic reasoning loop. Together they form a full pipeline from raw API to natural-language interface.

For teams that need production visibility, Vis can also generate a containerized observability stack (Prometheus, Loki, Tempo, Grafana) alongside the MCP server — see [Observability Stack](#observability-stack).

---

## The Pipeline

```
Your OpenAPI spec
      │
      ▼
  ┌───────┐
  │  Vis  │  generates a typed MCP server (TypeScript)
  └───┬───┘
      │  POST /mcp  (JSON-RPC 2.0)
      ▼
┌──────────┐
│ Neuclea  │  ReAct agent loop  →  Fireworks LLM
└────┬─────┘
     │  WebSocket
     ▼
 Browser
```

1. Run `vis build ./openapi.yaml` — get a working MCP server.
2. Deploy it and drop the URL into the Neuclea console.
3. Start asking questions in plain English.

---

## Monorepo Structure

```
.
├── neuclea/               # Go — WebSocket AI agent gateway
│   ├── main.go
│   ├── agent/agent.go     # ReAct loop: plan → call → summarise → format
│   ├── llm/               # Fireworks / Ollama client + prompt engine
│   ├── mcp/               # JSON-RPC MCP client pool with retry & rate limiting
│   ├── handlers/          # WebSocket session management
│   └── predictor/         # Markov-chain tool-sequence predictor
│
└── vis/                   # TypeScript — OpenAPI → MCP code generator
    ├── packages/
    │   ├── core/          # IR types (root, no deps)
    │   ├── parser/        # OpenAPI 3.x → IR
    │   ├── templates/     # IR → MCP server source (+ observability manifests)
    │   ├── generator/     # File system writer
    │   └── cli/           # `vis` command
    └── pnpm-workspace.yaml
```

---

## Neuclea — AI Agent Gateway

A Go WebSocket server that runs a token-efficient ReAct agent loop against any MCP tool server.

### Architecture

The agent operates in rounds. Each round costs one LLM planning call; tools within a round run in parallel.

```
Query arrives
     │
     ▼
┌─────────────────────────────────────────────┐
│  Round N (max 3)                            │
│                                             │
│  Plan  ──►  [tool_A]  ──►  summarise names │
│             [tool_B]  ──►  summarise names │  ◄── parallel
│             [tool_C]  ──►  summarise names │
│                │                           │
│                ▼                           │
│         done=true?  ──Yes──► Format        │
│                │                           │
│               No                           │
│                └────────────► Round N+1    │
└─────────────────────────────────────────────┘
     │
     ▼
 Natural language response  (5X less tokens usage when compared to traditional agents)
```

### Token Budget Design

Every architectural decision targets minimal token use:

| Stage      | Technique                                               | Impact                |
| ---------- | ------------------------------------------------------- | --------------------- |
| Planning   | First-sentence tool descriptions only                   | −60% vs full desc     |
| Planning   | Required params only in tool listing                    | −30% param tokens     |
| History    | Name-only summaries (`4 items: Dune, Atomic Habits, …`) | −90% vs item previews |
| Planning   | token cap on plan output                                | Enforced ceiling      |
| Formatting | Description capped at first sentence per item           | −70% desc tokens      |
| Formatting | Plain-text mode (no `response_format: json`)            | Correct prose output  |

Typical total: **~1,800–2,200 tokens** per 2-round query.

### Key Features

- **Parallel tool calls** — independent tools in the same round run concurrently via goroutines
- **Pre-fetching** — categories and other session-level data fetched once at init, seeded into agent history
- **Graceful degradation** — plan errors and max-round hits both attempt a best-effort format from collected data before returning an error
- **Markov predictor** — tracks tool-call sequences across queries to power autocomplete suggestions
- **MCP pool** — per-endpoint rate limiting (1 req/s, burst 3), retries with exponential backoff, cold-start HTML detection

### Running Neuclea

```bash
cd neuclea
cp .env.example .env          # add FIREWORKS_API_KEY
go mod download
go build -o neuclea .
./neuclea                      # :8080
```

| Endpoint         |                                  |
| ---------------- | -------------------------------- |
| `WS /ws`         | WebSocket gateway                |
| `GET /health`    | Provider + timestamp             |
| `GET /telemetry` | Session stats, predictor metrics |

### Environment

| Variable            | Default                                  |
| ------------------- | ---------------------------------------- |
| `FIREWORKS_API_KEY` | required                                 |
| `FIREWORKS_MODEL`   | `accounts/fireworks/models/minimax-m2p7` |
| `LLM_PROVIDER`      | `fireworks` (`ollama` also supported)    |
| `OLLAMA_URL`        | `http://localhost:11434`                 |

---

## Vis — OpenAPI → MCP Generator

A TypeScript CLI that parses any OpenAPI 3.x spec and emits a complete, typed MCP server — Zod validation, error handling, JSON Schema tool discovery, and all.

### Package Architecture

```
core  (IR types, no deps)
  └── parser  (OpenAPI → IR)
        └── templates  (IR → MCP source)
              └── generator  (writes files)
                    └── cli  (vis command)
```

Strict one-way dependency graph. No circular imports. `render()` functions are pure — same spec always produces identical output.

### Quick Start

```bash
# Install
npm install -g @vis/cli

# Generate a server
vis build ./openapi.yaml --out ./my-mcp-server

# Build and run
cd ./my-mcp-server && npm install && npm run build
node dist/index.js
```

### What Gets Generated

- Typed tool definitions with Zod schema validation
- Automatic parameter routing (query, path, header, body)
- Clean JSON Schema output for MCP tool discovery
- Proper error handling and response formatting
- Support for `allOf`, `oneOf`, `anyOf`, arrays, nested objects
- Optional containerized observability stack (Prometheus, Loki, Promtail, Tempo, Grafana) — see below

### Observability Stack

Servers generated by `vis` can optionally ship with a containerized observability stack, so agent behavior is debuggable and auditable from day one:

| Component  | Role                          |
| ---------- | ----------------------------- |
| Prometheus | Metrics collection            |
| Loki       | Log aggregation               |
| Promtail   | Ships logs into Loki          |
| Tempo      | Distributed tracing           |
| Grafana    | Dashboards for live analytics |

> **Status:** Metrics collection works end-to-end. Grafana dashboard generation is functional but not yet production-polished — treat the generated dashboards as a starting point rather than a finished product.

### CLI Reference

```bash
vis build <spec> [options]

  <spec>                   Local file or URL (JSON or YAML)
  -o, --out <dir>          Output directory  (default: ./mcp-server)
  --base-url <url>         Override upstream API base URL
  --package-name <name>    npm package name
  --force                  Overwrite existing output directory
  --no-install             Skip npm install
  --typecheck              Run tsc --noEmit after install
```

### Development

```bash
cd vis
pnpm install
pnpm build:all
pnpm test
```

---

## WebSocket Protocol (Neuclea)

### Client → Server

```json
{ "type": "init",  "payload": { /* agents.json */ } }
{ "type": "query", "payload": { "query": "find me cameras under $500" } }
{ "type": "ping" }
```

### Server → Client

| Type               | When                                 |
| ------------------ | ------------------------------------ |
| `init`             | Session ready, tools loaded          |
| `query.thought`    | Agent reasoning step (streamed live) |
| `query.tool`       | Tool call completed                  |
| `query.status`     | Status update                        |
| `query`            | Final formatted answer               |
| `session.sleeping` | Paused after idle timeout            |
| `error`            | Any failure                          |

---

## agents.json Format

The frontend fetches this from the target site and sends it as the `init` payload.

```json
{
  "schema_version": "1.1",
  "name": "My Store Agent",
  "mcp_server_url": "https://your-mcp-server.example.com",
  "tools": [
    {
      "name": "list_products_api_products_get",
      "description": "List products with optional category filter.",
      "input_schema": {
        "type": "object",
        "properties": {
          "category": { "type": "string" },
          "page": { "type": "integer" },
          "limit": { "type": "integer" }
        }
      }
    }
  ]
}
```

---

## Built With

- **Go 1.25** — Neuclea agent, WebSocket server, MCP client (need 1.25 to use x/time package for rate limit fix )
- **TypeScript** — Vis generator, MCP server templates
- **Fireworks AI** — LLM inference (MiniMax M2P7 / GLM series)
- **Model Context Protocol** — Tool execution standard
- **gorilla/websocket** — WebSocket transport
- **Zod** — Runtime schema validation in generated servers
- **pnpm workspaces** — Vis monorepo
- **Prometheus** — Metrics collection for generated servers
- **Grafana** — Dashboards for live analytics
- **Loki** — Log aggregation
- **Tempo** — Distributed tracing
- **Promtail** — Ships logs into Loki

---

## Team Voyager · AMD Hackathon

> Vis — _Latin for "force, power, strength"_
> Neuclea — _the nucleus, the core_

## [License](#license) Apache License V2
