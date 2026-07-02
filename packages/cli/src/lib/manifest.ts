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

const PRIVATE_IP_RE = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
];

function validateMcpServerUrl(url: string): void {
  let parsed: URL;
  /* c8 ignore start -- ajv "format: uri" + pattern "^https?://" make both the catch clause and
     the protocol check unreachable through the public validateManifest() API */
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`mcp_servers contains an invalid or disallowed URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`mcp_servers contains an invalid or disallowed URL: ${url}`);
  }
  /* c8 ignore stop */

  // WHATWG URL keeps brackets for IPv6 (e.g. "[::1]") — strip them before matching.
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  for (const re of PRIVATE_IP_RE) {
    if (re.test(hostname)) {
      throw new Error(`mcp_servers contains an invalid or disallowed URL: ${url}`);
    }
  }
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

const EXEC_ONLY_FIELDS = [
  'entry', 'language', 'mcp_servers', 'engines', 'os',
  'dependencies', 'devDependencies', 'permissions', 'hooks',
] as const;

// Exported for direct testing so the check can be verified independently of Ajv.
// validateManifest calls this after Ajv passes; callers of validateManifest get
// the guarantee for free and must not duplicate it.
export function assertKindConstraints(data: GoodBoyManifest): void {
  if (data.kind === 'passive') {
    const violations = EXEC_ONLY_FIELDS.filter(
      (f) => Object.prototype.hasOwnProperty.call(data, f),
    );
    if (violations.length > 0) {
      throw new Error(
        `Invalid manifest: passive skill contains executable-only field(s): ${violations.join(', ')}`,
      );
    }
  } else if (data.kind === 'executable') {
    if (Object.prototype.hasOwnProperty.call(data, 'content')) {
      throw new Error('Invalid manifest: executable skill contains passive-only field: content');
    }
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

  const manifest = data as GoodBoyManifest;

  assertKindConstraints(manifest);

  // Runtime second pass: block private/loopback MCP server URLs that pass
  // the schema pattern (^https?://) but point to internal infrastructure.
  if (manifest.kind === 'executable' && Array.isArray(manifest.mcp_servers)) {
    for (const server of manifest.mcp_servers) {
      if (typeof server.url === 'string') {
        validateMcpServerUrl(server.url);
      }
    }
  }

  return manifest;
}

export async function writeManifest(filePath: string, data: GoodBoyManifest): Promise<void> {
  const resolved = resolve(filePath);
  try {
    writeFileSync(resolved, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  } catch {
    throw new Error(`Cannot write manifest.json: check directory permissions`);
  }
}
