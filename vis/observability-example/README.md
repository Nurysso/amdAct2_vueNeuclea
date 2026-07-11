# Observability Stack for novamart-api

This directory contains the complete observability stack for monitoring your MCP server.

## Quick Start

```bash
# Start the observability stack
docker-compose -f docker-compose.telemetry.yml up -d

# Check services
docker-compose -f docker-compose.telemetry.yml ps

# View logs
docker-compose -f docker-compose.telemetry.yml logs -f
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| Prometheus | 9090 | Metrics collection |
| Loki | 3100 | Log aggregation |
| Tempo | 4318 | Distributed tracing |
| Grafana | 3001 | Visualization dashboard |
| Node Exporter | 9100 | System metrics |

## Access

- **Grafana**: http://localhost:3001 (admin/admin)
- **Prometheus**: http://localhost:9090
- **Loki**: http://localhost:3100

## MCP Server Configuration

Set these environment variables when starting your MCP server:

```bash
TELEMETRY_ENABLED=true \
METRICS_ENABLED=true \
METRICS_PORT=9090 \
LOGS_ENABLED=true \
LOG_LEVEL=info \
LOKI_URL=http://localhost:3100 \
TRACES_ENABLED=true \
TRACES_ENDPOINT=http://localhost:4318/v1/traces \
MCP_TRANSPORT=http \
MCP_BASE_URL=http://localhost:8000 \
node dist/index.js
```

## Grafana Dashboards

The MCP Server dashboard is automatically provisioned and includes:

- Tool calls per second
- Tool duration (P95)
- Error rate
- Active tools
- Tool usage distribution
- Request/response sizes

## Alerts

Alerts are configured for:
- High error rate (>5%)
- Slow tool responses (>5s)
- No active tools for 30 minutes
