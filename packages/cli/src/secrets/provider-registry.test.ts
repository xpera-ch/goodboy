import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./providers/environment.js', () => ({
  createEnvironmentProvider: vi.fn(),
}));
vi.mock('./providers/onepassword-cli.js', () => ({
  createOnePasswordCliProvider: vi.fn(),
}));

import { createEnvironmentProvider } from './providers/environment.js';
import { createOnePasswordCliProvider } from './providers/onepassword-cli.js';
import { createProviderRegistry } from './provider-registry.js';
import { GoodBoyError } from '../lib/errors.js';
import type { SecretProviderConfig } from './config.js';
import type { SecretProvider } from './types.js';

const mockCreateEnvironmentProvider = vi.mocked(createEnvironmentProvider);
const mockCreateOnePasswordCliProvider = vi.mocked(createOnePasswordCliProvider);

function fakeProvider(id: string): SecretProvider {
  return {
    id,
    checkAvailability: vi.fn(),
    resolve: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createProviderRegistry()', () => {
  it('getProvider() returns a working provider for a configured environment instance', () => {
    const fake = fakeProvider('environment');
    mockCreateEnvironmentProvider.mockReturnValue(fake);

    const registry = createProviderRegistry({ env: { type: 'environment' } });
    expect(registry.getProvider('env')).toBe(fake);
  });

  it('does not construct any provider until getProvider() is actually called (lazy initialization)', () => {
    mockCreateEnvironmentProvider.mockReturnValue(fakeProvider('environment'));

    createProviderRegistry({
      env: { type: 'environment' },
      other: { type: 'environment' },
    });

    expect(mockCreateEnvironmentProvider).not.toHaveBeenCalled();
  });

  it('constructs the factory exactly once even across repeated getProvider() calls for the same name (cached)', () => {
    mockCreateEnvironmentProvider.mockReturnValue(fakeProvider('environment'));
    const registry = createProviderRegistry({ env: { type: 'environment' } });

    const first = registry.getProvider('env');
    const second = registry.getProvider('env');
    const third = registry.getProvider('env');

    expect(mockCreateEnvironmentProvider).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it('constructs a separate provider per distinct instance name, each still cached independently', () => {
    mockCreateEnvironmentProvider
      .mockReturnValueOnce(fakeProvider('a'))
      .mockReturnValueOnce(fakeProvider('b'));

    const registry = createProviderRegistry({
      a: { type: 'environment' },
      b: { type: 'environment' },
    });

    const a1 = registry.getProvider('a');
    const b1 = registry.getProvider('b');
    const a2 = registry.getProvider('a');

    expect(mockCreateEnvironmentProvider).toHaveBeenCalledTimes(2);
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b1);
  });

  it('throws a clear, specific error for an instance name that is not configured at all', () => {
    const registry = createProviderRegistry({});

    expect(() => registry.getProvider('nonexistent')).toThrow(/no provider instance named/i);
    try {
      registry.getProvider('nonexistent');
    } catch (err) {
      expect(err).toBeInstanceOf(GoodBoyError);
      expect((err as GoodBoyError).code).toBe('E_PROVIDER_INSTANCE_NOT_CONFIGURED');
    }
  });

  it('getProvider() returns a real, working provider for a configured onepassword-cli instance (S4c: no longer stubbed)', () => {
    const fake = fakeProvider('onepassword-cli');
    mockCreateOnePasswordCliProvider.mockReturnValue(fake);

    const registry = createProviderRegistry({ vault: { type: 'onepassword-cli', account: 'team.1password.com' } });
    expect(registry.getProvider('vault')).toBe(fake);
    expect(mockCreateOnePasswordCliProvider).toHaveBeenCalledWith({
      type: 'onepassword-cli',
      account: 'team.1password.com',
    });
    expect(mockCreateEnvironmentProvider).not.toHaveBeenCalled();
  });

  it('constructs the onepassword-cli factory exactly once across repeated getProvider() calls (cached, same as environment)', () => {
    mockCreateOnePasswordCliProvider.mockReturnValue(fakeProvider('onepassword-cli'));
    const registry = createProviderRegistry({ vault: { type: 'onepassword-cli' } });

    registry.getProvider('vault');
    registry.getProvider('vault');

    expect(mockCreateOnePasswordCliProvider).toHaveBeenCalledTimes(1);
  });

  it('fails closed for a genuinely unknown provider type bypassing the schema (defense in depth)', () => {
    const registry = createProviderRegistry({
      weird: { type: 'mystery-provider' } as unknown as SecretProviderConfig,
    });

    expect(() => registry.getProvider('weird')).toThrow(/unknown provider type/i);
    try {
      registry.getProvider('weird');
    } catch (err) {
      expect(err).toBeInstanceOf(GoodBoyError);
      expect((err as GoodBoyError).code).toBe('E_PROVIDER_UNKNOWN_TYPE');
    }
  });
});
