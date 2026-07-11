
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
            return `[${timestamp}] [${level}] ${message}${metaStr}`;
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
      console.log(`[logs] Loki transport → ${config.logs.lokiUrl}`);
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
      this.logger.info(`tool.${usage.toolName}.ok`, fields);
    } else {
      this.logger.error(`tool.${usage.toolName}.error`, {
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
