import { GoodBoyError } from '../lib/errors.js';
import type { GoodBoyConfig } from './config.js';
import type { ProviderRegistry } from './provider-registry.js';
import type { SecretResolutionContext, SecretValue } from './types.js';

interface ResolutionFailure {
  name: string;
  cause: unknown;
}

async function resolveOne(
  name: string,
  config: GoodBoyConfig,
  registry: ProviderRegistry,
  ctx: SecretResolutionContext,
): Promise<SecretValue> {
  const mapping = config.secrets?.mappings?.[name];
  if (!mapping) {
    throw new GoodBoyError(`No secret mapping configured for "${name}".`, {
      code: 'E_SECRET_MAPPING_NOT_CONFIGURED',
      safeMetadata: { name },
    });
  }

  const providerName = mapping.provider ?? config.secrets?.defaultProvider;
  if (!providerName) {
    throw new GoodBoyError(
      `Secret "${name}" has no provider set on its mapping, and no defaultProvider is configured.`,
      { code: 'E_SECRET_NO_PROVIDER', safeMetadata: { name } },
    );
  }

  let provider;
  try {
    provider = registry.getProvider(providerName);
  } catch (err) {
    throw new GoodBoyError(`Failed to resolve secret "${name}": provider "${providerName}" is unavailable.`, {
      code: 'E_SECRET_PROVIDER_UNAVAILABLE',
      cause: err,
      safeMetadata: { name, providerName },
    });
  }

  try {
    return await provider.resolve(mapping.reference, ctx);
  } catch (err) {
    throw new GoodBoyError(`Failed to resolve secret "${name}".`, {
      code: 'E_SECRET_RESOLUTION_FAILED',
      cause: err,
      safeMetadata: { name, providerName },
    });
  }
}

/**
 * Resolves exactly the requested `names` — never anything else configured
 * (invariant 6) — to a SecretValue per name, via the given, already-built
 * ProviderRegistry. An empty `names` array touches nothing (invariant 7):
 * no mapping lookup, no registry call.
 *
 * All requested names resolve concurrently (they're independent), but
 * failures are aggregated rather than reported via whichever one happens
 * to settle first: Promise.allSettled preserves input order in its results
 * regardless of real-time completion order, so the failure list below is
 * naturally deterministic and matches `names`' order — not settlement
 * order — with no extra sorting needed. A partial result is never
 * returned: if any requested name fails, the whole call rejects.
 */
export async function resolveSecrets(
  names: string[],
  config: GoodBoyConfig,
  registry: ProviderRegistry,
  ctx: SecretResolutionContext,
): Promise<Record<string, SecretValue>> {
  if (names.length === 0) return {};

  const settled = await Promise.allSettled(names.map((name) => resolveOne(name, config, registry, ctx)));

  const failures: ResolutionFailure[] = [];
  const result: Record<string, SecretValue> = {};

  settled.forEach((outcome, index) => {
    const name = names[index]!;
    if (outcome.status === 'fulfilled') {
      result[name] = outcome.value;
    } else {
      failures.push({ name, cause: outcome.reason });
    }
  });

  if (failures.length > 0) {
    throw new GoodBoyError(`Failed to resolve secret(s): ${failures.map((f) => f.name).join(', ')}.`, {
      code: 'E_SECRETS_RESOLUTION_FAILED',
      safeMetadata: { failures },
    });
  }

  return result;
}
