import type {
  HttpMethod,
  ResponseObject as IRResponseObject,
  Operation,
  Parameter,
  ParserAdapter,
  ParserOptions,
  RequestBody,
  SecurityScheme,
  ServiceSpec,
} from '@vis/core';
import { ParseError } from '@vis/core';
import type {
  OpenAPIDoc,
  OperationObject,
  ParameterObject,
  RequestBodyObject,
  ResponseObject,
  SecuritySchemeObject,
} from './openapi-types.js';
import { isReferenceObject } from './openapi-types.js';
import { SchemaConverter } from './schema-converter.js';

const HTTP_METHODS: HttpMethod[] = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
  'trace',
];

export class OpenAPIParser implements ParserAdapter {
  canParse(raw: unknown): boolean {
    if (typeof raw !== 'object' || raw === null) return false;
    const doc = raw as Record<string, unknown>;
    return typeof doc['openapi'] === 'string' && doc['openapi'].startsWith('3.');
  }

  async parse(raw: unknown, options?: ParserOptions): Promise<ServiceSpec> {
    if (!this.canParse(raw)) {
      throw new ParseError('Document is not a valid OpenAPI 3.x specification', raw);
    }

    const doc = raw as OpenAPIDoc;
    this.validateRequired(doc);

    const schemaConverter = new SchemaConverter(doc.components?.schemas ?? {});

    const baseUrl = this.resolveBaseUrl(doc, options?.baseUrl);
    const securitySchemes = this.parseSecuritySchemes(doc);
    const operations = this.parseOperations(doc, schemaConverter);

    const result: ServiceSpec = {
      title: doc.info.title,
      version: doc.info.version,
      baseUrl,
      operations,
      securitySchemes,
      transport: options?.transport ?? 'stdio',
    };
    if (doc.info.description) result.description = doc.info.description;
    return result;
  }

  //  Validation

  private validateRequired(doc: OpenAPIDoc): void {
    if (!doc.info?.title) {
      throw new ParseError('Missing required field: info.title');
    }
    if (!doc.info?.version) {
      throw new ParseError('Missing required field: info.version');
    }
  }

  //  Base URL

  private resolveBaseUrl(doc: OpenAPIDoc, override?: string): string {
    if (override) return override.replace(/\/$/, '');
    const first = doc.servers?.[0]?.url;
    if (first) {
      // Make relative server URLs absolute (common in FastAPI local docs)
      if (first.startsWith('/')) return first.replace(/\/$/, '');
      return first.replace(/\/$/, '');
    }
    return '';
  }

  //  Security schemes

  private parseSecuritySchemes(doc: OpenAPIDoc): Record<string, SecurityScheme> {
    const result: Record<string, SecurityScheme> = {};
    const rawSchemes = doc.components?.securitySchemes ?? {};

    for (const [name, raw] of Object.entries(rawSchemes)) {
      if (isReferenceObject(raw)) continue; // skip unresolved refs
      const scheme = raw as SecuritySchemeObject;

      const kind = this.mapSecurityKind(scheme.type);
      if (!kind) continue;

      const sec: SecurityScheme = { kind, name };
      if (scheme.description) sec.description = scheme.description;
      result[name] = sec;
    }

    return result;
  }

  private mapSecurityKind(type: string): SecurityScheme['kind'] | undefined {
    switch (type) {
      case 'apiKey':
        return 'apiKey';
      case 'http':
        return 'http';
      case 'oauth2':
        return 'oauth2';
      case 'openIdConnect':
        return 'openIdConnect';
      default:
        return undefined;
    }
  }

  //  Operations

  private parseOperations(doc: OpenAPIDoc, converter: SchemaConverter): Operation[] {
    const operations: Operation[] = [];
    const paths = doc.paths ?? {};
    const usedIds = new Map<string, number>();

    for (const [path, pathItem] of Object.entries(paths)) {
      if (!pathItem) continue;

      // Path-level parameters, inherited by all operations on this path
      const pathParams = (pathItem.parameters ?? [])
        .filter((p) => !isReferenceObject(p))
        .map((p) => this.parseParameter(p as ParameterObject, converter));

      for (const method of HTTP_METHODS) {
        const opObj = pathItem[method];
        if (!opObj) continue;

        const op = this.parseOperation(opObj, method, path, pathParams, converter, usedIds, doc);
        operations.push(op);
      }
    }

    return operations;
  }

