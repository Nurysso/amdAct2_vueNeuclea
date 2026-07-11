// Export high-level interfaces and errors from interfaces.ts
export type {
  FileTree,
  GenerateOptions,
  GenerateResult,
  Generator,
  ParserAdapter,
  ParserOptions,
  RenderOptions,
  TemplateEngine,
} from './interfaces.js';

export { GenerateError, ParseError, RenderError } from './interfaces.js';

// Export all IR types from ir.ts
export * from './ir.js';
