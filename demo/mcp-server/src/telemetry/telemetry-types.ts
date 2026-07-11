
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
