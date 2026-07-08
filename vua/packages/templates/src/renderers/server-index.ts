import type { ServiceSpec } from '@vis/core';

export function renderServerIndex(spec: ServiceSpec): string {
  const toolImports = spec.operations
    .map((op) => `import { ${op.operationId}Tool } from "./tools/${op.operationId}.js";`)
    .join('\n');

  const toolRegistrations = spec.operations.map((op) => `  ${op.operationId}Tool,`).join('\n');

  const serverName = slugify(spec.title);
  const serverVersion = spec.version;

  return `
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { BASE_URL } from "./config.js";
import type { ToolDefinition } from "./types.js";
${toolImports}

//  Tool registry

const TOOLS: ToolDefinition[] = [
${toolRegistrations}
];

const toolMap = new Map<string, ToolDefinition>(
  TOOLS.map((t) => [t.name, t])
);

//  MCP Server

const server = new Server(
  { name: ${JSON.stringify(serverName)}, version: ${JSON.stringify(serverVersion)} },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: zodToJsonSchema(t.inputSchema),
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = toolMap.get(request.params.name);
  if (!tool) {
    throw new Error(\`Unknown tool: \${request.params.name}\`);
  }

  const parsed = tool.inputSchema.safeParse(request.params.arguments ?? {});
  if (!parsed.success) {
    throw new Error(
      \`Invalid arguments for \${request.params.name}: \${parsed.error.message}\`
    );
  }

  try {
    const result = await tool.execute(parsed.data);
    return {
      content: [
        {
          type: "text" as const,
          text: typeof result === "string"
            ? result
            : JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text" as const, text: \`Error: \${message}\` }],
      isError: true,
    };
  }
});

//  Startup

async function main() {
  // Transport: stdio (SSE and HTTP are IR-supported extension points)
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    \`MCP server "\${${JSON.stringify(serverName)}}" started (stdio)\\n\`
  );
}

main().catch((err) => {
  process.stderr.write(\`Fatal: \${err instanceof Error ? err.message : err}\\n\`);
  process.exit(1);
});
`.trimStart();
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
