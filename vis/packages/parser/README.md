# @vis/parser — OpenAPI 3.x Parser

Transforms OpenAPI 3.x specifications into Vis's Intermediate Representation (IR).

## Features

- ✅ **Full OpenAPI 3.x Support**: Parses JSON and YAML formats
- ✅ **Schema Conversion**: Handles allOf, oneOf, anyOf, arrays, objects, enums
- ✅ **Circular Reference Detection**: Depth-limited resolution (configurable)
- ✅ **Parameter Handling**: Path, query, header, and cookie parameters
- ✅ **Request Body**: Full request body parsing with media types
- ✅ **Response Handling**: Status codes with content types
- ✅ **Security Schemes**: Preserved in IR for future authentication injection
- ✅ **Deterministic**: Same input always produces the same IR

## Schema Support

| OpenAPI Feature      | Support                                       |
| -------------------- | --------------------------------------------- |
| Primitive types      | ✅ string, number, integer, boolean, null     |
| Arrays               | ✅ With minItems/maxItems                     |
| Objects              | ✅ Properties, required, additionalProperties |
| Enum                 | ✅                                            |
| allOf (intersection) | ✅                                            |
| oneOf/anyOf (union)  | ✅                                            |
| $ref resolution      | ✅ Local references only                      |
| Circular refs        | ✅ Detected up to depth 20                    |
| Nullable             | ✅                                            |

## Usage

```typescript
import { OpenAPIParser, loadSpec } from '@vis/parser';

// Load and parse
const raw = await loadSpec('./openapi.yaml');
const parser = new OpenAPIParser();
const spec = await parser.parse(raw, {
  baseUrl: 'https://api.example.com',
  transport: 'stdio',
});
```

## Examples

### Parsing a Local File

```typescript
const raw = await loadSpec('./api.yaml');
const spec = await new OpenAPIParser().parse(raw);
```

### Parsing from URL

```typescript
const raw = await loadSpec('https://api.example.com/openapi.json');
const spec = await new OpenAPIParser().parse(raw);
```

### Parser Options

```typescript
const spec = await parser.parse(raw, {
  baseUrl: 'https://custom-api.com', // Override server URL
  validate: true, // Validate OpenAPI document
  maxRefDepth: 20, // Max depth for $ref resolution
  transport: 'stdio', // Target transport
});
```

## License

ApacheV2 [LICENSE](../../../LICENSE)