  private parseOperation(
    opObj: OperationObject,
    method: HttpMethod,
    path: string,
    inheritedParams: Parameter[],
    converter: SchemaConverter,
    usedIds: Map<string, number>,
    doc: OpenAPIDoc
  ): Operation {
    const operationId = this.generateOperationId(opObj, method, path, usedIds);

    // Merge path-level params with operation-level (op-level wins on name+in)
    const opParams = (opObj.parameters ?? [])
      .filter((p) => !isReferenceObject(p))
      .map((p) => this.parseParameter(p as ParameterObject, converter));

    const parameters = this.mergeParameters(inheritedParams, opParams);

    const requestBody = opObj.requestBody
      ? this.parseRequestBody(opObj.requestBody, converter)
      : undefined;

    const responses = this.parseResponses(opObj.responses ?? {}, converter);
    const security = this.parseOperationSecurity(opObj, doc);

    const op: Operation = {
      operationId,
      method,
      path,
      parameters,
      responses,
      security,
    };
    if (opObj.summary) op.summary = opObj.summary;
    if (opObj.description) op.description = opObj.description;
    if (opObj.tags) op.tags = opObj.tags;
    if (opObj.deprecated) op.deprecated = opObj.deprecated;
    if (requestBody) op.requestBody = requestBody; // already optional
    return op;
  }

  //  operationId generation

  private generateOperationId(
    opObj: OperationObject,
    method: HttpMethod,
    path: string,
    usedIds: Map<string, number>
  ): string {
    let base = opObj.operationId;

    if (!base) {
      // Derive from method + path: GET /users/{id} → getUsersById
      const segments = path
        .split('/')
        .filter(Boolean)
        .map((seg) => {
          if (seg.startsWith('{') && seg.endsWith('}')) {
            return 'By' + this.capitalize(seg.slice(1, -1));
          }
          return this.capitalize(seg);
        });
      base = method + segments.join('');
    }

    // Sanitize: strip non-alphanumeric except underscores
    base = base.replace(/[^a-zA-Z0-9_]/g, '_');

    // Deduplicate
    const count = usedIds.get(base) ?? 0;
    usedIds.set(base, count + 1);
    return count === 0 ? base : `${base}_${count}`;
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  //  Parameters

  private parseParameter(raw: ParameterObject, converter: SchemaConverter): Parameter {
    const location = raw.in as Parameter['in'];
    if (!['path', 'query', 'header', 'cookie'].includes(location)) {
      // Demote unknown locations to query silently
    }

    const name = raw.name;
    const required = raw.required ?? false;
    const schema = converter.convert(raw.schema);
    const param: Parameter = {
      name,
      in: location,
      required,
      schema,
    };
    if (raw.description) param.description = raw.description;
    if (raw.deprecated) param.deprecated = raw.deprecated;
    return param;
  }

  private mergeParameters(inherited: Parameter[], own: Parameter[]): Parameter[] {
    const map = new Map<string, Parameter>();
    for (const p of inherited) map.set(`${p.in}:${p.name}`, p);
    for (const p of own) map.set(`${p.in}:${p.name}`, p); // own wins
    return Array.from(map.values());
  }

  //  Request body

  private parseRequestBody(raw: unknown, converter: SchemaConverter): RequestBody | undefined {
    if (isReferenceObject(raw)) return undefined;
    const body = raw as RequestBodyObject;

    const content: RequestBody['content'] = {};
    for (const [mediaType, mediaObj] of Object.entries(body.content ?? {})) {
      content[mediaType] = {
        schema: converter.convert(mediaObj.schema),
      };
    }

    const required = body.required ?? false; // ← Add this line
    const rb: RequestBody = { required, content };
    if (body.description) rb.description = body.description;
    return rb;
  }

  //  Responses

  private parseResponses(
    rawResponses: Record<string, unknown>,
    converter: SchemaConverter
  ): Record<string, IRResponseObject> {
    const result: Record<string, IRResponseObject> = {};

    for (const [status, rawResp] of Object.entries(rawResponses)) {
      if (isReferenceObject(rawResp)) continue;
      const resp = rawResp as ResponseObject;

      const content: IRResponseObject['content'] = {};
      for (const [mediaType, mediaObj] of Object.entries(resp.content ?? {})) {
        content[mediaType] = {
          schema: converter.convert(mediaObj.schema),
        };
      }

      const respObj: IRResponseObject = {
        description: resp.description ?? '',
      };
      if (Object.keys(content).length > 0) respObj.content = content;
      result[status] = respObj;
    }

    return result;
  }

  //  Per-operation security

  private parseOperationSecurity(opObj: OperationObject, doc: OpenAPIDoc): SecurityScheme[] {
    const reqs = opObj.security;
    if (!reqs || reqs.length === 0) return [];

    const globalSchemes = doc.components?.securitySchemes ?? {};
    const result: SecurityScheme[] = [];

    for (const req of reqs) {
      for (const schemeName of Object.keys(req)) {
        const raw = globalSchemes[schemeName];
        if (!raw || isReferenceObject(raw)) continue;
        const scheme = raw as SecuritySchemeObject;
        const kind = this.mapSecurityKind(scheme.type);
        if (!kind) continue;
        const schemeObj: SecurityScheme = { kind, name: schemeName };
        if (scheme.description) schemeObj.description = scheme.description;
        result.push(schemeObj);
      }
    }

    return result;
  }
}
