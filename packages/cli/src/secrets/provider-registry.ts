import { GoodBoyError } from '../lib/errors.js';
import type { SecretProvider } from './types.js';
import type { SecretProviderConfig, SecretProviderConfigOnePasswordCli } from './config.js';
import { createEnvironmentProvider } from './providers/environment.js';
import { createOnePasswordCliProvider } from './providers/onepassword-cli.js';

type ProviderFactory = (config: SecretProviderConfig) => SecretProvider;

// D6's two v1 provider types. Adding a third here would be a schema change
// (config.schema.json's closed oneOf) as much as a registry change — this
// map is not meant to be an open extension point on its own.
const PROVIDER_FACTORIES: Record<string, ProviderFactory> = {
  environment: () => createEnvironmentProvider(),
  'onepassword-cli': (config) => createOnePasswordCliProvider(config as SecretProviderConfigOnePasswordCli),
};

function createProvider(config: SecretProviderConfig): SecretProvider {
  const factory = PROVIDER_FACTORIES[config.type];
  if (factory) return factory(config);

  // Reachable only if a caller bypasses config.schema.json's closed oneOf
  // (e.g. via an `as` cast) — config.type is a two-member union at the type
  // level and schema-validated at the JSON level for every real caller.
  // Kept as a fail-closed guard rather than assumed away. (There is no
  // longer a separate "known but not implemented" tier: S4b's environment
  // and S4c's onepassword-cli are both real now, and D6 promises no third
  // v1 provider — reintroduce that tier only if a future provider is
  // actually designed and mid-implementation.)
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
