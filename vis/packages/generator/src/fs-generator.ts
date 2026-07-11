import type { FileTree, GenerateOptions, GenerateResult, Generator } from '@vis/core';
import { GenerateError } from '@vis/core';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface AgentJsonConfig {
  schema_version?: string;
  name: string;
  description?: string;
  mcp_server_url?: string;
  environment?: string;
  auth?: {
    type: 'oauth2' | 'api_key' | 'none';
    authorization_url?: string;
    scopes?: string[];
    api_key_header?: string;
  };
  capabilities?: {
    streaming?: boolean;
    batch_calls?: boolean;
    max_concurrent_tools?: number;
  };
  rate_limits?: {
    requests_per_minute?: number;
    requests_per_day?: number;
  };
  tool_groups?: Array<{
    name: string;
    description: string;
    tools: string[];
  }>;
  tools: Array<{
    name: string;
    group?: string;
    description: string;
    input_schema: {
      type: 'object';
      required?: string[];
      properties: Record<string, any>;
    };
    output_schema?: {
      type: 'object' | 'array';
      properties?: Record<string, any>;
      items?: Record<string, any>;
    };
    auth_required?: boolean;
    read_only?: boolean;
  }>;
}

export interface TelemetryConfig {
  enabled?: boolean;
  prometheus?: {
    enabled?: boolean;
    port?: number;
  };
  loki?: {
    enabled?: boolean;
    port?: number;
  };
  grafana?: {
    enabled?: boolean;
    port?: number;
  };
  tempo?: {
    enabled?: boolean;
    port?: number;
  };
}

export interface GeneratorOptions extends GenerateOptions {
  agentConfig?: AgentJsonConfig;
  telemetry?: TelemetryConfig;
  includeObservability?: boolean;
}

export class FsGenerator implements Generator {
  async generate(
    files: FileTree,
    outDir: string,
    options?: GeneratorOptions
  ): Promise<GenerateResult> {
    const opts = {
      install: true,
      typecheck: false,
      force: false,
      agentConfig: undefined as AgentJsonConfig | undefined,
      telemetry: undefined as TelemetryConfig | undefined,
      includeObservability: true,
      ...options,
    };

    const resolved = path.resolve(process.cwd(), outDir);
    const parentDir = path.dirname(resolved);

    await this.prepareOutDir(resolved, opts.force);

    const filesWritten: string[] = [];

    // Write all files from the template
    for (const file of files) {
      const fullPath = path.join(resolved, file.relativePath);
      const dir = path.dirname(fullPath);

      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fullPath, file.content, 'utf-8');
      filesWritten.push(file.relativePath);
    }

    // Generate agents.json if config is provided
    if (opts.agentConfig) {
      const agentJsonPath = path.join(parentDir, 'agents.json');
      await this.generateAgentJson(agentJsonPath, opts.agentConfig);
      filesWritten.push('../agents.json');
    }

    // Generate observability stack if enabled
    if (opts.includeObservability) {
      const obsDir = path.join(parentDir, 'observability');
      await this.generateObservabilityStack(obsDir, opts.telemetry, opts.agentConfig);
      filesWritten.push('../observability/');
    }

    let installRan = false;
    let typecheckPassed: boolean | undefined;

    // if (opts.install) {
    //   await this.runInstall(resolved);
    //   installRan = true;
    // }

    if (opts.typecheck && installRan) {
      typecheckPassed = await this.runTypecheck(resolved);
    }

