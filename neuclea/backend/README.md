# Neuclea Backend

A ReAct-based AI agent system that connects LLMs to external tools via the Model Context Protocol (MCP). The backend orchestrates tool calling, session management, and real-time communication through WebSockets.

## Architecture

```
┌─────────────┐     WebSocket      ┌─────────────────┐     MCP Protocol     ┌─────────────┐     REST API     ┌─────────────────┐
│   Client    │ ◄──────────────►   │ Neuclea Backend │ ◄──────────────────► │  MCP Server │ ◄─────────────►  │  Python API     │
│  (Frontend) │                    │     (Go)        │                      │  (Node.js)  │                  │  (FastAPI)      │
└─────────────┘                    └─────────────────┘                      └─────────────┘                  └─────────────────┘
```

### Components

1. **Neuclea Backend (Go)**:
   - WebSocket server for real-time communication
   - ReAct agent with LLM-powered reasoning
   - Session management and telemetry
   - MCP client for tool execution

## Features

- **ReAct Agent**: Think -> Act -> Observe loop with LLM reasoning
- **Tool Calling**: Execute external tools via MCP protocol
- **Session Management**: Isolated sessions with telemetry
- **Real-time Communication**: WebSocket for live updates
- **Predictor**: Markov-style tool transition prediction
- **Health Checks**: Periodic MCP endpoint monitoring

## Prerequisites

- Go 1.21+
- Ollama (local) or Fireworks API key
- MCP Server (Node.js) running
- Python API (FastAPI) running

## Configuration

### Environment Variables

| Variable            | Description                            | Default                                           |
| ------------------- | -------------------------------------- | ------------------------------------------------- |
| `LLM_PROVIDER`      | LLM provider (`ollama` or `fireworks`) | `ollama`                                          |
| `OLLAMA_MODEL`      | Ollama model name                      | `llama3`                                          |
| `FIREWORKS_API_KEY` | Fireworks API key                      | -                                                 |
| `FIREWORKS_MODEL`   | Fireworks model                        | `accounts/fireworks/models/llama-v3-70b-instruct` |
| `OLLAMA_URL`        | Ollama API URL                         | `http://localhost:11434`                          |

### Example `.env`

```env
LLM_PROVIDER=ollama
FIREWORKS_API_KEY=your_key_here
OLLAMA_MODEL=llama3.2:1b
FIREWORKS_MODEL=accounts/fireworks/models/llama-v3-70b-instruct
```

## Project Structure

```
neuclea/
├── main.go                 # Entry point, server setup
├── agent/
│   └── agent.go           # ReAct agent implementation
├── handlers/
│   ├── websocket.go       # WebSocket handlers
│   └── agents.go          # Agent configuration schema
├── llm/
│   ├── fireworks.go       # Fireworks AI client
│   └── client.go          # LLM client interface
├── mcp/
│   ├── client.go          # MCP protocol client
│   └── pool.go            # MCP connection pool
├── predictor/
│   └── simple.go          # Markov-style predictor
└── intent/
    └── classifier.go      # Intent classification
```

## How It Works

### ReAct Loop

1. **Think**: LLM analyzes the query and decides the next action
2. **Act**: Execute a tool call or provide a final answer
3. **Observe**: Process the tool result and feed back to the LLM

### Tool Execution Flow

1. User sends query via WebSocket
2. Agent enters ReAct loop
3. LLM decides which tool to call
4. Agent calls MCP client with tool name and parameters
5. MCP server forwards to Python API
6. Python API returns data
7. Agent formats response and streams back to user

### Session Management

- Each WebSocket connection gets a unique session ID
- Sessions store tool configurations and telemetry
- Idle sessions are automatically cleaned up (2-minute timeout)
- All sessions are visible via `/telemetry` endpoint

### Predictor

- Tracks tool transitions (Tool A → Tool B)
- Predicts next likely tools for autocomplete
- Used for pre-warming MCP connections

## Troubleshooting

### Common Issues

1. **MCP Connection Failed**
   - Ensure MCP server is running on `http://localhost:3000`
   - Check MCP server logs for errors

2. **LLM Not Responding**
   - Verify Ollama is running: `ollama ps`
   - Check model is installed: `ollama list`
   - For Fireworks, verify API key is valid

3. **Tool Type Errors**
   - Ensure `page` and `limit` are numbers, not strings
   - Check `agents.json` schema matches actual API

4. **WebSocket Connection Issues**
   - Verify frontend is using correct URL: `ws://localhost:8080/ws`
   - Check for CORS issues

## Performance Tuning

- **Max Steps**: Adjust `Agent.MaxSteps` (default: 30)
- **Timeout**: Adjust `context.WithTimeout` (default: 180s)
- **Idle Timeout**: Adjust `Handler.IdleTimeout` (default: 2min)
- **MCP Pool**: Pool manages multiple MCP endpoints

## Dependencies

- [gorilla/websocket](https://github.com/gorilla/websocket) - WebSocket support
- [joho/godotenv](https://github.com/joho/godotenv) - Environment variables

## License

Apache
