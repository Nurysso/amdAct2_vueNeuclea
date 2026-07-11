import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import cors from 'cors';
import express, { Request, Response } from 'express';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { TelemetryConfig } from './telemetry/index.js';
import { Telemetry } from './telemetry/index.js';
import type { ToolDefinition } from './types.js';
import { list_products_api_products_getTool } from "./tools/list_products_api_products_get.js";
import { get_product_api_products__product_id__getTool } from "./tools/get_product_api_products__product_id__get.js";
import { list_categories_api_categories_getTool } from "./tools/list_categories_api_categories_get.js";

// Validate environment variables
const validEnvironments = ['development', 'staging', 'production'] as const;
const validLogLevels = ['debug', 'info', 'warn', 'error'] as const;

const telemetryConfig: TelemetryConfig = {
  enabled: process.env.TELEMETRY_ENABLED === 'true',
  serviceName: "novamart-api",
  serviceVersion: "1.0.0",
  environment: validEnvironments.includes(process.env.NODE_ENV as any)
    ? (process.env.NODE_ENV as (typeof validEnvironments)[number])
    : 'development',
  metrics: {
    enabled: process.env.METRICS_ENABLED !== 'false',
    port: parseInt(process.env.METRICS_PORT || '9090', 10),
    prefix: process.env.METRICS_PREFIX || 'mcp',
  },
  logs: {
    enabled: process.env.LOGS_ENABLED !== 'false',
    level: validLogLevels.includes(process.env.LOG_LEVEL as any)
      ? (process.env.LOG_LEVEL as (typeof validLogLevels)[number])
      : 'info',
    lokiUrl: process.env.LOKI_URL,
    lokiBatchInterval: parseInt(process.env.LOKI_BATCH_MS || '5000', 10),
  },
  traces: {
    enabled: process.env.TRACES_ENABLED === 'true',
    otlpEndpoint: process.env.OTLP_ENDPOINT || 'http://tempo:4318',
    sampleRate: parseFloat(process.env.TRACE_SAMPLE_RATE || '0.1'),
  },
};

const telemetry = new Telemetry(telemetryConfig);

//  Tool registry

const TOOLS: ToolDefinition[] = [
  list_products_api_products_getTool,
  get_product_api_products__product_id__getTool,
  list_categories_api_categories_getTool,
];

const toolMap = new Map<string, ToolDefinition>(
  TOOLS.map((t) => [t.name, t])
);

//  MCP Server

