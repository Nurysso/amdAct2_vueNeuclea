
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
      url: `${otlpEndpoint}/v1/traces`,
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
    console.log(`[traces] OTLP/HTTP → ${otlpEndpoint} (sample rate: ${sampleRate})`);

    // Flush spans on exit
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT',  () => this.shutdown());

    this.tracer = trace.getTracer(config.serviceName, config.serviceVersion);
  }

  startToolSpan(toolName: string, args: Record<string, unknown>): string {
    if (!this.config.traces?.enabled) return '';

    const span = this.tracer.startSpan(`tool/${toolName}`, {
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
