import { describe, it, expect, vi } from 'vitest';
import { resolveSecrets } from './resolver.js';
import { GoodBoyError } from '../lib/errors.js';
import { SecretValue } from './types.js';
import type { GoodBoyConfig } from './config.js';
import type { ProviderRegistry } from './provider-registry.js';
import type { SecretProvider } from './types.js';

function fakeRegistry(providers: Record<string, SecretProvider>): ProviderRegistry {
  return {
    getProvider: vi.fn((name: string) => {
      const provider = providers[name];
      if (!provider) {
        throw new GoodBoyError(`No provider instance named "${name}" is configured.`, {
          code: 'E_PROVIDER_INSTANCE_NOT_CONFIGURED',
          safeMetadata: { instanceName: name },
        });
      }
      return provider;
    }),
  };
}

function fakeProvider(
  id: string,
  resolveImpl: (reference: string) => Promise<SecretValue>,
): SecretProvider {
  return {
    id,
    checkAvailability: vi.fn(),
    resolve: vi.fn(resolveImpl),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface AggregateFailure {
  name: string;
  cause: unknown;
}

function failuresOf(err: unknown): AggregateFailure[] {
  return (err as GoodBoyError).safeMetadata['failures'] as AggregateFailure[];
}

describe('resolveSecrets()', () => {
  it('resolves an empty names array to {} without touching the registry at all (invariant 7)', async () => {
    const registry = fakeRegistry({});
    const result = await resolveSecrets([], { schema: '1.0.0' }, registry, {});

    expect(result).toEqual({});
    expect(registry.getProvider).not.toHaveBeenCalled();
  });

  it("resolves a name via its mapping's explicit provider, passing through the exact SecretValue instance", async () => {
    const secretValue = new SecretValue('resolved-value');
    const env = fakeProvider('environment', async () => secretValue);
    const registry = fakeRegistry({ env });
    const config: GoodBoyConfig = {
      schema: '1.0.0',
      secrets: { mappings: { MY_SECRET: { provider: 'env', reference: 'MY_REF' } } },
    };

    const result = await resolveSecrets(['MY_SECRET'], config, registry, {});

    expect(result['MY_SECRET']).toBe(secretValue); // identity, not a copy
    expect(registry.getProvider).toHaveBeenCalledWith('env');
    expect(env.resolve).toHaveBeenCalledWith('MY_REF', {});
  });

  it('falls back to secrets.defaultProvider when the mapping omits its own provider', async () => {
    const secretValue = new SecretValue('resolved-value');
    const env = fakeProvider('environment', async () => secretValue);
    const registry = fakeRegistry({ env });
    const config: GoodBoyConfig = {
      schema: '1.0.0',
      secrets: { defaultProvider: 'env', mappings: { MY_SECRET: { reference: 'MY_REF' } } },
    };

    const result = await resolveSecrets(['MY_SECRET'], config, registry, {});

    expect(result['MY_SECRET']).toBe(secretValue);
    expect(registry.getProvider).toHaveBeenCalledWith('env');
  });

  it('fails, naming the secret, when the mapping has no provider and no defaultProvider is configured', async () => {
    const registry = fakeRegistry({});
    const config: GoodBoyConfig = {
      schema: '1.0.0',
      secrets: { mappings: { MY_SECRET: { reference: 'MY_REF' } } },
    };

    let caught: GoodBoyError | undefined;
    try {
      await resolveSecrets(['MY_SECRET'], config, registry, {});
    } catch (err) {
      caught = err as GoodBoyError;
    }

    expect(caught?.code).toBe('E_SECRETS_RESOLUTION_FAILED');
    expect(caught?.message).toContain('MY_SECRET');
    expect(failuresOf(caught)[0]?.name).toBe('MY_SECRET');
    expect((failuresOf(caught)[0]?.cause as GoodBoyError).code).toBe('E_SECRET_NO_PROVIDER');
  });

  it('fails, naming the secret, when it has no mapping at all', async () => {
    const registry = fakeRegistry({});
    const config: GoodBoyConfig = { schema: '1.0.0' };

    let caught: GoodBoyError | undefined;
    try {
      await resolveSecrets(['MISSING_SECRET'], config, registry, {});
    } catch (err) {
      caught = err as GoodBoyError;
    }

    expect(caught?.code).toBe('E_SECRETS_RESOLUTION_FAILED');
    expect(caught?.message).toContain('MISSING_SECRET');
    expect((failuresOf(caught)[0]?.cause as GoodBoyError).code).toBe('E_SECRET_MAPPING_NOT_CONFIGURED');
  });

  it('wraps a "provider instance not configured" registry error, preserving it as cause', async () => {
    const registry = fakeRegistry({});
    const config: GoodBoyConfig = {
      schema: '1.0.0',
      secrets: { mappings: { MY_SECRET: { provider: 'missing-provider', reference: 'MY_REF' } } },
    };

    let caught: GoodBoyError | undefined;
    try {
      await resolveSecrets(['MY_SECRET'], config, registry, {});
    } catch (err) {
      caught = err as GoodBoyError;
    }

    const perNameError = failuresOf(caught)[0]?.cause as GoodBoyError;
    expect(perNameError.code).toBe('E_SECRET_PROVIDER_UNAVAILABLE');
    expect((perNameError.cause as GoodBoyError).code).toBe('E_PROVIDER_INSTANCE_NOT_CONFIGURED');
  });

  it("wraps a provider resolve() rejection, preserving it as the per-name error's cause", async () => {
    const failingErr = new Error('op read failed');
    const env = fakeProvider('environment', async () => {
      throw failingErr;
    });
    const registry = fakeRegistry({ env });
    const config: GoodBoyConfig = {
      schema: '1.0.0',
      secrets: { mappings: { MY_SECRET: { provider: 'env', reference: 'MY_REF' } } },
    };

    let caught: GoodBoyError | undefined;
    try {
      await resolveSecrets(['MY_SECRET'], config, registry, {});
    } catch (err) {
      caught = err as GoodBoyError;
    }

    const perNameError = failuresOf(caught)[0]?.cause as GoodBoyError;
    expect(perNameError.code).toBe('E_SECRET_RESOLUTION_FAILED');
    expect(perNameError.cause).toBe(failingErr);
  });

  it('reports multiple failures in input order, deterministically, regardless of which settles first', async () => {
    // FIRST_SECRET's provider is deliberately SLOWER than SECOND_SECRET's, so
    // if ordering were settlement-order rather than input-order, the report
    // would come back reversed.
    const slowFailing = fakeProvider('slow', async () => {
      await delay(50);
      throw new Error('slow failure');
    });
    const fastFailing = fakeProvider('fast', async () => {
      throw new Error('fast failure');
    });
    const registry = fakeRegistry({ slow: slowFailing, fast: fastFailing });
    const config: GoodBoyConfig = {
      schema: '1.0.0',
      secrets: {
        mappings: {
          FIRST_SECRET: { provider: 'slow', reference: 'ref-1' },
          SECOND_SECRET: { provider: 'fast', reference: 'ref-2' },
        },
      },
    };

    let caught: GoodBoyError | undefined;
    try {
      await resolveSecrets(['FIRST_SECRET', 'SECOND_SECRET'], config, registry, {});
    } catch (err) {
      caught = err as GoodBoyError;
    }

    expect(caught?.message).toBe('Failed to resolve secret(s): FIRST_SECRET, SECOND_SECRET.');
    expect(failuresOf(caught).map((f) => f.name)).toEqual(['FIRST_SECRET', 'SECOND_SECRET']);
  });

  it('never returns a partial result: a single failure among several requested names still rejects the whole call', async () => {
    const secretValue = new SecretValue('ok-value');
    const ok = fakeProvider('ok', async () => secretValue);
    const registry = fakeRegistry({ ok });
    const config: GoodBoyConfig = {
      schema: '1.0.0',
      secrets: {
        mappings: {
          GOOD_SECRET: { provider: 'ok', reference: 'ref-ok' },
          // BAD_SECRET has no mapping at all.
        },
      },
    };

    await expect(resolveSecrets(['GOOD_SECRET', 'BAD_SECRET'], config, registry, {})).rejects.toMatchObject({
      code: 'E_SECRETS_RESOLUTION_FAILED',
    });
  });

  it('touches only the registry instance actually needed for the requested name (invariant 6)', async () => {
    const secretValue = new SecretValue('v');
    const providerA = fakeProvider('a', async () => secretValue);
    const providerB = fakeProvider('b', async () => secretValue);
    const providerC = fakeProvider('c', async () => secretValue);
    const registry = fakeRegistry({ a: providerA, b: providerB, c: providerC });
    const config: GoodBoyConfig = {
      schema: '1.0.0',
      secrets: {
        providers: {
          a: { type: 'environment' },
          b: { type: 'environment' },
          c: { type: 'environment' },
        },
        mappings: {
          ONLY_THIS: { provider: 'a', reference: 'ref-a' },
          OTHER_1: { provider: 'b', reference: 'ref-b' },
          OTHER_2: { provider: 'c', reference: 'ref-c' },
        },
      },
    };

    await resolveSecrets(['ONLY_THIS'], config, registry, {});

    expect(registry.getProvider).toHaveBeenCalledTimes(1);
    expect(registry.getProvider).toHaveBeenCalledWith('a');
    expect(providerB.resolve).not.toHaveBeenCalled();
    expect(providerC.resolve).not.toHaveBeenCalled();
  });

  it('passes the resolution context (e.g. signal) through to the provider unchanged', async () => {
    const secretValue = new SecretValue('v');
    const env = fakeProvider('environment', async () => secretValue);
    const registry = fakeRegistry({ env });
    const config: GoodBoyConfig = {
      schema: '1.0.0',
      secrets: { mappings: { MY_SECRET: { provider: 'env', reference: 'MY_REF' } } },
    };
    const controller = new AbortController();

    await resolveSecrets(['MY_SECRET'], config, registry, { signal: controller.signal });

    expect(env.resolve).toHaveBeenCalledWith('MY_REF', { signal: controller.signal });
  });
});
