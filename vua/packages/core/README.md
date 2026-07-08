# @vis/core — Core IR & Interfaces

The foundation of the Vis ecosystem. This package defines:

- **IR (Intermediate Representation)**: The data structures that represent an OpenAPI specification in a normalized, template-friendly format
- **Plugin Interfaces**: Contracts for parsers, generators, and template engines
- **Error Classes**: Standardized error types for the entire ecosystem

## IR Types

The IR captures everything needed to generate an MCP server:

### Schema Types

- `PrimitiveSchema` — `string`, `number`, `integer`, `boolean`, `null`
- `EnumSchema` — Enum values with type information
- `ArraySchema` — Arrays with item schemas and constraints
- `ObjectSchema` — Objects with properties and additional properties
- `UnionSchema` — `oneOf` / `anyOf` unions
- `IntersectionSchema` — `allOf` intersections
- `UnknownSchema` — Fallback for unresolvable schemas

### Service Types

- `ServiceSpec` — Top-level service specification
- `Operation` — API operation with method, path, parameters, etc.
- `Parameter` — Operation parameters (path, query, header, cookie)
- `RequestBody` — Request body with media types
- `ResponseObject` — Response with status codes and content

### Extension Points

- `SecurityScheme` — Authentication metadata (currently informational)
- `TransportKind` — Transport hints: `"stdio"`, `"sse"`, `"http"`

## Interfaces

### TemplateEngine

```typescript
interface TemplateEngine {
  render(spec: ServiceSpec, options?: RenderOptions): Promise<FileTree>;
}
```

### ParserAdapter

```typescript
interface ParserAdapter {
  parse(content: unknown, options?: ParserOptions): Promise<ServiceSpec>;
  canParse(content: unknown): boolean;
}
```

### Generator

```typescript
interface Generator {
  generate(files: FileTree, outDir: string, options?: GenerateOptions): Promise<GenerateResult>;
}
```

## Design Philosophy

1. **Pure Types**: All interfaces are pure TypeScript types with no runtime dependencies
2. **Extensible**: Extension points are explicitly documented in the IR
3. **Deterministic**: IR itself doesn't contain any runtime logic that could introduce randomness
4. **Forward-Compatible**: Optional fields ensure future extensions don't break existing code

## Usage

```typescript
import { ServiceSpec, ParserAdapter, TemplateEngine } from '@vis/core';
```

## License

ApacheV2
