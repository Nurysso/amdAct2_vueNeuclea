import { ParseError } from '@vis/core';
import yaml from 'js-yaml';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export async function loadSpec(source: string): Promise<unknown> {
  let raw: string;

  if (source.startsWith('http://') || source.startsWith('https://')) {
    raw = await fetchUrl(source);
  } else {
    const resolved = path.resolve(process.cwd(), source);
    try {
      raw = await fs.readFile(resolved, 'utf-8');
    } catch (err) {
      throw new ParseError(`Cannot read file: ${resolved}`, err);
    }
  }

  return parseDocument(raw, source);
}

async function fetchUrl(url: string): Promise<string> {
  const { default: fetch } = await import('node-fetch');
  let resp: Awaited<ReturnType<typeof fetch>>;
  try {
    resp = await fetch(url);
  } catch (err) {
    throw new ParseError(`Failed to fetch spec from URL: ${url}`, err);
  }

  if (!resp.ok) {
    throw new ParseError(`HTTP ${resp.status} fetching spec: ${url}`, { status: resp.status });
  }

  return resp.text();
}

function parseDocument(raw: string, source: string): unknown {
  const trimmed = raw.trim();

  // JSON: starts with { or [
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new ParseError(`Invalid JSON in ${source}`, err);
    }
  }

  // YAML fallback
  try {
    return yaml.load(raw);
  } catch (err) {
    throw new ParseError(`Invalid YAML in ${source}`, err);
  }
}
