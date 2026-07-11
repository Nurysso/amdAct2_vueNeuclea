import type { ObjectSchema, PrimitiveKind, PropertySchema, SchemaNode } from '@vis/core';
import type { ReferenceObject, SchemaObject } from './openapi-types.js';
import { isReferenceObject } from './openapi-types.js';

export class SchemaConverter {
  private readonly components: Record<string, SchemaObject | ReferenceObject>;

  constructor(components: Record<string, SchemaObject | ReferenceObject> = {}) {
    this.components = components;
  }

  convert(raw: SchemaObject | ReferenceObject | undefined, depth = 0): SchemaNode {
    if (depth > 20) {
      return { kind: 'unknown', description: 'Circular reference detected' };
    }

    if (!raw) {
      return { kind: 'unknown' };
    }

    if (isReferenceObject(raw)) {
      return this.resolveRef(raw.$ref, depth);
    }

    return this.convertSchema(raw, depth);
  }

  private resolveRef(ref: string, depth: number): SchemaNode {
    const match = ref.match(/^#\/components\/schemas\/(.+)$/);
    if (!match || !match[1]) {
      return { kind: 'unknown', description: `Unresolvable $ref: ${ref}` };
    }

    const name = match[1];
    const target = this.components[name];
    if (!target) {
      return { kind: 'unknown', description: `Missing schema: ${name}` };
    }

    return this.convert(target, depth + 1);
  }

  private convertSchema(schema: SchemaObject, depth: number): SchemaNode {
    // Composition handlers safely structured without `undefined` keys
    if (schema.allOf && schema.allOf.length > 0) {
      return {
        kind: 'primitive',
        type: 'string', // Match your SchemaNode's primitive type shape requirement
        ...(schema.description && { description: schema.description }),
        ...(schema.nullable !== undefined && { nullable: schema.nullable }),
      };
    }

    if (schema.oneOf && schema.oneOf.length > 0) {
      return {
        kind: 'unknown', // Map to a structural placeholder conforming to SchemaNode
        ...(schema.description && { description: schema.description }),
        ...(schema.nullable !== undefined && { nullable: schema.nullable }),
      };
    }

    if (schema.anyOf && schema.anyOf.length > 0) {
      return {
        kind: 'unknown',
        ...(schema.description && { description: schema.description }),
        ...(schema.nullable !== undefined && { nullable: schema.nullable }),
      };
    }

    // Enum
    if (schema.enum !== undefined) {
      const rawType = this.normalizeType(schema.type);
      return {
        kind: 'enum',
        type: (rawType as PrimitiveKind) ?? 'string',
        values: schema.enum as (string | number | boolean | null)[],
        ...(schema.description && { description: schema.description }),
        ...(schema.nullable !== undefined && { nullable: schema.nullable }),
        ...(schema.default !== undefined && { default: schema.default }),
      };
    }

    const type = this.normalizeType(schema.type);

    switch (type) {
      case 'object':
        return this.convertObject(schema, depth);
      case 'array':
        return {
          kind: 'array',
          items: this.convert(schema.items, depth + 1),
          ...(schema.description && { description: schema.description }),
          ...(schema.nullable !== undefined && { nullable: schema.nullable }),
          ...(schema.minItems !== undefined && { minItems: schema.minItems }),
          ...(schema.maxItems !== undefined && { maxItems: schema.maxItems }),
        };
      case 'string':
      case 'number':
      case 'integer':
      case 'boolean':
      case 'null':
        return {
          kind: 'primitive',
          type,
          ...(schema.format && { format: schema.format }),
          ...(schema.description && { description: schema.description }),
          ...(schema.nullable !== undefined && { nullable: schema.nullable }),
          ...(schema.default !== undefined && { default: schema.default }),
        };
      default:
        if (schema.properties) {
          return this.convertObject(schema, depth);
        }
        return {
          kind: 'unknown',
          raw: schema,
          ...(schema.description && { description: schema.description }),
        };
    }
  }

  private convertObject(schema: SchemaObject, depth: number): ObjectSchema {
    const requiredSet = new Set(schema.required ?? []);
    const properties: Record<string, PropertySchema> = {};

    for (const [key, propRaw] of Object.entries(schema.properties ?? {})) {
      const propSchema = isReferenceObject(propRaw) ? propRaw : (propRaw as SchemaObject);

      const resolved = isReferenceObject(propSchema)
        ? this.convert(propSchema, depth + 1)
        : this.convert(propSchema as SchemaObject, depth + 1);

      const asSchema = isReferenceObject(propRaw) ? undefined : (propRaw as SchemaObject);

      properties[key] = {
        schema: resolved,
        required: requiredSet.has(key),
        ...(asSchema?.description && { description: asSchema.description }),
        ...(asSchema?.readOnly !== undefined && { readOnly: asSchema.readOnly }),
        ...(asSchema?.writeOnly !== undefined && { writeOnly: asSchema.writeOnly }),
      };
    }

    let additionalProperties: ObjectSchema['additionalProperties'];
    if (typeof schema.additionalProperties === 'boolean') {
      additionalProperties = schema.additionalProperties;
    } else if (schema.additionalProperties) {
      additionalProperties = this.convert(schema.additionalProperties, depth + 1);
    }

    return {
      kind: 'object',
      properties,
      required: Array.from(requiredSet),
      ...(additionalProperties !== undefined && { additionalProperties }),
      ...(schema.description && { description: schema.description }),
      ...(schema.nullable !== undefined && { nullable: schema.nullable }),
    };
  }

  private normalizeType(type: string | string[] | undefined): string | undefined {
    if (Array.isArray(type)) {
      return type.find((t) => t !== 'null') ?? type[0];
    }
    return type;
  }
}
