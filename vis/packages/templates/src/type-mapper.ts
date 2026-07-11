/**
 * Convert an IR SchemaNode into a TypeScript type string.
 * Used both in tool input type rendering and zod schema generation.
 */

import type { PrimitiveKind, SchemaNode } from '@vis/core';

const PRIMITIVE_MAP: Record<PrimitiveKind, string> = {
  string: 'string',
  number: 'number',
  integer: 'number',
  boolean: 'boolean',
  null: 'null',
};

export function schemaToTsType(node: SchemaNode, indent = 0): string {
  const pad = '  '.repeat(indent);
  const innerPad = '  '.repeat(indent + 1);

  switch (node.kind) {
    case 'primitive':
      return PRIMITIVE_MAP[node.type] ?? 'unknown';

    case 'enum':
      return node.values
        .map((v) => (typeof v === 'string' ? JSON.stringify(v) : String(v)))
        .join(' | ');

    case 'array':
      return `${schemaToTsType(node.items, indent)}[]`;

    case 'object': {
      const props = Object.entries(node.properties);
      if (props.length === 0) {
        if (node.additionalProperties === true || node.additionalProperties === undefined) {
          return 'Record<string, unknown>';
        }
        if (typeof node.additionalProperties === 'object') {
          return `Record<string, ${schemaToTsType(node.additionalProperties, indent)}>`;
        }
        return 'Record<string, never>';
      }

      const lines = props.map(([key, prop]) => {
        const optional = prop.required ? '' : '?';
        const comment = prop.description ? `/** ${prop.description} */ ` : '';
        return `${innerPad}${comment}${JSON.stringify(key)}${optional}: ${schemaToTsType(prop.schema, indent + 1)};`;
      });

      return `{\n${lines.join('\n')}\n${pad}}`;
    }

    case 'union':
      return node.variants.map((v) => schemaToTsType(v, indent)).join(' | ');

    case 'intersection':
      return node.parts.map((p) => schemaToTsType(p, indent)).join(' & ');

    case 'unknown':
    default:
      return 'unknown';
  }
}

/**
 * Convert an IR SchemaNode into a Zod schema expression string.
 * The generated MCP server uses Zod for tool input validation via the SDK.
 */
export function schemaToZod(node: SchemaNode, indent = 0): string {
  const innerPad = '  '.repeat(indent + 1);

  switch (node.kind) {
    case 'primitive': {
      let base: string;
      switch (node.type) {
        case 'string':
          base = 'z.string()';
          break;
        case 'number':
          base = 'z.number()';
          break;
        case 'integer':
          base = 'z.number().int()';
          break;
        case 'boolean':
          base = 'z.boolean()';
          break;
        case 'null':
          base = 'z.null()';
          break;
        default:
          base = 'z.unknown()';
      }
      if (node.nullable) base = `z.union([${base}, z.null()])`;
      return base;
    }

    case 'enum': {
      if (node.values.every((v) => typeof v === 'string')) {
        const vals = node.values.map((v) => JSON.stringify(v)).join(', ');
        return `z.enum([${vals}])`;
      }
      const vals = node.values.map((v) => `z.literal(${JSON.stringify(v)})`).join(', ');
      return `z.union([${vals}])`;
    }

    case 'array': {
      const inner = schemaToZod(node.items, indent);
      let base = `z.array(${inner})`;
      if (node.minItems !== undefined) base += `.min(${node.minItems})`;
      if (node.maxItems !== undefined) base += `.max(${node.maxItems})`;
      return base;
    }

    case 'object': {
      const props = Object.entries(node.properties);
      if (props.length === 0) return 'z.record(z.unknown())';

      const lines = props.map(([key, prop]) => {
        let val = schemaToZod(prop.schema, indent + 1);
        if (!prop.required) val += '.optional()';
        if (prop.description) val += `.describe(${JSON.stringify(prop.description)})`;
        return `${innerPad}${JSON.stringify(key)}: ${val},`;
      });
      return `z.object({\n${lines.join('\n')}\n${'  '.repeat(indent)}})`;
    }

    case 'union': {
      if (node.variants.length === 0) return 'z.unknown()';
      if (node.variants.length === 1) return schemaToZod(node.variants[0]!, indent);
      const variants = node.variants.map((v) => schemaToZod(v, indent));
      return `z.union([${variants.join(', ')}])`;
    }

    case 'intersection': {
      if (node.parts.length === 0) return 'z.unknown()';
      if (node.parts.length === 1) return schemaToZod(node.parts[0]!, indent);
      const [first, ...rest] = node.parts.map((p) => schemaToZod(p, indent));
      return rest.reduce((acc, part) => `${acc}.and(${part})`, first!);
    }

    case 'unknown':
    default:
      return 'z.unknown()';
  }
}
