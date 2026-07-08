import type { Operation, Parameter, ServiceSpec } from '@vis/core';
import { schemaToZod } from '../type-mapper.js';

/**
 * Renders a single MCP tool file for one API operation.
 * Each file exports a ToolDefinition that the server index registers.
 */
export function renderToolFile(op: Operation, spec: ServiceSpec): string {
  const inputSchema = buildInputSchema(op);
  const pathParams = op.parameters.filter((p) => p.in === 'path');
  const queryParams = op.parameters.filter((p) => p.in === 'query');
  const headerParams = op.parameters.filter((p) => p.in === 'header');
  const hasBody = !!op.requestBody;
  const jsonBody = op.requestBody?.content['application/json'];
  const bodyZod = jsonBody ? schemaToZod(jsonBody.schema, 1) : null;

  const descriptionParts: string[] = [];
  if (op.summary) descriptionParts.push(op.summary);
  if (op.description && op.description !== op.summary) {
    descriptionParts.push(op.description);
  }
  if (op.deprecated) descriptionParts.push('⚠️ DEPRECATED');
  const description = descriptionParts.join('\n\n') || op.operationId;

  return `
import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { callApi } from "../http-client.js";
import { BASE_URL } from "../config.js";

${renderInputSchemaConst(op, inputSchema)}

export const ${op.operationId}Tool: ToolDefinition = {
  name: ${JSON.stringify(op.operationId)},
  description: ${JSON.stringify(description)},
  inputSchema: ${op.operationId}InputSchema,

  async execute(args: z.infer<typeof ${op.operationId}InputSchema>) {
    ${renderUrlBuilder(op, pathParams)}
    ${renderQueryBuilder(queryParams)}
    ${renderHeaderBuilder(headerParams, spec)}
    ${renderBodyBuilder(hasBody, jsonBody, bodyZod)}

    const result = await callApi({
      method: ${JSON.stringify(op.method.toUpperCase())},
      url,
      params: queryParams,
      headers,
      body,
    });

    return result;
  },
};
`.trimStart();
}

function renderInputSchemaConst(op: Operation, inputSchema: string): string {
  return `const ${op.operationId}InputSchema = ${inputSchema};`;
}

function buildInputSchema(op: Operation): string {
  const fields: string[] = [];

  for (const param of op.parameters) {
    if (param.in === 'header' || param.in === 'cookie') continue;
    let zod = schemaToZod(param.schema, 1);
    if (!param.required) zod += '.optional()';
    if (param.description) zod += `.describe(${JSON.stringify(param.description)})`;
    fields.push(`  ${JSON.stringify(param.name)}: ${zod},`);
  }

  if (op.requestBody) {
    const jsonContent = op.requestBody.content['application/json'];
    if (jsonContent) {
      let zod = schemaToZod(jsonContent.schema, 1);
      if (!op.requestBody.required) zod += '.optional()';
      if (op.requestBody.description) {
        zod += `.describe(${JSON.stringify(op.requestBody.description)})`;
      }
      fields.push(`  "body": ${zod},`);
    }
  }

  if (fields.length === 0) return 'z.object({})';
  return `z.object({\n${fields.join('\n')}\n})`;
}

function renderUrlBuilder(op: Operation, pathParams: Parameter[]): string {
  if (pathParams.length === 0) {
    return `const url = \`\${BASE_URL}${op.path}\`;`;
  }
  const interpolated = op.path.replace(
    /\{([^}]+)\}/g,
    (_, name) => `\${encodeURIComponent(String(args[${JSON.stringify(name)}]))}`
  );
  return `const url = \`\${BASE_URL}${interpolated}\`;`;
}

function renderQueryBuilder(queryParams: Parameter[]): string {
  if (queryParams.length === 0) {
    return 'const queryParams: Record<string, string> = {};';
  }
  const lines = queryParams.map((p) => {
    const key = JSON.stringify(p.name);
    if (p.required) {
      return `  if (args[${key}] !== undefined) queryParams[${key}] = String(args[${key}]);`;
    }
    return `  if (args[${key}] !== undefined) queryParams[${key}] = String(args[${key}]);`;
  });
  return `const queryParams: Record<string, string> = {};\n    ${lines.join('\n    ')}`;
}

function renderHeaderBuilder(headerParams: Parameter[], _spec: ServiceSpec): string {
  const lines = [
    `const headers: Record<string, string> = {`,
    `  "Content-Type": "application/json",`,
    `  "Accept": "application/json",`,
  ];

  // Extension point: auth header injection
  // When auth is implemented, read spec.securitySchemes here and emit
  // the appropriate Authorization header based on the scheme kind.
  lines.push(`  // AUTH EXTENSION POINT: inject Authorization headers here`);

  for (const p of headerParams) {
    lines.push(`  // Header param "${p.name}" must be configured externally`);
  }

  lines.push(`};`);
  return lines.join('\n    ');
}

function renderBodyBuilder(
  hasBody: boolean,
  jsonContent: { schema: unknown } | undefined,
  _bodyZod: string | null
): string {
  if (!hasBody || !jsonContent) return `const body = undefined;`;
  return `const body = args["body"];`;
}
