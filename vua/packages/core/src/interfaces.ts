import type { ServiceSpec, TransportKind } from './ir.js';

export type FileTree = File[];

export interface File {
  relativePath: string;
  content: string | Buffer;
}

export interface GenerateOptions {
  spec?: ServiceSpec;
  outputDir?: string;
  templateEngine?: TemplateEngine;
  variables?: Record<string, unknown>;
  install?: boolean;
  typecheck?: boolean;
  force?: boolean;
}

export interface GenerateResult {
  outDir: string;
  filesWritten: string[];
  installRan: boolean;
  typecheckPassed?: boolean | undefined;
  files: FileTree;
  warnings?: string[];
  operationCount?: number;
}

export interface Generator {
  generate(files: FileTree, outDir: string, options?: GenerateOptions): Promise<GenerateResult>;
}

export interface ParserOptions {
  baseUrl?: string;
  validate?: boolean;
  maxRefDepth?: number;
  transport?: TransportKind;
}

export interface ParserAdapter {
  parse(content: unknown, options?: ParserOptions): Promise<ServiceSpec>;
  canParse(content: string): boolean;
}

export interface RenderOptions {
  spec?: ServiceSpec;
  outputDir?: string;
  variables?: Record<string, unknown>;
  packageName?: string;
  packageVersion?: string;
}

export interface TemplateEngine {
  render(spec: ServiceSpec, options: RenderOptions): Promise<FileTree>;
}

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly location?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

export class RenderError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'RenderError';
  }
}

export class GenerateError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'GenerateError';
  }
}
