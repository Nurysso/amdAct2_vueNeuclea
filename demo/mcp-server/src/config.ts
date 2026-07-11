/**
 * Runtime configuration for the generated MCP server.
 *
 *   MCP_BASE_URL      Override the upstream API base URL.
 *
 *   MCP_TRANSPORT     "stdio" (default, for Claude Desktop) | "sse" | "http"
 *   PORT              HTTP server port when using sse/http transport. Default 3000.
 *
 *   TELEMETRY_ENABLED   "true" to enable all telemetry. Default false.
 *   NODE_ENV            "development" | "staging" | "production". Default "development".
 *
 *   METRICS_ENABLED   "false" to disable. Default true (when TELEMETRY_ENABLED).
 *   METRICS_PORT      Prometheus scrape port. Default 9090.
 *   METRICS_PREFIX    Metric name prefix. Default "mcp".
 *
 *   LOGS_ENABLED      "false" to disable. Default true (when TELEMETRY_ENABLED).
 *   LOG_LEVEL         "debug" | "info" | "warn" | "error". Default "info".
 *   LOKI_URL          Loki push URL, e.g. "http://loki:3100". Omit → console only.
 *   LOKI_BATCH_MS     Log batch flush interval in ms. Default 5000.
 *
 *   TRACES_ENABLED      "true" to enable. Default false.
 *   OTLP_ENDPOINT       Tempo OTLP/HTTP base URL, e.g. "http://tempo:4318". Default that.
 *   TRACE_SAMPLE_RATE   0.0–1.0. Default 0.1 (10 %).
 *
 *   When auth is implemented, add MCP_API_KEY / MCP_BEARER_TOKEN env vars here
 *   and inject them in src/http-client.ts. ServiceSpec.securitySchemes carries
 *   the upstream auth metadata.
 */
export const BASE_URL: string =
  process.env["MCP_BASE_URL"] ?? "";
