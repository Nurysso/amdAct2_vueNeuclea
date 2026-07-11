# Neuclea

A WebSocket-based AI agent gateway that connects a chat frontend to any service exposing an [`agents.json`](https://amd-act2-vue-neuclea.vercel.app/agents.json) configuration and an MCP (Model Context Protocol) tool server.

---

## How it works

```
Browser (React)
    │  WebSocket
    ▼
Go Backend (neuclea)
    ├── Agent loop  →  Fireworks LLM (planning + formatting)
    └── MCP client  →  Your MCP server (tool execution)
```

1. The frontend fetches `/agents.json` from any website URL the user enters.
2. It sends the config over WebSocket to the Go backend (`init` message).
3. The backend registers the MCP endpoint, loads available tools, and pre-fetches categories.
4. On each user query, a ReAct-style agent loop runs: the LLM decides which tool to call, the MCP client executes it, results feed back into the next planning step, and a final formatted response streams back to the browser.

---

## Project structure

```
.
├── main.go               # HTTP server, CORS, graceful shutdown
├── handlers/
│   └── websocket.go      # WebSocket sessions, init/query/autocomplete handlers
├── agent/
│   └── agent.go          # ReAct agent loop (think → tool_call → final_answer)
├── llm/
│   └── client.go         # Fireworks / Ollama LLM client
├── mcp/
│   ├── client.go         # JSON-RPC MCP client with retry + backoff
│   └── pool.go           # Per-endpoint client pool with rate limiting
└── predictor/
    └── predictor.go      # Markov-chain tool-sequence predictor
```

---

## Prerequisites

- Go 1.22+
- A Fireworks AI API key (or a local Ollama instance)
- An MCP server exposing `POST /mcp` (JSON-RPC 2.0)
- An `agents.json` reachable at `<your-site>/agents.json`

---

## Environment variables

| Variable            | Description             | Default                                            |
| ------------------- | ----------------------- | -------------------------------------------------- |
| `LLM_PROVIDER`      | `fireworks` or `ollama` | `fireworks`                                        |
| `FIREWORKS_API_KEY` | Fireworks AI API key    | required if provider=fireworks                     |
| `FIREWORKS_MODEL`   | Model ID to use         | `accounts/fireworks/models/llama-v3p1-8b-instruct` |
| `OLLAMA_URL`        | Ollama base URL         | `http://localhost:11434`                           |
| `OLLAMA_MODEL`      | Ollama model name       | `llama3`                                           |

Copy `.env.example` to `.env` for local development:

```env
LLM_PROVIDER=fireworks
FIREWORKS_API_KEY=your_key_here
```

---

## Running locally

```bash
go mod download
go build -o neuclea .
./neuclea
# listening on :8080
```

The server exposes:

| Endpoint         | Description                          |
| ---------------- | ------------------------------------ |
| `GET /health`    | JSON health check with provider info |
| `WS /ws`         | WebSocket gateway                    |
| `GET /telemetry` | Session stats and predictor metrics  |

---

## agents.json format

The frontend fetches this from the target site. Minimum required fields:

```json
{
  "schema_version": "1.1",
  "name": "My API Agent",
  "description": "What this agent does.",
  "mcp_server_url": "https://your-mcp-server.example.com",
  "tools": [
    {
      "name": "list_products_api_products_get",
      "description": "List products with optional category filter.",
      "input_schema": {
        "type": "object",
        "properties": {
          "category": { "type": "string", "description": "Product category" },
          "page": { "type": "integer", "description": "Page number" },
          "limit": { "type": "integer", "description": "Results per page" }
        }
      }
    }
  ]
}
```

The `mcp_server_url` must point to a server accepting `POST /mcp` with JSON-RPC 2.0 `tools/call` requests.

---

## WebSocket protocol

All messages are JSON with a `type` field.

### Client → Server

**Initialize a session:**

```json
{
  "type": "init",
  "payload": {
    /* full agents.json object */
  }
}
```

**Send a query:**

```json
{
  "type": "query",
  "payload": { "query": "Show me cameras under $500" }
}
```

**Ping:**

```json
{ "type": "ping" }
```

### Server → Client

| Type               | When                                  |
| ------------------ | ------------------------------------- |
| `init`             | Session initialized, tools loaded     |
| `query.status`     | Status update during agent execution  |
| `query.thought`    | Agent reasoning step (streamed)       |
| `query.tool`       | Tool call result                      |
| `query.chunk`      | Streamed text chunk of final response |
| `query`            | Final response (complete)             |
| `session.sleeping` | Session paused after idle timeout     |
| `session.resumed`  | Session resumed after activity        |
| `pong`             | Response to ping                      |
| `error`            | Error on any message                  |

---

## MCP client behaviour

- **Retries:** up to 3 attempts with exponential backoff (5s → 10s → 20s + jitter) on HTTP 429.
- **Rate limiting:** 1 req/sec per endpoint, burst of 3, enforced in the pool before hitting the server.
- **Cold start guard:** HTML responses (Render free tier wake-up pages) are detected via `Content-Type` and surfaced as a clear error instead of a JSON parse failure.

---

## Agent loop

The agent runs a maximum of 5 ReAct steps per query:

1. **Think** — LLM receives the query, tool schemas, and all previous tool results, then outputs a JSON plan (`tool_call` or `final_answer`).
2. **Act** — The chosen tool is called via the MCP client.
3. **Observe** — The result (or error) is appended to state and fed into the next think step.
4. **Terminate early** if: the same tool fails 3 times in a row, any tool is called more than 3 times, or the MCP server returns a rate-limit error.

After execution, the raw tool results are passed to a second LLM call (`FormatResponse`) that produces the final user-facing markdown response, streamed chunk by chunk.

---

### CORS

The backend allows `https://neuclea-console.vercel.app` by default. To add origins, edit `withCORS` in `main.go`:

```go
allowed := map[string]bool{
    "https://neuclea-console.vercel.app": true,
    "https://your-other-origin.com":      true,
}
```

---

## Telemetry

`GET /telemetry` returns a snapshot of all active sessions and aggregate stats:

```json
{
  "session_count": 1,
  "initialized_sessions": 1,
  "aggregate": {
    "total_queries": 12,
    "avg_response_ms": 3400,
    "prediction_accuracy": 0.75
  },
  "predictor": {
    "transitions_recorded": 48,
    "unique_from_tools": 3
  }
}
```

The predictor tracks tool call sequences using a Markov chain and uses them to power autocomplete suggestions in the frontend.
