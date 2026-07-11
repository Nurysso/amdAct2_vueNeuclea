/**
 * vis CLI — thin glue wiring parser → templates → generator.
 * All business logic lives in the packages above.
 */
import { GenerateError, ParseError, RenderError, type ParserOptions } from '@vis/core';
import { FsGenerator, type AgentJsonConfig } from '@vis/generator';
import { loadSpec, OpenAPIParser } from '@vis/parser';
import { StdioTemplateEngine } from '@vis/templates';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseArgs, promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', short: 'o' },
    'base-url': { type: 'string' },
    'package-name': { type: 'string' },
    'package-version': { type: 'string' },
    force: { type: 'boolean', default: false },
    'no-install': { type: 'boolean', default: false },
    typecheck: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
    version: { type: 'boolean', short: 'v', default: false },
    // Agent.json options
    'agent-config': { type: 'string' },
    'agent-name': { type: 'string' },
    'agent-url': { type: 'string' },
    'agent-env': { type: 'string' },
    'agent-description': { type: 'string' },
    telemetry: { type: 'boolean', default: false },
    'telemetry-path': { type: 'string' },
    'prometheus-port': { type: 'string' },
    'loki-port': { type: 'string' },
    'grafana-port': { type: 'string' },
    'tempo-port': { type: 'string' },
    'no-observability': { type: 'boolean', default: false },
  },
});

if (values.version) {
  console.log('vis 0.1.0');
  process.exit(0);
}

if (values.help || positionals[0] !== 'build') {
  printHelp();
  process.exit(0);
}

const specSource = positionals[1];
if (!specSource) {
  printHelp();
  die('Error: missing <spec> argument');
}

const outDir = values.out ?? './mcp-server';

// ─── Load agent config ────────────────────────────────────────────────────────

