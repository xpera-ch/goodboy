import { describe, it, expect, afterEach } from 'vitest';
import { createEnvironmentProvider } from './environment.js';
import { GoodBoyError } from '../../lib/errors.js';

const TEST_VAR = 'GOODBOY_TEST_ENV_PROVIDER_VAR';
const UNRELATED_VAR = 'GOODBOY_TEST_UNRELATED_ENV_VAR';

afterEach(() => {
  delete process.env[TEST_VAR];
  delete process.env[UNRELATED_VAR];
});

describe('environment provider', () => {
  it('has id "environment"', () => {
    expect(createEnvironmentProvider().id).toBe('environment');
  });

  it('checkAvailability() always resolves { available: true }', async () => {
    const provider = createEnvironmentProvider();
    await expect(provider.checkAvailability({})).resolves.toEqual({ available: true });
  });

  it('resolve() returns a SecretValue wrapping the exact env var value, with no trimming', async () => {
    process.env[TEST_VAR] = '  spaced value with trailing newline\n';
    const provider = createEnvironmentProvider();
    const secret = await provider.resolve(TEST_VAR, {});
    expect(secret.reveal()).toBe('  spaced value with trailing newline\n');
  });

  it('resolve() throws a GoodBoyError naming the missing variable when unset', async () => {
    delete process.env[TEST_VAR];
    const provider = createEnvironmentProvider();

    await expect(provider.resolve(TEST_VAR, {})).rejects.toBeInstanceOf(GoodBoyError);
    await expect(provider.resolve(TEST_VAR, {})).rejects.toThrow(TEST_VAR);
  });

  it('the "not set" error carries the E_SECRET_ENV_VAR_NOT_SET code', async () => {
    delete process.env[TEST_VAR];
    const provider = createEnvironmentProvider();

    try {
      await provider.resolve(TEST_VAR, {});
      throw new Error('expected resolve() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GoodBoyError);
      expect((err as GoodBoyError).code).toBe('E_SECRET_ENV_VAR_NOT_SET');
    }
  });

  it('never dumps process.env wholesale: an unrelated variable never appears in the error message', async () => {
    process.env[UNRELATED_VAR] = 'unrelated-value-should-never-appear';
    delete process.env[TEST_VAR];
    const provider = createEnvironmentProvider();

    try {
      await provider.resolve(TEST_VAR, {});
      throw new Error('expected resolve() to throw');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain('unrelated-value-should-never-appear');
      expect(message).not.toContain(UNRELATED_VAR);
    }
  });
});
