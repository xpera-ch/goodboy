import { GoodBoyError } from '../lib/errors.js';
import type { SecretProvider } from './types.js';
import type { SecretProviderConfig } from './config.js';
import { createEnvironmentProvider } from './providers/environment.js';

type ProviderFactory = (config: SecretProviderConfig) => SecretProvider;

// Exactly one entry today (D6: environment is the only implemented type).
// Adding onepassword-cli here in S4c is meant to be a one-line addition to
// this map, not a redesign — do not stub or partially implement it now.
const PROVIDER_FACTORIES: Record<string, ProviderFactory> = {
  environment: () => createEnvironmentProvider(),
};

// Provider types the schema already knows about but this build doesn't
// implement yet. Kept distinct from PROVIDER_FACTORIES so "not implemented
// yet" and "not configured at all" produce genuinely different, honest
// error messages rather than collapsing into one generic failure.
const KNOWN_BUT_NOT_IMPLEMENTED = new Set(['onepassword-cli']);

function createProvider(config: SecretProviderConfig): SecretProvider {
  const factory = PROVIDER_FACTORIES[config.type];
  if (factory) return factory(config);

  if (KNOWN_BUT_NOT_IMPLEMENTED.has(config.type)) {
    throw new GoodBoyError(`Provider type "${config.type}" is not implemented yet in this build.`, {
      code: 'E_PROVIDER_NOT_IMPLEMENTED',
      safeMetadata: { type: config.type },
    });
  }

  // Reachable only if a caller bypasses config.schema.json's closed oneOf
  // (e.g. via an `as` cast) — config.type is a two-member union at the type
  // level and schema-validated at the JSON level for every real caller.
  // Kept as a fail-closed guard rather than assumed away.
  throw new GoodBoyError(`Unknown provider type: "${config.type}"`, {
    code: 'E_PROVIDER_UNKNOWN_TYPE',
    safeMetadata: { type: config.type },
  });
}

export interface ProviderRegistry {
  getProvider(instanceName: string): SecretProvider;
}

/**
 * Lazily constructs and caches a SecretProvider per configured instance
 * name — only when actually requested (invariant 7: lazy initialization),
 * never eagerly for every configured provider.
 */
export function createProviderRegistry(providers: Record<string, SecretProviderConfig>): ProviderRegistry {
  const instances = new Map<string, SecretProvider>();

  return {
    getProvider(instanceName: string): SecretProvider {
      const cached = instances.get(instanceName);
      if (cached) return cached;

      const config = providers[instanceName];
      if (!config) {
        throw new GoodBoyError(`No provider instance named "${instanceName}" is configured.`, {
          code: 'E_PROVIDER_INSTANCE_NOT_CONFIGURED',
          safeMetadata: { instanceName },
        });
      }

      const provider = createProvider(config);
      instances.set(instanceName, provider);
      return provider;
    },
  };
}
