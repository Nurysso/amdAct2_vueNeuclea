
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
      console.log(`  metrics → ${config.metrics?.enabled  ? `http://localhost:${config.metrics.port ?? 9090}/metrics` : 'off'}`);
      console.log(`  logs    → ${config.logs?.enabled     ? (config.logs.lokiUrl ?? 'console only') : 'off'}`);
      console.log(`  traces  → ${config.traces?.enabled   ? (config.traces.otlpEndpoint ?? 'http://tempo:4318') : 'off'}`);
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
