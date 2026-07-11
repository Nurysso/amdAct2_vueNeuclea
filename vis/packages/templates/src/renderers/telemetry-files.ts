export function renderTelemetryTypes(): string {
  return `
export interface TelemetryConfig {
  enabled: boolean;
  environment: 'development' | 'staging' | 'production';
  serviceName: string;
  serviceVersion?: string;

  metrics?: {
    enabled: boolean;
    /** Port for the Prometheus /metrics endpoint. Default: 9090 */
    port?: number;
    /** Metric name prefix, e.g. "mcp". Default: "mcp" */
    prefix?: string;
    /** Default labels added to every metric */
    defaultLabels?: Record<string, string>;
  };

  logs?: {
    enabled: boolean;
    level?: 'debug' | 'info' | 'warn' | 'error';
    /** Loki push URL, e.g. "http://loki:3100" */
    lokiUrl?: string;
    /** Extra labels sent to Loki with every log line */
    lokiLabels?: Record<string, string>;
    /** Batch interval in ms. Default: 5000 */
    lokiBatchInterval?: number;
  };

  traces?: {
    enabled: boolean;
    /** OTLP/HTTP endpoint for Tempo, e.g. "http://tempo:4318" */
    otlpEndpoint?: string;
    /** 0.0–1.0. Default: 1.0 */
    sampleRate?: number;
  };
}

export interface ToolUsage {
  toolName: string;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  error?: string;
  args: Record<string, unknown>;
  result?: unknown;
  metadata?: {
    traceId?: string;
    spanId?: string;
    operationId?: string;
    sessionId?: string;
    userId?: string;
    tags?: Record<string, string>;
  };
}

export interface TelemetryData {
  toolName: string;
  duration: number;
  success: boolean;
  error?: string;
  timestamp: number;
  traceId?: string;
  spanId?: string;
  userId?: string;
  sessionId?: string;
  operationId?: string;
  tags?: Record<string, string>;
}
`;
}

export function renderTelemetryMetrics(): string {
  return `
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
    promClient.collectDefaultMetrics({ register: this.registry, prefix: \`\${prefix}_node_\` });

    this.toolCallsTotal = new promClient.Counter({
      name: \`\${prefix}_tool_calls_total\`,
      help: 'Total number of MCP tool invocations',
      labelNames: ['tool', 'status'],
      registers: [this.registry],
    });

    this.toolDurationSeconds = new promClient.Histogram({
      name: \`\${prefix}_tool_duration_seconds\`,
      help: 'Latency of MCP tool invocations in seconds',
      labelNames: ['tool', 'status'],
      // Buckets cover fast in-process calls up to slow I/O-bound tools
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.activeTools = new promClient.Gauge({
      name: \`\${prefix}_active_tools\`,
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
      console.log(\`[metrics] Prometheus endpoint → http://localhost:\${port}/metrics\`);
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
`;
}