const server = new Server(
  { name: "novamart-api", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: zodToJsonSchema(t.inputSchema),
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
  const tool = toolMap.get(request.params.name);
  if (!tool) {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const startTime = Date.now();
  const traceId = telemetry.startToolTrace(request.params.name, request.params.arguments);

  telemetry.logRequest('tools/call', {
    name: request.params.name,
    arguments: request.params.arguments,
  });

  try {
    const parsed = tool.inputSchema.safeParse(request.params.arguments ?? {});
    if (!parsed.success) {
      const error = `Invalid arguments: ${parsed.error.message}`;
       telemetry.recordToolUsage({
        toolName: request.params.name,
        startTime,
        endTime: Date.now(),
        duration: Date.now() - startTime,
        success: false,
        error,
        args: request.params.arguments,
        metadata: { traceId },
      });
      throw new Error(error);
    }

    const result = await tool.execute(parsed.data);

    telemetry.recordToolUsage({
      toolName: request.params.name,
      startTime,
      endTime: Date.now(),
      duration: Date.now() - startTime,
      success: true,
      args: request.params.arguments,
      result,
      metadata: { traceId },
    });

    telemetry.logResponse('tools/call', result);

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

    telemetry.recordToolUsage({
      toolName: request.params.name,
      startTime,
      endTime: Date.now(),
      duration: Date.now() - startTime,
      success: false,
      error: message,
      args: request.params.arguments,
      metadata: { traceId },
    });

    return {
      content: [{ type: "text" as const, text: `Error: ${message}` }],
      isError: true,
    };
  }
});

//  Transport: HTTP/SSE Server

async function startHttpServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Health check endpoint
  app.get("/health", (req: Request, res: Response) => {
    res.json({ status: "ok", server: "novamart-api" });
  });

  // Metrics endpoint — proxies to the dedicated Prometheus port so Grafana
  // dashboards can also hit the main app URL for convenience.
  // The authoritative scrape target for Prometheus remains METRICS_PORT (default 9090).
  app.get("/metrics", async (req: Request, res: Response) => {
    if (!telemetry.isEnabled) {
      return res.status(404).send('Telemetry disabled. Set TELEMETRY_ENABLED=true to enable.');
    }
    try {
      const metrics = await telemetry.getMetrics();
      res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.send(metrics);
    } catch (error) {
      res.status(500).send('Error collecting metrics');
    }
  });

  // List tools endpoint (convenience)
  app.get("/tools", async (req: Request, res: Response) => {
    try {
      const tools = TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: zodToJsonSchema(t.inputSchema),
      }));
      res.json({ tools });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // MCP endpoint for SSE
  app.get("/sse", async (req: Request, res: Response) => {
    const transport = new SSEServerTransport("/messages", res);
    await server.connect(transport);
  });

  // MCP endpoint for messages
  app.post("/messages", async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    // Note: WE need to track transports per session in production
    // This is a simplified version
    try {
      const transport = new SSEServerTransport("/messages", res);
      await server.connect(transport);
      // Handle the message
      await transport.handlePostMessage(req, res);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // MCP endpoint for HTTP (JSON-RPC over HTTP)
  app.post("/mcp", async (req: Request, res: Response) => {
    try {
      const { method, params, id } = req.body;

      // Map HTTP request to MCP server request
      const request = {
        jsonrpc: "2.0",
        id: id || Math.random(),
        method,
        params: params || {},
      };

      // Handle the request through the server
      // This is a simplified approach; for production,
      // use proper MCP HTTP transport
      let response;

      if (method === "tools/list") {
        const tools = TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: zodToJsonSchema(t.inputSchema),
        }));
        response = { jsonrpc: "2.0", id: request.id, result: { tools } };
      } else if (method === "tools/call") {
        const tool = toolMap.get(params.name);
        if (!tool) {
          throw new Error(`Unknown tool: ${params.name}`);
        }

        const parsed = tool.inputSchema.safeParse(params.arguments ?? {});
        if (!parsed.success) {
          throw new Error(
            `Invalid arguments for ${params.name}: ${parsed.error.message}`
          );
        }

        try {
          const result = await tool.execute(parsed.data);
          response = {
            jsonrpc: "2.0",
            id: request.id,
            result: {
              content: [
                {
                  type: "text" as const,
                  text: typeof result === "string"
                    ? result
                    : JSON.stringify(result, null, 2),
                },
              ],
            },
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          response = {
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32000,
              message: message,
            },
          };
        }
      } else {
        response = {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        };
      }

      res.json(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        jsonrpc: "2.0",
        id: req.body.id || null,
        error: { code: -32000, message },
      });
    }
  });

  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  app.listen(PORT, () => {
    process.stderr.write(`MCP server "${"novamart-api"}" started on http://localhost:${PORT}\n`);
    process.stderr.write(`  - SSE: http://localhost:${PORT}/sse\n`);
    process.stderr.write(`  - HTTP: http://localhost:${PORT}/mcp\n`);
    process.stderr.write(`  - Tools: http://localhost:${PORT}/tools\n`);
    process.stderr.write(`  - Health: http://localhost:${PORT}/health\n`);
    if (telemetry.isEnabled) {
      const metricsPort = process.env.METRICS_PORT || '9090';
      process.stderr.write(`  - Metrics (Prometheus): http://localhost:${metricsPort}/metrics\n`);
      if (process.env.LOKI_URL) {
        process.stderr.write(`  - Logs (Loki): ${process.env.LOKI_URL}\n`);
      }
      if (process.env.TRACES_ENABLED === 'true') {
        process.stderr.write(`  - Traces (Tempo OTLP): ${process.env.OTLP_ENDPOINT || 'http://tempo:4318'}\n`);
      }
    } else {
      process.stderr.write(`  - Telemetry: disabled (set TELEMETRY_ENABLED=true)\n`);
    }
  });
}

//  Startup

async function main() {
  const transportType = process.env.MCP_TRANSPORT || "stdio";

  if (transportType === "stdio") {
    // Stdio transport (default for Claude Desktop)
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write(`MCP server "${"novamart-api"}" started (stdio)\n`);
    if (telemetry.isEnabled) {
      const metricsPort = process.env.METRICS_PORT || '9090';
      process.stderr.write(`[telemetry] Prometheus → http://localhost:${metricsPort}/metrics\n`);
      if (process.env.LOKI_URL) {
        process.stderr.write(`[telemetry] Loki → ${process.env.LOKI_URL}\n`);
      }
      if (process.env.TRACES_ENABLED === 'true') {
        process.stderr.write(`[telemetry] Tempo → ${process.env.OTLP_ENDPOINT || 'http://tempo:4318'}\n`);
      }
    }
  } else if (transportType === "sse" || transportType === "http") {
    // HTTP/SSE transport for web-based clients
    await startHttpServer();
  } else {
    process.stderr.write(`Unknown transport type: ${transportType}\n`);
    process.stderr.write("Supported: stdio, sse, http\n");
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