    return {
      outDir: resolved,
      filesWritten,
      installRan,
      files,
      warnings: [],
      operationCount: files.length,
      ...(typecheckPassed !== undefined && { typecheckPassed }),
    };
  }

  private async generateAgentJson(filePath: string, config: AgentJsonConfig): Promise<void> {
    const agentJson = {
      schema_version: config.schema_version || '1.1',
      name: config.name,
      description: config.description || '',
      mcp_server_url: config.mcp_server_url || 'http://localhost:3000',
      environment: config.environment || 'development',
      auth: config.auth || { type: 'none' },
      capabilities: {
        streaming: config.capabilities?.streaming ?? false,
        batch_calls: config.capabilities?.batch_calls ?? true,
        max_concurrent_tools: config.capabilities?.max_concurrent_tools ?? 3,
      },
      rate_limits: {
        requests_per_minute: config.rate_limits?.requests_per_minute ?? 60,
        requests_per_day: config.rate_limits?.requests_per_day ?? 10000,
      },
      tool_groups: config.tool_groups || [],
      tools: config.tools || [],
    };

    await fs.writeFile(filePath, JSON.stringify(agentJson, null, 2), 'utf-8');
  }

  private async generateObservabilityStack(
    obsDir: string,
    telemetryConfig?: TelemetryConfig,
    agentConfig?: AgentJsonConfig
  ): Promise<void> {
    const config = {
      enabled: telemetryConfig?.enabled !== false,
      prometheus: {
        enabled: telemetryConfig?.prometheus?.enabled !== false,
        port: telemetryConfig?.prometheus?.port || 9091,
      },
      loki: {
        enabled: telemetryConfig?.loki?.enabled !== false,
        port: telemetryConfig?.loki?.port || 3100,
      },
      grafana: {
        enabled: telemetryConfig?.grafana?.enabled !== false,
        port: telemetryConfig?.grafana?.port || 3001,
      },
      tempo: {
        enabled: telemetryConfig?.tempo?.enabled !== false,
        port: telemetryConfig?.tempo?.port || 4318,
      },
    };

    // Create observability directory structure
    await fs.mkdir(obsDir, { recursive: true });
    await fs.mkdir(path.join(obsDir, 'grafana', 'provisioning', 'datasources'), {
      recursive: true,
    });
    await fs.mkdir(path.join(obsDir, 'grafana', 'provisioning', 'dashboards'), { recursive: true });
    await fs.mkdir(path.join(obsDir, 'grafana', 'dashboards'), { recursive: true });

    const serviceName = agentConfig?.name ? slugify(agentConfig.name) : 'mcp-server';

    // Generate docker-compose.telemetry.yml
    await fs.writeFile(
      path.join(obsDir, 'docker-compose.telemetry.yml'),
      this.renderDockerCompose(config, serviceName)
    );

    // Generate prometheus.yml
    await fs.writeFile(
      path.join(obsDir, 'prometheus.yml'),
      this.renderPrometheusConfig(config, serviceName)
    );

    // Generate loki-config.yml
    await fs.writeFile(path.join(obsDir, 'loki-config.yml'), this.renderLokiConfig());

    // Generate promtail-config.yml
    await fs.writeFile(
      path.join(obsDir, 'promtail-config.yml'),
      this.renderPromtailConfig(serviceName)
    );

    // Generate tempo-config.yml
    await fs.writeFile(path.join(obsDir, 'tempo-config.yml'), this.renderTempoConfig());

    // Generate alerts.yml
    await fs.writeFile(path.join(obsDir, 'alerts.yml'), this.renderAlerts(serviceName));

    // Generate Grafana datasources
    await fs.writeFile(
      path.join(obsDir, 'grafana', 'provisioning', 'datasources', 'datasources.yml'),
      this.renderGrafanaDatasources()
    );

    // Generate Grafana dashboards config
    await fs.writeFile(
      path.join(obsDir, 'grafana', 'provisioning', 'dashboards', 'dashboards.yml'),
      this.renderGrafanaDashboardsConfig()
    );

    // Generate MCP Server Dashboard
    await fs.writeFile(
      path.join(obsDir, 'grafana', 'dashboards', 'mcp-dashboard.json'),
      this.renderMCPDashboard(serviceName)
    );

    // Generate README for observability
    await fs.writeFile(path.join(obsDir, 'README.md'), this.renderObservabilityReadme(serviceName));

    // Generate .env.example
    await fs.writeFile(path.join(obsDir, '.env.example'), this.renderEnvExample(serviceName));

    // Generate setup script
    await fs.writeFile(path.join(obsDir, 'setup.sh'), this.renderSetupScript(serviceName));
    await fs.chmod(path.join(obsDir, 'setup.sh'), 0o755);
  }

  private renderDockerCompose(config: any, serviceName: string): string {
    const prometheusPort = config.prometheus.port;
    return `
services:
  prometheus:
    image: prom/prometheus:latest
    container_name: ${serviceName}-prometheus
    ports:
      - "${prometheusPort}:${prometheusPort}"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--web.enable-lifecycle'
    restart: unless-stopped
    networks:
      - observability

  loki:
    image: grafana/loki:latest
    container_name: ${serviceName}-loki
    ports:
      - "${config.loki.port}:3100"
    volumes:
      - ./loki-config.yml:/etc/loki/loki-config.yml
      - loki_data:/loki
    command: -config.file=/etc/loki/loki-config.yml
    restart: unless-stopped
    networks:
      - observability

  promtail:
    image: grafana/promtail:latest
    container_name: ${serviceName}-promtail
    volumes:
      - ./promtail-config.yml:/etc/promtail/promtail-config.yml
      - /var/log:/var/log:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      - /var/run/docker.sock:/var/run/docker.sock
    command: -config.file=/etc/promtail/promtail-config.yml
    restart: unless-stopped
    depends_on:
      - loki
    networks:
      - observability

  tempo:
    image: grafana/tempo:latest
    container_name: ${serviceName}-tempo
    ports:
      - '3200:3200'
      - "${config.tempo.port}:4318"
      - "4317:4317"
    command: -config.file=/etc/tempo/tempo-config.yml
    restart: unless-stopped
    networks:
      - observability

  grafana:
    image: grafana/grafana:latest
    container_name: ${serviceName}-grafana
    ports:
      - "${config.grafana.port}:3000"
    volumes:
      - ./grafana/provisioning:/etc/grafana/provisioning
      - ./grafana/dashboards:/var/lib/grafana/dashboards
      - grafana_data:/var/lib/grafana
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
      - GF_SECURITY_ADMIN_USER=admin
      - GF_INSTALL_PLUGINS=grafana-piechart-panel,grafana-worldmap-panel
      - GF_SERVER_ROOT_URL=http://localhost:${config.grafana.port}
    restart: unless-stopped
    depends_on:
      - prometheus
      - loki
      - tempo
    networks:
      - observability

  node-exporter:
    image: prom/node-exporter:latest
    container_name: ${serviceName}-node-exporter
    ports:
      - "9100:9100"
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    command:
      - '--path.procfs=/host/proc'
      - '--path.rootfs=/rootfs'
      - '--path.sysfs=/host/sys'
    restart: unless-stopped
    networks:
      - observability

networks:
  observability:
    driver: bridge

volumes:
  prometheus_data:
  loki_data:
  tempo_data:
  grafana_data:
`;
  }

  private renderPrometheusConfig(config: any, serviceName: string): string {
    return `global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    monitor: '${serviceName}-monitor'

scrape_configs:
  - job_name: '${serviceName}'
    static_configs:
      - targets: ['host.docker.internal:9091']
    metrics_path: '/metrics'
    scrape_interval: 10s

  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9091']

  - job_name: 'node-exporter'
    static_configs:
      - targets: ['node-exporter:9100']

rule_files:
  - "alerts.yml"

alerting:
  alertmanagers:
    - static_configs:
        - targets: []
`;
  }

  private renderLokiConfig(): string {
    return `auth_enabled: false

server:
  http_listen_port: 3100
  grpc_listen_port: 9096

common:
  ring:
    instance_addr: 127.0.0.1
    kvstore:
      store: inmemory
  replication_factor: 1
  path_prefix: /loki

schema_config:
  configs:
    - from: 2020-10-24
      store: boltdb-shipper
      object_store: filesystem
      schema: v11
      index:
        prefix: index_
        period: 24h

storage_config:
  boltdb_shipper:
    active_index_directory: /loki/index
    cache_location: /loki/cache
  filesystem:
    directory: /loki/chunks

limits_config:
  enforce_metric_name: false
  reject_old_samples: true
  reject_old_samples_max_age: 168h

chunk_store_config:
  max_look_back_period: 0

table_manager:
  retention_deletes_enabled: true
  retention_period: 168h
`;
  }

  private renderPromtailConfig(serviceName: string): string {
    return `server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  - job_name: docker_logs
    docker_sd_configs:
      - host: unix:///var/run/docker.sock
        refresh_interval: 5s
        filters:
          - name: label
            values: ["logging=promtail"]
    relabel_configs:
      - source_labels: ['__meta_docker_container_name']
        regex: '/(.*)'
        target_label: 'container'
      - source_labels: ['__meta_docker_container_log_stream']
        target_label: 'log_stream'
      - source_labels: ['__meta_docker_container_label_com_docker_compose_service']
        target_label: 'service'

  - job_name: ${serviceName}_logs
    static_configs:
      - targets: [localhost]
        labels:
          job: ${serviceName}
          __path__: /var/log/${serviceName}/*.log
`;
  }

  private renderTempoConfig(): string {
    return `server:
  http_listen_port: 3200
  grpc_listen_port: 9095

distributor:
  receivers:
    otlp:
      protocols:
        http:
          endpoint: "0.0.0.0:4318"
        grpc:
          endpoint: "0.0.0.0:4317"

ingester:
  max_block_duration: 5m

compactor:
  compaction:
    block_retention: 168h

storage:
  trace:
    backend: local
    local:
      path: /var/tempo/traces
    wal:
      path: /var/tempo/wal

querier:
  frontend_worker:
    frontend_address: tempo:9095

query_frontend:
  search:
    max_duration: 168h
`;
  }

  private renderAlerts(serviceName: string): string {
    return `groups:
  - name: ${serviceName}_alerts
    rules:
      - alert: HighErrorRate
        expr: rate(mcp_tool_errors_total[5m]) > 0.1
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "High error rate for ${serviceName}"
          description: "Error rate is {{ $value }} errors per second"

      - alert: SlowToolResponses
        expr: histogram_quantile(0.95, sum(rate(mcp_tool_duration_seconds_bucket[5m])) by (le, tool)) > 5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Slow tool responses"
          description: "Tool {{ $labels.tool }} has high latency >5s"

      - alert: NoActiveTools
        expr: mcp_active_tools == 0
        for: 30m
        labels:
          severity: info
        annotations:
          summary: "No active tools"
          description: "No tools have been called in the last 30 minutes"
`;
  }

  private renderGrafanaDatasources(): string {
    return `apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: true
    jsonData:
      timeInterval: "15s"

  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100
    editable: true
    jsonData:
      maxLines: 1000

  - name: Tempo
    type: tempo
    access: proxy
    url: http://tempo:4318
    editable: true
    jsonData:
      httpMethod: GET
      serviceMap:
        datasourceUid: prometheus
`;
  }

  private renderGrafanaDashboardsConfig(): string {
    return `apiVersion: 1

providers:
  - name: 'MCP Dashboards'
    orgId: 1
    folder: 'MCP Server'
    type: file
    disableDeletion: false
    updateIntervalSeconds: 10
    allowUiUpdates: true
    options:
      path: /var/lib/grafana/dashboards
      foldersFromFilesStructure: true
`;
  }

  private renderMCPDashboard(serviceName: string): string {
    return JSON.stringify(
      {
        title: `${serviceName} MCP Server`,
        uid: `${serviceName}-dashboard`,
        tags: ['mcp', serviceName],
        timezone: 'browser',
        schemaVersion: 16,
        version: 1,
        refresh: '30s',
        panels: [
          {
            title: 'Tool Calls per Second',
            type: 'graph',
            gridPos: { h: 8, w: 12, x: 0, y: 0 },
            targets: [
              {
                expr: 'rate(mcp_tool_calls_total[5m])',
                legendFormat: '{{tool}} - {{success}}',
              },
            ],
          },
          {
            title: 'Tool Duration (P95)',
            type: 'graph',
            gridPos: { h: 8, w: 12, x: 12, y: 0 },
            targets: [
              {
                expr: 'histogram_quantile(0.95, sum(rate(mcp_tool_duration_seconds_bucket[5m])) by (le, tool))',
                legendFormat: '{{tool}}',
              },
            ],
          },
          {
            title: 'Error Rate',
            type: 'stat',
            gridPos: { h: 4, w: 6, x: 0, y: 8 },
            targets: [
              {
                expr: 'sum(rate(mcp_tool_errors_total[5m])) / sum(rate(mcp_tool_calls_total[5m])) * 100',
              },
            ],
            fieldConfig: {
              defaults: {
                unit: 'percent',
                thresholds: {
                  mode: 'absolute',
                  steps: [
                    { color: 'green', value: null },
                    { color: 'yellow', value: 5 },
                    { color: 'red', value: 20 },
                  ],
                },
              },
            },
          },
          {
            title: 'Active Tools',
            type: 'graph',
            gridPos: { h: 4, w: 6, x: 6, y: 8 },
            targets: [
              {
                expr: 'mcp_active_tools',
                legendFormat: '{{tool}}',
              },
            ],
          },
          {
            title: 'Tool Usage Distribution',
            type: 'piechart',
            gridPos: { h: 8, w: 12, x: 12, y: 8 },
            targets: [
              {
                expr: 'sum by (tool) (mcp_tool_calls_total)',
                legendFormat: '{{tool}}',
              },
            ],
          },
          {
            title: 'Request Size Distribution',
            type: 'graph',
            gridPos: { h: 6, w: 12, x: 0, y: 12 },
            targets: [
              {
                expr: 'histogram_quantile(0.95, sum(rate(mcp_request_size_bytes_bucket[5m])) by (le))',
                legendFormat: 'P95 Request Size',
              },
            ],
          },
          {
            title: 'Response Size Distribution',
            type: 'graph',
            gridPos: { h: 6, w: 12, x: 12, y: 12 },
            targets: [
              {
                expr: 'histogram_quantile(0.95, sum(rate(mcp_response_size_bytes_bucket[5m])) by (le))',
                legendFormat: 'P95 Response Size',
              },
            ],
          },
        ],
      },
      null,
      2
    );
  }

  private renderObservabilityReadme(serviceName: string): string {
    return `# Observability Stack for ${serviceName}

This directory contains the complete observability stack for monitoring your MCP server.

## Quick Start

\`\`\`bash
# Start the observability stack
docker-compose -f docker-compose.telemetry.yml up -d

# Check services
docker-compose -f docker-compose.telemetry.yml ps

# View logs
docker-compose -f docker-compose.telemetry.yml logs -f
\`\`\`

## Services

| Service | Port | Description |
|---------|------|-------------|
| Prometheus | 9091 | Metrics collection |
| Loki | 3100 | Log aggregation |
| Tempo | 4318 | Distributed tracing |
| Grafana | 3001 | Visualization dashboard |
| Node Exporter | 9100 | System metrics |

## Access

- **Grafana**: http://localhost:3001 (admin/admin)
- **Prometheus**: http://localhost:9091
- **Loki**: http://localhost:3100

## MCP Server Configuration

Set these environment variables when starting your MCP server:

\`\`\`bash
TELEMETRY_ENABLED=true \\
METRICS_ENABLED=true \\
METRICS_PORT=9090 \\
LOGS_ENABLED=true \\
LOG_LEVEL=info \\
LOKI_URL=http://localhost:3100 \\
TRACES_ENABLED=true \\
TRACES_ENDPOINT=http://localhost:4318/v1/traces \\
MCP_TRANSPORT=http \\
MCP_BASE_URL=http://localhost:8000 \\
node dist/index.js
\`\`\`

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
`;
  }

  private renderEnvExample(serviceName: string): string {
    return `# Server Configuration
PORT=3000
MCP_TRANSPORT=http
MCP_BASE_URL=http://localhost:8000

# Telemetry Configuration
TELEMETRY_ENABLED=true
NODE_ENV=production

# Metrics (Prometheus)
METRICS_ENABLED=true
METRICS_PORT=9090

# Logs (Loki)
LOGS_ENABLED=true
LOG_LEVEL=info
LOKI_URL=http://localhost:3100

# Traces (Tempo)
TRACES_ENABLED=true
TRACES_ENDPOINT=http://localhost:4318/v1/traces
TRACE_SAMPLE_RATE=0.1
`;
  }

  private renderSetupScript(serviceName: string): string {
    return `#!/bin/bash
# Setup script for ${serviceName} observability stack

echo "🚀 Setting up Observability Stack for ${serviceName}"

# Check if docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Check if docker-compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ docker-compose is not installed. Please install it first."
    exit 1
fi

# Start the stack
echo "📊 Starting observability stack..."
docker-compose -f docker-compose.telemetry.yml up -d

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 5

# Check services
echo -e "\n✅ Services status:"
docker-compose -f docker-compose.telemetry.yml ps

# Print access information
echo -e "\n📊 Access your dashboards:"
echo "   Grafana: http://localhost:3001 (admin/admin)"
echo "   Prometheus: http://localhost:9091"
echo "   Loki: http://localhost:3100"

echo -e "\n🔧 To start your MCP server with telemetry:"
echo "   source .env"
echo "   node dist/index.js"

echo -e "\n📝 To view logs:"
echo "   docker-compose -f docker-compose.telemetry.yml logs -f"

echo -e "\n🛑 To stop the stack:"
echo "   docker-compose -f docker-compose.telemetry.yml down"
`;
  }

  private async prepareOutDir(dir: string, force: boolean): Promise<void> {
    try {
      await fs.access(dir);
      if (!force) {
        throw new GenerateError(
          `Output directory already exists: ${dir}\nUse --force to overwrite.`
        );
      }
      await fs.rm(dir, { recursive: true, force: true });
    } catch (err) {
      if (err instanceof GenerateError) throw err;
    }
    await fs.mkdir(dir, { recursive: true });
  }

  // private async runInstall(cwd: string): Promise<void> {
  //   try {
  //     await execFileAsync('npm', ['install', '--prefer-offline'], {
  //       cwd,
  //       timeout: 120_000,
  //     });
  //   } catch (err: any) {
  //     const details = [
  //       err?.message,
  //       err?.stdout ? `stdout:\n${err.stdout}` : '',
  //       err?.stderr ? `stderr:\n${err.stderr}` : '',
  //     ]
  //       .filter(Boolean)
  //       .join('\n\n');

  //     throw new GenerateError(`npm install failed in ${cwd}\n\n${details}`);
  //   }
  // }

  private async runTypecheck(cwd: string): Promise<boolean> {
    try {
      await execFileAsync('npx', ['tsc', '--noEmit', '--project', 'tsconfig.json'], {
        cwd,
        timeout: 60_000,
      });
      return true;
    } catch {
      return false;
    }
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