export function renderTelemetryLogs(): string {
  return `
import winston from 'winston';
import LokiTransport from 'winston-loki';
import type { TelemetryConfig, ToolUsage } from './telemetry-types.js';

const SENSITIVE_KEYS = new Set(['password', 'token', 'secret', 'key', 'auth', 'authorization', 'cookie']);

/**
 * Structured log collector that ships to Grafana Loki.
 *
 * Loki datasource in Grafana should be configured to scrape
 * the same URL supplied in config.logs.lokiUrl (default: http://loki:3100).
 *
 * Useful LogQL queries:
 *   {service="<serviceName>"}
 *   {service="<serviceName>", tool="<toolName>"} | json | duration_ms > 500
 */
export class LogCollector {
  private readonly logger: winston.Logger;

  constructor(private readonly config: TelemetryConfig) {
    const transports: winston.transport[] = [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
            return \`[\${timestamp}] [\${level}] \${message}\${metaStr}\`;
          }),
        ),
      }),
    ];

    if (config.logs?.enabled && config.logs.lokiUrl) {
      transports.push(
        new LokiTransport({
          host: config.logs.lokiUrl,
          batching: true,
          interval: (config.logs.lokiBatchInterval ?? 5000) / 1000,
          labels: {
            service: config.serviceName,
            env: config.environment,
            version: config.serviceVersion ?? 'unknown',
            ...(config.logs.lokiLabels ?? {}),
          },
          // Ship the full JSON line so Loki can parse fields with | json
          format: winston.format.json(),
          onConnectionError: (err: Error) =>
            console.error('[loki] connection error:', err.message),
        }),
      );
      console.log(\`[logs] Loki transport → \${config.logs.lokiUrl}\`);
    }

    this.logger = winston.createLogger({
      level: config.logs?.level ?? 'info',
      transports,
      // Merge service-level fields into every log entry
      defaultMeta: {
        service: config.serviceName,
        env: config.environment,
      },
    });
  }

  logToolUsage(usage: ToolUsage): void {
    const fields = {
      tool: usage.toolName,
      duration_ms: usage.duration,
      success: usage.success,
      trace_id: usage.metadata?.traceId,
      span_id: usage.metadata?.spanId,
      operation_id: usage.metadata?.operationId,
      session_id: usage.metadata?.sessionId,
      user_id: usage.metadata?.userId,
      args: this.sanitize(usage.args),
      ...(usage.metadata?.tags ?? {}),
    };

    if (usage.success) {
      this.logger.info(\`tool.\${usage.toolName}.ok\`, fields);
    } else {
      this.logger.error(\`tool.\${usage.toolName}.error\`, {
        ...fields,
        error: usage.error,
      });
    }
  }

  logRequest(method: string, params: unknown): void {
    this.logger.debug('mcp.request', {
      method,
      params: this.sanitize(params),
    });
  }

  logResponse(method: string, result: unknown): void {
    this.logger.debug('mcp.response', {
      method,
      result: this.truncate(result),
    });
  }

  private sanitize(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : v;
    }
    return out;
  }

  private truncate(value: unknown): unknown {
    try {
      const s = JSON.stringify(value);
      return s.length > 1000 ? { _truncated: true, length: s.length } : value;
    } catch {
      return String(value);
    }
  }
}
`;
}

export function renderTelemetryTraces(): string {
  return `
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import {
  trace,
  context,
  SpanStatusCode,
  type Span,
  type Tracer,
} from '@opentelemetry/api';
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import type { TelemetryConfig } from './telemetry-types.js';

export class TraceCollector {
  private readonly tracer: Tracer;
  private readonly activeSpans = new Map<string, Span>();
  private sdk: NodeSDK | null = null;

  constructor(private readonly config: TelemetryConfig) {
    if (!config.traces?.enabled) {
      // Return a no-op tracer; no SDK started.
      this.tracer = trace.getTracer('noop');
      return;
    }

    const otlpEndpoint = config.traces.otlpEndpoint ?? 'http://tempo:4318';
    const sampleRate = config.traces.sampleRate ?? 1.0;

    const exporter = new OTLPTraceExporter({
      url: \`\${otlpEndpoint}/v1/traces\`,
    });

    this.sdk = new NodeSDK({
      resource: new Resource({
        [SEMRESATTRS_SERVICE_NAME]: config.serviceName,
        [SEMRESATTRS_SERVICE_VERSION]: config.serviceVersion ?? 'unknown',
        environment: config.environment,
      }),
      traceExporter: exporter,
      sampler: new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(sampleRate),
      }),
    });

    this.sdk.start();
    console.log(\`[traces] OTLP/HTTP → \${otlpEndpoint} (sample rate: \${sampleRate})\`);

    // Flush spans on exit
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT',  () => this.shutdown());

    this.tracer = trace.getTracer(config.serviceName, config.serviceVersion);
  }

  startToolSpan(toolName: string, args: Record<string, unknown>): string {
    if (!this.config.traces?.enabled) return '';

    const span = this.tracer.startSpan(\`tool/\${toolName}\`, {
      attributes: {
        'mcp.tool.name': toolName,
        // Avoid logging sensitive args values; just capture the keys
        'mcp.tool.arg_keys': Object.keys(args).join(','),
      },
    });

    const spanId = span.spanContext().spanId;
    this.activeSpans.set(spanId, span);
    return spanId;
  }

  /** Closes the span and sets its final status. */
  endToolSpan(spanId: string, success: boolean, error?: string): void {
    if (!this.config.traces?.enabled || !spanId) return;

    const span = this.activeSpans.get(spanId);
    if (!span) return;

    if (success) {
      span.setStatus({ code: SpanStatusCode.OK });
    } else {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error });
      if (error) span.recordException(new Error(error));
    }

    span.end();
    this.activeSpans.delete(spanId);
  }

  /** Returns the active trace ID from the OTel context (for Loki correlation). */
  currentTraceId(): string | undefined {
    return trace.getActiveSpan()?.spanContext().traceId;
  }

  async shutdown(): Promise<void> {
    if (this.sdk) {
      await this.sdk.shutdown().catch((err: Error) =>
        console.error('[traces] shutdown error:', err.message),
      );
    }
  }
}
`;
}

