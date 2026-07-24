import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Ajv } from 'ajv';
import * as addFormatsPkg from 'ajv-formats';
import { getGoodboyHome } from '../lib/store.js';

const addFormats = (addFormatsPkg as unknown as { default: (ajv: Ajv) => Ajv }).default;
const _require = createRequire(import.meta.url);

const USER_CONFIG_FILE = 'config.json';
const PROJECT_CONFIG_FILE = 'goodboy.local.json';

export interface SecretProviderConfigEnvironment {
  type: 'environment';
}

export interface SecretProviderConfigOnePasswordCli {
  type: 'onepassword-cli';
  account?: string;
  timeoutMs?: number;
}

export type SecretProviderConfig = SecretProviderConfigEnvironment | SecretProviderConfigOnePasswordCli;

export interface SecretMappingConfig {
  provider?: string;
  reference: string;
}

export interface GoodBoyConfig {
  schema: '1.0.0';
  secrets?: {
    defaultProvider?: string;
    providers?: Record<string, SecretProviderConfig>;
    mappings?: Record<string, SecretMappingConfig>;
  };
}

let _validator: ReturnType<Ajv['compile']> | null = null;

// Unlike manifest.ts, there is no second consumer of the raw schema object
// (no tolerant-minor logic here — see the module doc comment), so there is
// nothing to justify caching it separately from the compiled validator.
function getValidator(): ReturnType<Ajv['compile']> {
  if (_validator) return _validator;
  const schema = _require('@goodboyjs/schema/src/config.schema.json') as Record<string, unknown>;
  const ajv = new Ajv({ strict: true, allErrors: true });
  addFormats(ajv);
  _validator = ajv.compile(schema);
  return _validator;
}

function throwValidationError(validate: ReturnType<Ajv['compile']>, filePath: string): never {
  /* c8 ignore next 2 -- ajv always populates errors[] after a failed validate(); ?? fallbacks are unreachable */
  const lines = (validate.errors ?? []).map(
    (e) => `  ${e.instancePath || '(root)'}: ${e.message ?? 'validation failed'}`,
  );
  throw new Error(`Invalid config in "${filePath}":\n${lines.join('\n')}`);
}

async function readConfigFile(filePath: string): Promise<GoodBoyConfig | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`"${filePath}" contains invalid JSON`);
  }

  const validate = getValidator();
  if (!validate(parsed)) throwValidationError(validate, filePath);
  return parsed as GoodBoyConfig;
}

export function getUserConfigPath(): string {
  return join(getGoodboyHome(), USER_CONFIG_FILE);
}

export function getProjectConfigPath(dir: string): string {
  return join(dir, PROJECT_CONFIG_FILE);
}

/** Reads ~/.goodboy/config.json. Missing file is not an error: returns null. */
export async function loadUserConfig(): Promise<GoodBoyConfig | null> {
  return readConfigFile(getUserConfigPath());
}

/** Reads <dir>/goodboy.local.json. Missing file is not an error: returns null. */
export async function loadProjectConfig(dir: string): Promise<GoodBoyConfig | null> {
  return readConfigFile(getProjectConfigPath(dir));
}

/**
 * Merges user- and project-level config per D3's precedence: project wins
 * outright for defaultProvider; providers/mappings merge by name, with a
 * project entry replacing a user entry of the same name entirely (never a
 * deep field-by-field merge) and entries unique to either side preserved.
 */
export function mergeConfig(user: GoodBoyConfig | null, project: GoodBoyConfig | null): GoodBoyConfig {
  const userSecrets = user?.secrets;
  const projectSecrets = project?.secrets;

  const defaultProvider = projectSecrets?.defaultProvider ?? userSecrets?.defaultProvider;
  const providers = { ...(userSecrets?.providers ?? {}), ...(projectSecrets?.providers ?? {}) };
  const mappings = { ...(userSecrets?.mappings ?? {}), ...(projectSecrets?.mappings ?? {}) };

  const hasSecrets =
    defaultProvider !== undefined || Object.keys(providers).length > 0 || Object.keys(mappings).length > 0;

  if (!hasSecrets) {
    return { schema: '1.0.0' };
  }

  return {
    schema: '1.0.0',
    secrets: {
      ...(defaultProvider !== undefined ? { defaultProvider } : {}),
      ...(Object.keys(providers).length > 0 ? { providers } : {}),
      ...(Object.keys(mappings).length > 0 ? { mappings } : {}),
    },
  };
}
