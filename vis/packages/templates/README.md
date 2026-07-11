# @vis/templates — MCP Server Templates

Generates a complete, runnable MCP server from a Vis IR `ServiceSpec`.

## Features

- ✅ **Pure Rendering**: No side effects, no randomness — deterministic output
- ✅ **TypeScript**: Generated server is fully typed with TypeScript
- ✅ **Zod Validation**: Schema validation at tool call time
- ✅ **JSON Schema**: Clean JSON Schema output for tool discovery
- ✅ **HTTP Client**: Built-in HTTP client for API calls
- ✅ **Configurable**: Environment variables for runtime configuration
- ✅ **Production-Ready**: Proper error handling, logging, and exit codes

## Generated Structure

```

my-mcp-server/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│ ├── index.ts # MCP server entry point
│ ├── config.ts # Runtime configuration
│ ├── types.ts # Type definitions
│ ├── http-client.ts # HTTP client
│ └── tools/
│ ├── operation1.ts # Tool for operation 1
│ ├── operation2.ts # Tool for operation 2
│ └── ...

```

## Tool Rendering

Each OpenAPI operation becomes an MCP tool with:

- **Input Schema**: Zod schema derived from the operation's parameters and request body
- **Validation**: Automatic Zod validation at tool call time
- **Execution**: HTTP client call to the upstream API
- **Error Handling**: Proper error responses for failed API calls

## Usage

```typescript
import { StdioTemplateEngine } from '@vis/templates';
import type { ServiceSpec } from '@vis/core';

const engine = new StdioTemplateEngine();
const fileTree = await engine.render(spec, {
  packageName: 'my-api-server',
  packageVersion: '0.1.0',
});
```

## Extension Points

The generated server has documented extension points:

### Authentication

The `ServiceSpec.securitySchemes` field carries auth metadata. Inject headers in:

- `src/http-client.ts` — Header injection point
- `src/config.ts` — Environment variables (e.g., `MCP_API_TOKEN`)

### Transport

The IR `transport` field supports:

- `"stdio"` — ✅ Implemented (StdioServerTransport)
- `"sse"` — 🔜 IR-supported, implementation pending
- `"http"` — 🔜 IR-supported, implementation pending

Swap the transport in `src/index.ts` by replacing `StdioServerTransport`.

## License

ApacheV2 [LICENSE](../../../LICENSE)