export function renderTelemetryIndex(): string {
  return `
import { MetricsCollector } from './telemetry-metrics.js';
import { LogCollector }     from './telemetry-logs.js';
import { TraceCollector }   from './telemetry-traces.js';
import type { TelemetryConfig, ToolUsage } from './telemetry-types.js';

export class Telemetry {
  public readonly isEnabled: boolean;
  private metrics!: MetricsCollector;
  private logs!: LogCollector;
  private traces!: TraceCollector;

  constructor(private readonly config: TelemetryConfig) {
    this.isEnabled = config.enabled;

    if (!this.isEnabled) {
      console.log('[telemetry] disabled');
      return;
    }

    try {
      this.metrics = new MetricsCollector(config);
      this.logs    = new LogCollector(config);
      this.traces  = new TraceCollector(config);

      console.log('[telemetry] initialized');
      console.log(\`  metrics → \${config.metrics?.enabled  ? \`http://localhost:\${config.metrics.port ?? 9090}/metrics\` : 'off'}\`);
      console.log(\`  logs    → \${config.logs?.enabled     ? (config.logs.lokiUrl ?? 'console only') : 'off'}\`);
      console.log(\`  traces  → \${config.traces?.enabled   ? (config.traces.otlpEndpoint ?? 'http://tempo:4318') : 'off'}\`);
    } catch (err) {
      console.error('[telemetry] initialization failed, disabling:', err);
      (this as { isEnabled: boolean }).isEnabled = false;
    }
  }

  /**
   * Opens a tracing span for a tool call.
   * Store the returned spanId and pass it back via ToolUsage.metadata.traceId.
   */
  startToolTrace(toolName: string, args: Record<string, unknown>): string {
    if (!this.isEnabled) return '';
    try {
      const spanId = this.traces.startToolSpan(toolName, args);
      this.metrics.recordToolStart(toolName);
      return spanId;
    } catch { return ''; }
  }

  /**
   * Records the completed tool call across all three backends:
   *   - Prometheus counter + histogram
   *   - Loki structured log line (with trace_id for correlation)
   *   - Closes the Tempo span
   */
  recordToolUsage(usage: ToolUsage): void {
    if (!this.isEnabled) return;
    try {
      // Enrich with the active OTel trace ID so Loki ↔ Tempo correlation works
      const traceId = usage.metadata?.traceId ?? this.traces.currentTraceId();
      const enriched: ToolUsage = {
        ...usage,
        metadata: { ...usage.metadata, traceId },
      };

      this.metrics.recordToolEnd(enriched);
      this.logs.logToolUsage(enriched);

      if (traceId) {
        this.traces.endToolSpan(traceId, enriched.success, enriched.error);
      }
    } catch (err) {
      console.error('[telemetry] recordToolUsage failed:', err);
    }
  }

  logRequest(method: string, params: unknown): void {
    if (!this.isEnabled) return;
    try { this.logs.logRequest(method, params); } catch { /* silent */ }
  }

  logResponse(method: string, result: unknown): void {
    if (!this.isEnabled) return;
    try { this.logs.logResponse(method, result); } catch { /* silent */ }
  }

  async getMetrics(): Promise<string> {
    if (!this.isEnabled) return '';
    try { return await this.metrics.getMetrics(); } catch { return ''; }
  }

  async stop(): Promise<void> {
    if (!this.isEnabled) return;
    this.metrics.stopServer();
    await this.traces.shutdown();
  }
}

export * from './telemetry-types.js';
`;
}

export function telemetryDependencies(): Record<string, string> {
  return {
    'prom-client': '^15.1.3',
    express: '^4.19.2',
    winston: '^3.13.1',
    'winston-loki': '^6.1.0',
    '@opentelemetry/sdk-node': '^0.52.1',
    '@opentelemetry/exporter-trace-otlp-http': '^0.52.1',
    '@opentelemetry/resources': '^1.25.1',
    '@opentelemetry/semantic-conventions': '^1.25.1',
    '@opentelemetry/api': '^1.9.0',
    '@opentelemetry/sdk-trace-base': '^1.25.1',
  };
}

export function telemetryDevDependencies(): Record<string, string> {
  return {
    '@types/express': '^4.17.21',
  };
}
