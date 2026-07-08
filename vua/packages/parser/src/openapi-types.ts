/**
 * Minimal structural types for OpenAPI 3.x documents.
 * We only type what we actually read; everything else is `unknown`.
 */
export interface OpenAPIDoc {
  openapi: string;
  info: InfoObject;
  servers?: ServerObject[];
  paths?: Record<string, PathItemObject>;
  components?: ComponentsObject;
}

export interface InfoObject {
  title: string;
  version: string;
  description?: string;
}

export interface ServerObject {
  url: string;
  description?: string;
}

export interface PathItemObject {
  summary?: string;
  description?: string;
  get?: OperationObject;
  post?: OperationObject;
  put?: OperationObject;
  patch?: OperationObject;
  delete?: OperationObject;
  head?: OperationObject;
  options?: OperationObject;
  trace?: OperationObject;
  parameters?: (ParameterObject | ReferenceObject)[];
}

export interface OperationObject {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  parameters?: (ParameterObject | ReferenceObject)[];
  requestBody?: RequestBodyObject | ReferenceObject;
  responses?: Record<string, ResponseObject | ReferenceObject>;
  security?: SecurityRequirementObject[];
}

export interface ParameterObject {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  deprecated?: boolean;
  schema?: SchemaObject | ReferenceObject;
}

export interface RequestBodyObject {
  required?: boolean;
  description?: string;
  content?: Record<string, MediaTypeObject>;
}

export interface MediaTypeObject {
  schema?: SchemaObject | ReferenceObject;
}

export interface ResponseObject {
  description?: string;
  content?: Record<string, MediaTypeObject>;
}

export interface SchemaObject {
  type?: string | string[];
  format?: string;
  description?: string;
  nullable?: boolean;
  enum?: unknown[];
  default?: unknown;
  properties?: Record<string, SchemaObject | ReferenceObject>;
  required?: string[];
  items?: SchemaObject | ReferenceObject;
  allOf?: (SchemaObject | ReferenceObject)[];
  anyOf?: (SchemaObject | ReferenceObject)[];
  oneOf?: (SchemaObject | ReferenceObject)[];
  additionalProperties?: SchemaObject | ReferenceObject | boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
  minItems?: number;
  maxItems?: number;
  $ref?: string;
}

export interface ReferenceObject {
  $ref: string;
}

export interface ComponentsObject {
  schemas?: Record<string, SchemaObject | ReferenceObject>;
  securitySchemes?: Record<string, SecuritySchemeObject | ReferenceObject>;
}

export interface SecuritySchemeObject {
  type: string;
  name?: string;
  description?: string;
  in?: string;
  scheme?: string;
  bearerFormat?: string;
  flows?: unknown;
  openIdConnectUrl?: string;
}

export interface SecurityRequirementObject {
  [schemeName: string]: string[];
}

export function isReferenceObject(v: unknown): v is ReferenceObject {
  return typeof v === "object" && v !== null && "$ref" in v;
}