async function loadAgentConfig(): Promise<AgentJsonConfig | undefined> {
  if (!values['agent-config']) {
    // If no config file, build from CLI options if provided
    if (values['agent-name'] || values['agent-url'] || values['agent-env']) {
      return {
        schema_version: '1.1',
        name: values['agent-name'] || 'MCP Server',
        description: values['agent-description'] || '',
        mcp_server_url: values['agent-url'] || 'http://localhost:3000',
        environment: values['agent-env'] || 'development',
        auth: { type: 'none' },
        capabilities: {
          streaming: false,
          batch_calls: true,
          max_concurrent_tools: 3,
        },
        rate_limits: {
          requests_per_minute: 60,
          requests_per_day: 10000,
        },
        tool_groups: [],
        tools: [],
      };
    }
    return undefined;
  }

  try {
    const configPath = path.resolve(process.cwd(), values['agent-config']);
    const configContent = await fs.readFile(configPath, 'utf-8');
    const config: AgentJsonConfig = JSON.parse(configContent);

    // Override with CLI options if provided
    if (values['agent-name']) config.name = values['agent-name'];
    if (values['agent-url']) config.mcp_server_url = values['agent-url'];
    if (values['agent-env']) config.environment = values['agent-env'];
    if (values['agent-description']) config.description = values['agent-description'];

    return config;
  } catch (err) {
    die(`Error loading agent config: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function buildAgentConfigFromSpec(
  spec: any,
  cliConfig?: AgentJsonConfig
): AgentJsonConfig | undefined {
  const base = cliConfig || {
    schema_version: '1.1',
    name: spec.title || 'MCP Server',
    description: spec.description || '',
    mcp_server_url: values['agent-url'] || 'http://localhost:3000',
    environment: values['agent-env'] || 'development',
    auth: { type: 'none' },
    capabilities: {
      streaming: false,
      batch_calls: true,
      max_concurrent_tools: 3,
    },
    rate_limits: {
      requests_per_minute: 60,
      requests_per_day: 10000,
    },
    tool_groups: [],
    tools: [],
  };

  // Build tools from OpenAPI operations
  const tools = spec.operations.map((op: any) => {
    // Build input schema from parameters and request body
    const properties: Record<string, any> = {};
    const required: string[] = [];

    // Add path parameters
    for (const param of op.parameters || []) {
      if (param.in === 'path' || param.in === 'query') {
        properties[param.name] = {
          type: mapSchemaType(param.schema?.type || 'string'),
          description: param.description || '',
        };
        if (param.required) {
          required.push(param.name);
        }
      }
    }

    // Add request body
    if (op.requestBody?.content?.['application/json']?.schema) {
      const bodySchema = op.requestBody.content['application/json'].schema;
      if (bodySchema.type === 'object' && bodySchema.properties) {
        for (const [key, prop] of Object.entries(bodySchema.properties)) {
          properties[key] = {
            type: mapSchemaType((prop as any).type || 'string'),
            description: (prop as any).description || '',
          };
          if (bodySchema.required?.includes(key)) {
            required.push(key);
          }
        }
      }
    }

    return {
      name: op.operationId,
      description: op.summary || op.description || `Tool for ${op.operationId}`,
      input_schema: {
        type: 'object',
        ...(required.length > 0 && { required }),
        properties,
      },
      auth_required: false,
      read_only: op.method === 'get' || op.method === 'head' || op.method === 'options',
    };
  });

  // Group tools by tags
  const toolGroups: Record<string, string[]> = {};
  for (const op of spec.operations) {
    const tags = op.tags || ['default'];
    for (const tag of tags) {
      if (!toolGroups[tag]) toolGroups[tag] = [];
      toolGroups[tag].push(op.operationId);
    }
  }

  base.tools = tools;
  base.tool_groups = Object.entries(toolGroups).map(([name, toolNames]) => ({
    name: name.toLowerCase().replace(/\s+/g, '_'),
    description: `${name} operations`,
    tools: toolNames,
  }));

  return base;
}

function mapSchemaType(type: string): string {
  switch (type) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'integer':
      return 'integer';
    case 'boolean':
      return 'boolean';
    case 'array':
      return 'array';
    case 'object':
      return 'object';
    default:
      return 'string';
  }
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────
const envVars = [
  'TELEMETRY_ENABLED=true',
  'METRICS_ENABLED=true',
  'METRICS_PORT=9091',
  'LOGS_ENABLED=true',
  'LOG_LEVEL=info',
  'LOKI_URL=http://localhost:3100',
  'TRACES_ENABLED=true',
  'TRACES_ENDPOINT=http://localhost:4318/v1/traces',
  'TRACE_SAMPLE_RATE=0.1',
  'MCP_TRANSPORT=http',
  'MCP_BASE_URL=http://localhost:8000',
  'PORT=3000',
].join(' ');

async function main(): Promise<void> {
  log(`📄 Loading spec from: ${specSource}`);
  const rawDoc = await loadSpec(specSource as string);

  log('🔍 Parsing OpenAPI spec…');
  const parser = new OpenAPIParser();
  if (!parser.canParse(rawDoc)) {
    die('Error: document does not appear to be a valid OpenAPI 3.x spec');
  }

  // Build parser options, only including baseUrl if defined
  const parserOptions: ParserOptions = { transport: 'stdio' };
  if (values['base-url']) {
    parserOptions.baseUrl = values['base-url'];
  }

  const spec = await parser.parse(rawDoc, parserOptions);

  log(`✅ Parsed: ${spec.title} v${spec.version} — ${spec.operations.length} operation(s)`);

  // Load agent config
  const agentConfigFromFile = await loadAgentConfig();
  const agentConfig = buildAgentConfigFromSpec(spec, agentConfigFromFile);

  if (agentConfig) {
    log(`📋 Agent config: ${agentConfig.name} (${agentConfig.environment})`);
  }

  log('🔧 Rendering MCP server template…');
  const engine = new StdioTemplateEngine();
  const fileTree = await engine.render(spec, {
    spec,
    ...(values['package-name'] && { packageName: values['package-name'] }),
    ...(values['package-version'] && { packageVersion: values['package-version'] }),
  });

  const telemetryPath = values['telemetry-path'] || '../vis/packages/telemetry';
  const telemetryConfig = {
    enabled: values['telemetry'] !== false,
    prometheus: {
      enabled: values['telemetry'] !== false,
      port: parseInt(values['prometheus-port'] || '9090'),
    },
    loki: {
      enabled: values['telemetry'] !== false,
      port: parseInt(values['loki-port'] || '3100'),
    },
    grafana: {
      enabled: values['telemetry'] !== false,
      port: parseInt(values['grafana-port'] || '3001'),
    },
    tempo: {
      enabled: values['telemetry'] !== false,
      port: parseInt(values['tempo-port'] || '4318'),
    },
  };

  const includeObservability = !values['no-observability'] && values['telemetry'];

  log(`📁 Writing ${fileTree.length} file(s) to: ${outDir}`);
  const generator = new FsGenerator();
  const result = await generator.generate(fileTree, outDir, {
    install: !values['no-install'],
    typecheck: values['typecheck'],
    force: values['force'],
    ...(agentConfig && { agentConfig }),
    ...(values['telemetry'] ? { telemetry: telemetryConfig } : {}),
    includeObservability,
  });

  // ─── Summary Output ──────────────────────────────────────────────────────────

  const serverDir = path.basename(outDir);
  const parentDir = path.basename(path.dirname(path.resolve(outDir)));

  log(`\n✨ Done! Generated ${result.filesWritten.length} files.`);

  // Agent.json status
  if (agentConfig) {
    log(`📋 Generated agent.json in ${parentDir}`);
  }

  // Observability stack status
  if (includeObservability) {
    log(`\n📊 Observability Stack Generated:`);
    log(`   📁 Location: ${parentDir}/observability/`);
    log(`   🚀 Start: docker-compose -f observability/docker-compose.telemetry.yml up -d`);
    log(`   📈 Grafana: http://localhost:${telemetryConfig.grafana.port} (admin/admin)`);
    log(`   📊 Prometheus: http://localhost:${telemetryConfig.prometheus.port}`);
    log(`   📝 Loki: http://localhost:${telemetryConfig.loki.port}`);
    log(`   🔍 Tempo: http://localhost:${telemetryConfig.tempo.port}`);
    log(`   📋 Setup: cd observability && ./setup.sh`);
  } else if (values['telemetry']) {
    log(`\nℹ️  Observability stack skipped (--no-observability flag)`);
  } else {
    log(`\nℹ️  To enable observability stack, use: --telemetry`);
  }

  // npm install status
  if (result.installRan) {
    log('📦 npm install complete.');
  }

  // Typecheck status
  if (result.typecheckPassed === true) {
    log('✔  TypeScript check passed.');
  } else if (result.typecheckPassed === false) {
    log('⚠️  TypeScript check found errors — check the output manually.');
  }

  // Next steps
  log(`\n🚀 To start your MCP server:`);
  log(`  cd ${outDir}`);
  log(`  npm run build`);
  log(`  node dist/index.js`);

  if (includeObservability) {
    log(`\n📊 To start observability stack:`);
    log(`  cd observability`);
    log(`  docker-compose -f docker-compose.telemetry.yml up -d`);
  }

  // Helpful tips
  if (values['telemetry']) {
    log(`\n💡 Telemetry enabled. Start server with:\n`);
    log(`\n🚀 Run the following command:\n\n${envVars} node dist/index.js\n`);
  }
}

main().catch((err) => {
  if (err instanceof ParseError || err instanceof RenderError || err instanceof GenerateError) {
    die(`${err.name}: ${err.message}`);
  }
  die(`Unexpected error: ${err instanceof Error ? err.stack : String(err)}`);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string): void {
  process.stdout.write(msg + '\n');
}

function die(msg: string): never {
  process.stderr.write(msg + '\n');
  process.exit(1);
}

function printHelp(): void {
  log(
    `
vis — Generate a runnable MCP server from an OpenAPI spec

USAGE
  vis build <spec> [options]

ARGUMENTS
  <spec>      Path to an OpenAPI 3.x JSON/YAML file, or a URL

OPTIONS
  -o, --out <dir>          Output directory (default: ./mcp-server)
  --base-url <url>         Override the upstream API base URL
  --package-name <name>    npm package name
  --package-version <ver>  Semver (default: 0.1.0)
  --force                  Overwrite output directory
  --no-install             Skip npm install
  --typecheck              Run tsc --noEmit after install
  -h, --help               Show help
  -v, --version            Show version

TELEMETRY OPTIONS
  --telemetry              Enable telemetry and generate observability stack
  --prometheus-port <port> Prometheus port (default: 9090)
  --loki-port <port>       Loki port (default: 3100)
  --grafana-port <port>    Grafana port (default: 3001)
  --tempo-port <port>      Tempo port (default: 4318)
  --no-observability       Skip generating observability stack (only MCP server)

AGENT.JSON OPTIONS
  --agent-config <file>    Path to agent.json config
  --agent-name <name>      Override agent name
  --agent-url <url>        Override MCP server URL
  --agent-env <env>        Environment: production, staging, development
  --agent-description <text> Agent description

EXAMPLES
  # Generate with observability stack
  vis build ./openapi.json --out ./my-server --telemetry

  # Skip observability generation
  vis build ./openapi.json --out ./my-server --no-observability

  # Custom ports for telemetry
  vis build ./openapi.json --out ./my-server \\
    --telemetry \\
    --prometheus-port 9091 \\
    --grafana-port 3002

  # With agent config
  vis build ./openapi.json --out ./my-server \\
    --agent-config ./agent-config.json \\
    --agent-name "Acme API" \\
    --telemetry
`
  );
}
