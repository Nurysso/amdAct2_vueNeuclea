import type { FileTree, GenerateOptions, GenerateResult, Generator } from '@vis/core';
import { GenerateError } from '@vis/core';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class FsGenerator implements Generator {
  async generate(
    files: FileTree,
    outDir: string,
    options?: GenerateOptions
  ): Promise<GenerateResult> {
    const opts = {
      install: true,
      typecheck: false,
      force: false,
      ...options,
    };

    const resolved = path.resolve(process.cwd(), outDir);

    await this.prepareOutDir(resolved, opts.force);

    const filesWritten: string[] = [];

    for (const file of files) {
      const fullPath = path.join(resolved, file.relativePath);
      const dir = path.dirname(fullPath);

      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fullPath, file.content, 'utf-8');
      filesWritten.push(file.relativePath);
    }

    let installRan = false;
    let typecheckPassed: boolean | undefined;

    if (opts.install) {
      await this.runInstall(resolved);
      installRan = true;
    }

    if (opts.typecheck && installRan) {
      typecheckPassed = await this.runTypecheck(resolved);
    }

    return {
      outDir: resolved,
      filesWritten,
      installRan,
      files,
      warnings: [],
      operationCount: files.length,
      // Only inject the key if typecheckPassed is explicitly true or false
      ...(typecheckPassed !== undefined && { typecheckPassed }),
    };
  }

  private async prepareOutDir(dir: string, force: boolean): Promise<void> {
    try {
      await fs.access(dir);
      // Directory exists
      if (!force) {
        throw new GenerateError(
          `Output directory already exists: ${dir}\nUse --force to overwrite.`
        );
      }
      // force=true: remove and recreate
      await fs.rm(dir, { recursive: true, force: true });
    } catch (err) {
      if (err instanceof GenerateError) throw err;
      // Directory doesn't exist — good, we'll create it
    }

    await fs.mkdir(dir, { recursive: true });
  }

  private async runInstall(cwd: string): Promise<void> {
    try {
      // Prefer npm; the generated server has no pnpm dependency
      await execFileAsync('npm', ['install', '--prefer-offline'], {
        cwd,
        timeout: 120_000,
      });
    } catch (err) {
      throw new GenerateError(`npm install failed in ${cwd}`, err);
    }
  }

  private async runTypecheck(cwd: string): Promise<boolean> {
    try {
      await execFileAsync('npx', ['tsc', '--noEmit', '--project', 'tsconfig.json'], {
        cwd,
        timeout: 60_000,
      });
      return true;
    } catch {
      // Typecheck failure is reported but doesn't throw;
      // the files are already written and usable
      return false;
    }
  }
}
