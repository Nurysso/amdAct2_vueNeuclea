/**
 * StdioTemplateEngine: ServiceSpec → FileTree for a stdio MCP server.
 *
 * Pure and deterministic — no I/O, no randomness, no Date.now().
 * Given the same ServiceSpec, always produces identical output.
 */

import type { FileTree, RenderOptions, ServiceSpec, TemplateEngine } from '@vis/core';
import { renderServerIndex } from './renderers/server-index.js';
import {
  renderConfig,
  renderHttpClient,
  renderPackageJson,
  renderReadme,
  renderTsConfig,
  renderTypes,
} from './renderers/static-files.js';
import {
  renderTelemetryIndex,
  renderTelemetryLogs,
  renderTelemetryMetrics,
  renderTelemetryTraces,
  renderTelemetryTypes,
} from './renderers/telemetry-files.js';
import { renderToolFile } from './renderers/tool-file.js';

export class StdioTemplateEngine implements TemplateEngine {
  async render(spec: ServiceSpec, options?: RenderOptions): Promise<FileTree> {
    const packageName = options?.packageName ?? slugify(spec.title);
    const packageVersion = options?.packageVersion ?? '0.1.0';

    const files: FileTree = [];

    // Package files
    files.push({
      relativePath: 'package.json',
      content: renderPackageJson(spec, packageName, packageVersion),
    });

    files.push({
      relativePath: 'tsconfig.json',
      content: renderTsConfig(),
    });

    files.push({
      relativePath: 'README.md',
      content: renderReadme(spec, spec.operations.length),
    });

    // Source files
    files.push({
      relativePath: 'src/types.ts',
      content: renderTypes(),
    });

    files.push({
      relativePath: 'src/config.ts',
      content: renderConfig(spec),
    });

    files.push({
      relativePath: 'src/http-client.ts',
      content: renderHttpClient(),
    });

    // Telemetry files
    files.push({
      relativePath: 'src/telemetry/index.ts',
      content: renderTelemetryIndex(),
    });

    files.push({
      relativePath: 'src/telemetry/telemetry-types.ts',
      content: renderTelemetryTypes(),
    });

    files.push({
      relativePath: 'src/telemetry/telemetry-metrics.ts',
      content: renderTelemetryMetrics(),
    });

    files.push({
      relativePath: 'src/telemetry/telemetry-logs.ts',
      content: renderTelemetryLogs(),
    });

    files.push({
      relativePath: 'src/telemetry/telemetry-traces.ts',
      content: renderTelemetryTraces(),
    });

    // Tool files
    for (const op of spec.operations) {
      files.push({
        relativePath: `src/tools/${op.operationId}.ts`,
        content: renderToolFile(op, spec),
      });
    }

    // Server index
    files.push({
      relativePath: 'src/index.ts',
      content: renderServerIndex(spec),
    });

    return files;
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
