import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'vis-cli': 'src/cli.ts',
  },
  // Change format to cjs to better handle dynamic requires
  format: ['cjs'],
  target: 'node20',
  platform: 'node',
  splitting: false,
  clean: true,
  outDir: 'dist',
  banner: {
    js: '#!/usr/bin/env node',
  },
  // Keep @vis packages bundled
  noExternal: [/^@vis\//],
  // Force everything ELSE (including node built-ins) to stay external
  external: ['./node_modules/*', 'child_process', 'fs', 'path', 'os'],
});
