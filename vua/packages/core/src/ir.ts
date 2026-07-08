//  Primitive type universe

export type PrimitiveKind = 'string' | 'number' | 'integer' | 'boolean' | 'null';

//  Schema (recursive, covers OpenAPI 3.x schema objects)

export type SchemaNode =
  | PrimitiveSchema
  | EnumSchema
  | ArraySchema
  | ObjectSchema
  | UnionSchema // oneOf / anyOf  → IR represents as union
  | IntersectionSchema // allOf      → IR represents as intersection
  | UnknownSchema; // fallback for unresolvable $ref / any

export interface PrimitiveSchema {
  kind: 'primitive';
  type: PrimitiveKind;
  format?: string; // "date-time", "uuid", "int64", etc. — preserved verbatim
  description?: string;
  nullable?: boolean;
  default?: unknown;
}

export interface EnumSchema {
  kind: 'enum';
  type: PrimitiveKind; // usually "string" or "integer"
  values: (string | number | boolean | null)[];
  description?: string;
  nullable?: boolean;
  default?: unknown;
}

export interface ArraySchema {
  kind: 'array';
  items: SchemaNode;
  description?: string;
  nullable?: boolean;
  minItems?: number;
  maxItems?: number;
}

export interface ObjectSchema {
  kind: 'object';
  properties: Record<string, PropertySchema>;
  required: string[];
  additionalProperties?: SchemaNode | boolean;
  description?: string;
  nullable?: boolean;
}

export interface PropertySchema {
  schema: SchemaNode;
  required: boolean;
  description?: string;
  readOnly?: boolean;
  writeOnly?: boolean;
}

export interface UnionSchema {
  kind: 'union';
  variants: SchemaNode[];
  description?: string;
  nullable?: boolean;
}

export interface IntersectionSchema {
  kind: 'intersection';
  parts: SchemaNode[];
  description?: string;
  nullable?: boolean;
}

export interface UnknownSchema {
  kind: 'unknown';
  description?: string;
  raw?: unknown; // preserved original for diagnostics
}

//  Parameters

export type ParamLocation = 'path' | 'query' | 'header' | 'cookie';

export interface Parameter {
  name: string;
  in: ParamLocation;
  required: boolean;
  description?: string;
  schema: SchemaNode;
  deprecated?: boolean;
}

//  Request body

export interface RequestBody {
  required: boolean;
  description?: string;
  // Keyed by media type, e.g. "application/json"
  content: Record<string, MediaTypeObject>;
}

export interface MediaTypeObject {
  schema: SchemaNode;
}

//  Responses

export interface ResponseObject {
  description: string;
  content?: Record<string, MediaTypeObject>;
}

//  Security (IR-supported, template generation unimplemented)

export type SecuritySchemeKind =
  | 'apiKey'
  | 'http' // Bearer / Basic
  | 'oauth2'
  | 'openIdConnect';

export interface SecurityScheme {
  kind: SecuritySchemeKind;
  name: string; // scheme identifier from components.securitySchemes
  description?: string;
  // Extension point: templates may read this to emit auth boilerplate
  // Currently unimplemented; field preserved in IR for forward compatibility
}

//  Operation

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options' | 'trace';

export interface Operation {
  operationId: string;
  method: HttpMethod;
  path: string; // raw path string, e.g. "/users/{id}"
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  parameters: Parameter[];
  requestBody?: RequestBody;
  responses: Record<string, ResponseObject>; // HTTP status code → response
  // Extension point: per-operation security overrides
  // Unimplemented in templates; carried in IR for future use
  security?: SecurityScheme[];
}

//  Transport hints (IR-supported, SSE/HTTP unimplemented)

export type TransportKind = 'stdio' | 'sse' | 'http';

//  Top-level ServiceSpec

export interface ServiceSpec {
  /** Human-readable API title from info.title */
  title: string;
  /** info.version */
  version: string;
  description?: string;
  /** Base URL of the upstream service (servers[0].url, normalized) */
  baseUrl: string;
  operations: Operation[];
  /**
   * Global security schemes declared in components.securitySchemes.
   * Carried in IR; auth injection in templates is an unimplemented extension point.
   */
  securitySchemes: Record<string, SecurityScheme>;
  /**
   * Target transport for the generated MCP server.
   * Only "stdio" is implemented; "sse" and "http" are reserved extension points.
   */
  transport: TransportKind;
}
