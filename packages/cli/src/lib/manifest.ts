import { createRequire } from 'node:module';
import { statSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Ajv } from 'ajv';
import * as addFormatsPkg from 'ajv-formats';
import type { GoodBoyManifest } from '../types/index.js';

const addFormats = (addFormatsPkg as unknown as { default: (ajv: Ajv) => Ajv }).default;
const _require = createRequire(import.meta.url);

const MAX_MANIFEST_BYTES = 512 * 1024; // 512 KB
const MAX_NESTING_DEPTH = 10;

let _validator: ReturnType<Ajv['compile']> | null = null;

function getValidator(): ReturnType<Ajv['compile']> {
  if (_validator) return _validator;
  const ajv = new Ajv({ strict: true, allErrors: true });
  addFormats(ajv);
  const schema = _require('@goodboy/schema/src/manifest.schema.json') as Record<string, unknown>;
  _validator = ajv.compile(schema);
  return _validator;
}

// Heuristic nesting depth check: counts opening brackets/braces.
// This is intentionally fast and runs before JSON.parse() to guard against
// deeply nested payloads that could exhaust the stack. Brackets inside
// string values inflate the count slightly but legitimate manifests are
// well within the limit.
function estimateNestingDepth(jsonString: string): number {
  let depth = 0;
  let maxDepth = 0;
  for (const ch of jsonString) {
    if (ch === '{' || ch === '[') {
      depth++;
      if (depth > maxDepth) maxDepth = depth;
    } else if (ch === '}' || ch === ']') {
      depth--;
    }
  }
  return maxDepth;
}

export async function readManifest(filePath: string): Promise<unknown> {
  const resolved = resolve(filePath);

  let size: number;
  try {
    size = statSync(resolved).size;
  } catch {
    throw new Error(`manifest.json not found`);
  }

  if (size > MAX_MANIFEST_BYTES) {
    throw new Error(`manifest.json exceeds the 512 KB size limit`);
  }

  let raw: string;
  try {
    raw = readFileSync(resolved, 'utf-8');
  } catch {
    throw new Error(`Cannot read manifest.json: permission denied`);
  }

  if (estimateNestingDepth(raw) > MAX_NESTING_DEPTH) {
    throw new Error(
      `Manifest structure is invalid: nesting depth exceeds maximum allowed (${MAX_NESTING_DEPTH})`,
    );
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`manifest.json contains invalid JSON`);
  }
}

export function validateManifest(data: unknown): GoodBoyManifest {
  const validate = getValidator();

  if (!validate(data)) {
    /* c8 ignore next 2 -- ajv always populates errors[] after a failed validate(); ?? fallbacks are unreachable */
    const lines = (validate.errors ?? []).map(
      (e) => `  ${e.instancePath || '(root)'}: ${e.message ?? 'validation failed'}`,
    );
    throw new Error(`Invalid manifest:\n${lines.join('\n')}`);
  }

  return data as GoodBoyManifest;
}

export async function writeManifest(filePath: string, data: GoodBoyManifest): Promise<void> {
  const resolved = resolve(filePath);
  try {
    writeFileSync(resolved, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  } catch {
    throw new Error(`Cannot write manifest.json: check directory permissions`);
  }
}
