# @vis/generator — File System Generator

Writes generated MCP server files to disk and runs post-generation tasks.

## Features

- ✅ **File Writing**: Creates directory structure and writes all files
- ✅ **Force Overwrite**: Option to overwrite existing directories
- ✅ **npm Install**: Automatically runs `npm install` in generated directory
- ✅ **Type Checking**: Optional `tsc --noEmit` to validate generated code
- ✅ **Deterministic**: Pure file generation based on input

## Usage

```typescript
import { FsGenerator } from '@vis/generator';
import type { FileTree } from '@vis/core';

const generator = new FsGenerator();
const result = await generator.generate(fileTree, './output', {
  install: true,
  typecheck: true,
  force: false,
});

console.log(`Generated ${result.filesWritten.length} files`);
console.log(`Output directory: ${result.outDir}`);
console.log(`npm install: ${result.installRan}`);
console.log(`Type check: ${result.typecheckPassed}`);
```

## License

ApacheV2 [LICENSE](../../../LICENSE)
