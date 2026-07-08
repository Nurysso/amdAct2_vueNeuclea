# @vis/cli — Vis Command-Line Interface

The main entry point for the Vis code generator.

## Installation

```bash
npm install -g @vis/cli
# or
pnpm add -g @vis/cli
```

## Usage

```bash
vis build <spec> [options]
```

## Commands

### `build`

Generates an MCP server from an OpenAPI specification.

```bash
vis build ./openapi.yaml --out ./my-server
```

## Options

| Option                    | Description                    | Default                |
| ------------------------- | ------------------------------ | ---------------------- |
| `-o, --out <dir>`         | Output directory               | `./mcp-server`         |
| `--base-url <url>`        | Override upstream API base URL | From OpenAPI spec      |
| `--package-name <name>`   | npm package name               | Derived from API title |
| `--package-version <ver>` | npm package version            | `0.1.0`                |
| `--force`                 | Overwrite existing directory   | `false`                |
| `--no-install`            | Skip npm install               | `false`                |
| `--typecheck`             | Run TypeScript type check      | `false`                |
| `-h, --help`              | Show help                      |                        |
| `-v, --version`           | Show version                   |                        |

## Examples

### Basic Usage

```bash
vis build ./openapi.json
```

### Custom Output Directory

```bash
vis build ./openapi.json --out ./my-mcp-server
```

### Override Base URL

```bash
vis build ./openapi.json --base-url https://api.example.com
```

### Force Overwrite with Typecheck

```bash
vis build ./api.yaml --out ./my-server --force --typecheck
```

### Generate from URL

```bash
vis build http://localhost:8000/openapi.json --out ./my-server
```

## License

ApacheV2 [LICENSE](../../../LICENSE)
