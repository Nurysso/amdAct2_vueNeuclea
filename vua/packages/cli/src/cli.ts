#!/usr/bin/env node
/**
 * vis CLI — thin glue wiring parser → templates → generator.
 * All business logic lives in the packages above.
 */
import { GenerateError, ParseError, RenderError, type ParserOptions } from '@vis/core';
import { FsGenerator } from '@vis/generator';
import { loadSpec, OpenAPIParser } from '@vis/parser';
import { StdioTemplateEngine } from '@vis/templates';
import { parseArgs } from 'node:util';

//  Argument parsing

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

//  Pipeline

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

  log('🔧 Rendering MCP server template…');
  const engine = new StdioTemplateEngine();
  const fileTree = await engine.render(spec, {
    spec, // 👈 Required by your RenderOptions type definition
    ...(values['package-name'] && { packageName: values['package-name'] }),
    ...(values['package-version'] && { packageVersion: values['package-version'] }),
  });

  log(`📁 Writing ${fileTree.length} file(s) to: ${outDir}`);
  const generator = new FsGenerator();
  const result = await generator.generate(fileTree, outDir, {
    install: !values['no-install'],
    typecheck: values['typecheck'],
    force: values['force'],
  });

  log(`\n✨ Done! Generated ${result.filesWritten.length} files.`);
  if (result.installRan) log('📦 npm install complete.');
  if (result.typecheckPassed === true) log('✔  TypeScript check passed.');
  if (result.typecheckPassed === false) {
    log('⚠️  TypeScript check found errors — check the output manually.');
  }

  log(`\nTo start your MCP server:\n`);
  log(`  cd ${outDir}`);
  log(`  npm run build`);
  log(`  node dist/index.js`);
}

main().catch((err) => {
  if (err instanceof ParseError || err instanceof RenderError || err instanceof GenerateError) {
    die(`${err.name}: ${err.message}`);
  }
  die(`Unexpected error: ${err instanceof Error ? err.stack : String(err)}`);
});

//  Helpers

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
              (e.g. http://localhost:8000/openapi.json)

OPTIONS
  -o, --out <dir>          Output directory  (default: ./mcp-server)
  --base-url <url>         Override the upstream API base URL
  --package-name <name>    npm package name for the generated server
  --package-version <ver>  Semver for the generated server (default: 0.1.0)
  --force                  Overwrite output directory if it exists
  --no-install             Skip running npm install after generation
  --typecheck              Run tsc --noEmit after install
  -h, --help               Show this help message
  -v, --version            Print vis version

EXAMPLES
  # From a local file
  vis build ./openapi.json --out ./my-server

  # Directly from a live FastAPI app
  vis build http://localhost:8000/openapi.json --out ./my-server

  # Force overwrite + typecheck
  vis build ./api.yaml --out ./my-server --force --typecheck
`.trim()
  );
}
