# VisNeucla

**AMD Hackathon — Team Voyager**
_Point it at any REST API. Talk to it instantly._

VisNeucla is a two-part system that turns any OpenAPI spec into a conversational AI agent in minutes — no boilerplate, no glue code.

**Vis** generates a production-ready MCP server from an OpenAPI spec. **Neuclea** connects that server to a chat frontend through an agentic reasoning loop. Together they form a full pipeline from raw API to natural-language interface.

For teams that need production visibility, Vis can also generate a containerized observability stack (Prometheus, Loki, Tempo, Grafana) alongside the MCP server — see [Observability Stack](#observability-stack).

---

## Live / Hosted Demo

- **Console (frontend):** https://neuclea-console.vercel.app/

The backend services below are hosted on Render's free tier, which **spins down after 15 minutes of inactivity**. If a health check fails, it's cold-starting — wait ~30–50s and retry. Judges should hit these first to warm them up:

```bash
curl https://amdact2-vueneuclea.onrender.com/health
# {"status":"ok","server":"novamart-api"}

curl https://dummy-backend-amdact2-vueneuclea.onrender.com/health
# {"status":"ok"}

curl https://agent-backend-amdact2-vueneuclea-go-agent.onrender.com/health
# {"ok":true,"provider":"fireworks","timestamp":"..."}
```

If any of these stay down, follow the local setup instructions below to run the full stack yourself — this is the most reliable way to evaluate the project.

---

## AMD / Compute Resource Usage

We did not have AMD Developer Cloud credits available for this hackathon, so **all LLM inference runs through the Fireworks AI serverless API** rather than self-hosted AMD compute. This is the compute path for every agent query in this project — there is no separate/alternate inference backend.

- **Provider:** Fireworks AI (serverless inference)
- **Models used:** `glm-5p2` and `minimax-m2p7`
- **Total usage this week:** 185.20K tokens across all development, testing, and demo runs
- **Where it's called from:** `neuclea/llm/` (client + prompt engine), configured via `FIREWORKS_API_KEY` / `FIREWORKS_MODEL` in `neuclea/.env`

No other paid compute or GPU resources were used. The observability stack (Prometheus/Loki/Tempo/Grafana) runs locally via Docker and is not an inference dependency — it's diagnostics only.

---

## External Services Used

| Service                                                        | Purpose                                                                 | Required?                                                |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------- |
| **Fireworks AI**                                               | LLM inference (`glm-5p2`, `minimax-m2p7`) — see above                   | Yes, for the agent to answer queries                     |
| **Render**                                                     | Hosts the demo backends (Novamart API, dummy backend, Go agent backend) | No — only for the hosted demo; not needed to run locally |
| **Vercel**                                                     | Hosts the Neuclea console frontend                                      | No — only for the hosted demo                            |
| **Grafana stack** (Prometheus, Loki, Promtail, Tempo, Grafana) | Local observability/telemetry only, via Docker Compose                  | No — optional, self-hosted                               |

No other external APIs, SaaS tools, or paid services are used at runtime.

---

## Original Work / AI-Assisted Tooling Disclosure

All five team members contributed to both the `vis` and `neuclea` codebases. During development we used a mix of AI coding assistants — Antigravity, Claude, DeepSeek, and MiniMax — as pair-programming tools, in addition to Fireworks-hosted models being the actual product being built. The architecture, integration, and final code are our own; these tools were used the way any team would use IDE autocomplete/pair-programming assistance.

---

## Quick Start (Full Local Setup)

These are the exact commands we use to run the full stack end-to-end.

### 1. Generate the MCP server with Vis

```bash
cd vis
pnpm build:all
node packages/cli/vis-cli.cjs build \
  https://dummy-backend-amdact2-vueneuclea.onrender.com/openapi.json \
  --out ./mcp-server \
  --telemetry \
  --agent-name "Novamart API"
```

### 2. Build the generated MCP server

```bash
cd mcp-server
pnpm install
pnpm build
```

### 3. Run the MCP server with the full observability stack enabled

```bash
TELEMETRY_ENABLED=true \
METRICS_ENABLED=true \
METRICS_PORT=9091 \
LOGS_ENABLED=true \
LOG_LEVEL=info \
LOKI_URL=http://localhost:3100 \
TRACES_ENABLED=true \
TRACES_ENDPOINT=http://localhost:4318/v1/traces \
TRACE_SAMPLE_RATE=0.1 \
MCP_TRANSPORT=http \
MCP_BASE_URL=https://dummy-backend-amdact2-vueneuclea.onrender.com \
PORT=3000 \
node dist/index.js
```

### 4. Build and run Neuclea (the agent gateway)

```bash
cd neuclea/backend
go build -ldflags="-buildid=" -o neuclea main.go
./neuclea
# starts on :8080
```

Neuclea needs a `.env` file (copy from `.env.example`) with your `FIREWORKS_API_KEY` set — see [Environment](#environment) below.

### 5. (Optional) Run the observability stack

Vis generates a Docker Compose file for observability alongside the MCP server. From the folder it created:

```bash
docker-compose -f docker-compose.telemetry.yml up -d
```

This brings up Prometheus, Loki, Promtail, Tempo, and Grafana for live metrics/logs/traces from the MCP server.

### 6. Talk to it

Point the Neuclea console (hosted at https://neuclea-console.vercel.app/, or run it locally) at your running Neuclea WebSocket gateway (`ws://localhost:8080/ws`) and start asking questions in plain English.

---

## Main Code Path

If you only have a few minutes to review the implementation, look here:

- **Agent reasoning loop:** `neuclea/agent/agent.go` — the ReAct loop (plan → call → summarise → format)
- **LLM client / prompt engine:** `neuclea/llm/` — Fireworks/Ollama integration
- **MCP client pool:** `neuclea/mcp/` — JSON-RPC client with retry, rate limiting
- **WebSocket protocol / session handling:** `neuclea/handlers/`
- **OpenAPI → MCP codegen entry point:** `vis/packages/cli/` (the `vis build` command)
- **Spec parsing:** `vis/packages/parser/` — OpenAPI 3.x → internal IR
- **MCP server code generation:** `vis/packages/templates/` — IR → MCP server source + observability manifests

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
 Natural language response  (5X less token usage compared to traditional agents)
```

### Token Budget Design

Every architectural decision targets minimal token use:

| Stage      | Technique                                             | Impact                |
| ---------- | ----------------------------------------------------- | --------------------- |
| Planning   | First-sentence tool descriptions only                 | −60% vs full desc     |
| Planning   | Required params only in tool listing                  | −30% param tokens     |
| History    | Name-only summaries (4 items: Dune, Atomic Habits, …) | −90% vs item previews |
| Planning   | Token cap on plan output                              | Enforced ceiling      |
| Formatting | Description capped at first sentence per item         | −70% desc tokens      |
| Formatting | Plain-text mode (no `response_format: json`)          | Correct prose output  |

Typical total: ~1,800–2,200 tokens per 2-round query.

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

| Endpoint         | Purpose                          |
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

**Status:** Metrics collection works end-to-end. Grafana dashboard generation is functional but not yet production-polished — treat the generated dashboards as a starting point rather than a finished product.

### CLI Reference

```
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

### agents.json Format

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

- **Go 1.25** — Neuclea agent, WebSocket server, MCP client (need 1.25 to use `x/time` package for rate limit fix)
- **TypeScript** — Vis generator, MCP server templates
- **Fireworks AI** — LLM inference (`glm-5p2`, `minimax-m2p7`), serverless — see [AMD / Compute Resource Usage](#amd--compute-resource-usage)
- **Model Context Protocol** — Tool execution standard
- **gorilla/websocket** — WebSocket transport
- **Zod** — Runtime schema validation in generated servers
- **pnpm workspaces** — Vis monorepo
- **Prometheus / Grafana / Loki / Tempo / Promtail** — Observability stack for generated servers (local/self-hosted)

---

**Team Voyager · AMD Hackathon**

_Vis — Latin for "force, power, strength"_
_Neuclea — the nucleus, the core_

License: Apache License V2
