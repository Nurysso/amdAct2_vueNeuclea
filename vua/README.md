# Vis (Force) — MCP Code Generator

> _"Vis" — Latin for "force, power, strength"_
> Part of Team Voyager's AMD Hackathon Project: **VisNeucla**

Vis is a powerful code generation tool that transforms OpenAPI 3.x specifications into fully functional Model Context Protocol (MCP) servers. Built with TypeScript and designed for the AMD Hackathon, Vis makes it effortless to create MCP-compatible API servers from any REST API.

## 🚀 Overview

Vis (pronounced "vis") automatically generates a complete, production-ready MCP server from your OpenAPI specification. The generated server includes:

- ✅ Type-safe tool definitions with Zod validation
- ✅ Automatic parameter handling (query, path, header, body)
- ✅ Clean JSON Schema output for tool discovery
- ✅ Proper error handling and response formatting
- ✅ Deterministic generation (pure functions, no side effects)
- ✅ Support for complex schemas (allOf, oneOf, anyOf, arrays, objects)

## 🎯 Use Cases

- **API Integration**: Quickly create MCP servers for any REST API
- **Microservices**: Generate consistent MCP interfaces for microservices
- **Prototyping**: Rapidly prototype MCP servers from OpenAPI specs
- **Legacy APIs**: Modernize legacy APIs with MCP support
- **AI Tools**: Enable LLMs to interact with your APIs via MCP

## 🏗️ Architecture

Vis follows a strict modular architecture with a dependency graph rooted at the core package:

```
┌─────────┐
│   CLI   │  Command-line interface
└────┬────┘
     │
┌────▼────┐
│Generator│  File writing & npm installation
└────┬────┘
     │
┌────▼────┐
│Templates│  MCP server generation
└────┬────┘
     │
┌────▼────┐
│ Parser  │  OpenAPI parsing & IR conversion
└────┬────┘
     │
┌────▼────┐
│  Core   │  IR types & interfaces (root)
└─────────┘
```

### Design Principles

1. **Strict Dependency Management**: `core` at the root with no circular dependencies
2. **Deterministic Generation**: Pure `render()` functions ensure identical output for same input
3. **Extension Points**: Authentication and transport swaps are documented in the IR
4. **Schema Fidelity**: Full support for OpenAPI schemas including circular references
5. **Separation of Concerns**: Each package has a single, well-defined responsibility

## 📦 Packages

| Package          | Description             | Version |
| ---------------- | ----------------------- | ------- |
| `@vis/core`      | IR types and interfaces | 0.1.0   |
| `@vis/parser`    | OpenAPI 3.x parser      | 0.1.0   |
| `@vis/templates` | MCP server templates    | 0.1.0   |
| `@vis/generator` | File system generator   | 0.1.0   |
| `@vis/cli`       | Command-line interface  | 0.1.0   |

## 🛠️ Installation

### Global Installation

```bash
npm install -g @vis/cli
# or
pnpm add -g @vis/cli
```

### Local Development

```bash
git clone https://github.com/yourusername/vis.git
cd vis
pnpm install
pnpm build:all
```

## Quick Start

### 1. Generate a Server

```bash
# From a local OpenAPI file
vis build ./openapi.yaml --out ./my-mcp-server

# From a URL
vis build https://api.example.com/openapi.json --out ./my-mcp-server
```

### 2. Build and Run

```bash
cd ./my-mcp-server
npm install
npm run build
node dist/index.js
```

### 3. Test the Server

```bash
# List available tools
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/index.js

# Call a tool
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"getUser","arguments":{"id":123}}}' | node dist/index.js
```

## 🔧 CLI Options

```
vis build <spec> [options]

Arguments:
  <spec>      Path to OpenAPI 3.x JSON/YAML file, or a URL

Options:
  -o, --out <dir>          Output directory (default: ./mcp-server)
  --base-url <url>         Override the upstream API base URL
  --package-name <name>    npm package name for the generated server
  --package-version <ver>  Semver for the generated server (default: 0.1.0)
  --force                  Overwrite output directory if it exists
  --no-install             Skip running npm install after generation
  --typecheck              Run tsc --noEmit after install
  -h, --help               Show help message
  -v, --version            Print version
```

### Examples

```bash
# Generate from local file
vis build ./openapi.json --out ./my-server

# Generate from URL with custom base URL
vis build http://localhost:8000/openapi.json --out ./my-server --base-url https://api.example.com

# Force overwrite with typecheck
vis build ./api.yaml --out ./my-server --force --typecheck
```

## 🧪 Testing

```bash
# Run all tests
pnpm test

# Test specific package
pnpm --filter @vis/core test
pnpm --filter @vis/parser test
```

## License

ApacheV2 — See [LICENSE](../LICENSE) for details.

## Acknowledgments

- Built for the **AMD Hackathon** as part of **Team Voyager's VisNeucla** project
- Powered by the [Model Context Protocol (MCP)](https://modelcontextprotocol.io)

---

**Vis — Turning OpenAPI into MCP with Force** 💪
