
import express from 'express';
import * as promClient from 'prom-client';
import type { TelemetryConfig, ToolUsage } from './telemetry-types.js';

export class MetricsCollector {
  private readonly registry: promClient.Registry;
  private readonly toolCallsTotal: promClient.Counter<'tool' | 'status'>;
  private readonly toolDurationSeconds: promClient.Histogram<'tool' | 'status'>;
  private readonly activeTools: promClient.Gauge<'tool'>;
  private server: ReturnType<express.Application['listen']> | null = null;

  constructor(private readonly config: TelemetryConfig) {
    const prefix = config.metrics?.prefix ?? 'mcp';
    const defaultLabels = {
      service: config.serviceName,
      env: config.environment,
      ...(config.metrics?.defaultLabels ?? {}),
    };

    this.registry = new promClient.Registry();
    this.registry.setDefaultLabels(defaultLabels);

    // Collect default Node.js metrics (event loop lag, GC, memory, etc.)
    promClient.collectDefaultMetrics({ register: this.registry, prefix: `${prefix}_node_` });

    this.toolCallsTotal = new promClient.Counter({
      name: `${prefix}_tool_calls_total`,
      help: 'Total number of MCP tool invocations',
      labelNames: ['tool', 'status'],
      registers: [this.registry],
    });

    this.toolDurationSeconds = new promClient.Histogram({
      name: `${prefix}_tool_duration_seconds`,
      help: 'Latency of MCP tool invocations in seconds',
      labelNames: ['tool', 'status'],
      // Buckets cover fast in-process calls up to slow I/O-bound tools
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.activeTools = new promClient.Gauge({
      name: `${prefix}_active_tools`,
      help: 'Number of tool calls currently in flight',
      labelNames: ['tool'],
      registers: [this.registry],
    });

    if (config.metrics?.enabled) {
      this.startServer(config.metrics.port ?? 9090);
    }
  }

  private startServer(port: number): void {
    const app = express();

    app.get('/metrics', async (_req, res) => {
      try {
        res.set('Content-Type', this.registry.contentType);
        res.end(await this.registry.metrics());
      } catch (err) {
        res.status(500).end(String(err));
      }
    });

    app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

    this.server = app.listen(port, () => {
      console.log(`[metrics] Prometheus endpoint → http://localhost:${port}/metrics`);
    });
  }

  recordToolStart(toolName: string): void {
    this.activeTools.inc({ tool: toolName });
  }

  recordToolEnd(usage: ToolUsage): void {
    const status = usage.success ? 'success' : 'error';
    const durationSeconds = usage.duration / 1000;

    this.activeTools.dec({ tool: usage.toolName });
    this.toolCallsTotal.inc({ tool: usage.toolName, status });
    this.toolDurationSeconds.observe({ tool: usage.toolName, status }, durationSeconds);
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  stopServer(): void {
    this.server?.close();
  }
}
