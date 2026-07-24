import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOnePasswordCliProvider } from './onepassword-cli.js';
import { GoodBoyError } from '../../lib/errors.js';
import { logger, sanitiseError } from '../../lib/logger.js';
import { REDACTED_MARKER, clearRegisteredSecrets } from '../../lib/redact.js';
import type { SecretProviderConfigOnePasswordCli } from '../config.js';

const FIXTURE = fileURLToPath(new URL('./__fixtures__/fake-op.mjs', import.meta.url));
const NONEXISTENT_BINARY = '/definitely/not/a/real/op/binary/xyz';

let logDir: string;
let logPath: string;

beforeEach(() => {
  logDir = mkdtempSync(join(tmpdir(), 'fake-op-argv-'));
  logPath = join(logDir, 'argv.json');
  process.env['FAKE_OP_ARGV_LOG'] = logPath;
});

afterEach(() => {
  delete process.env['FAKE_OP_ARGV_LOG'];
  rmSync(logDir, { recursive: true, force: true });
  clearRegisteredSecrets();
});

function loggedArgv(): string[] {
  return JSON.parse(readFileSync(logPath, 'utf-8')) as string[];
}

function baseConfig(
  overrides: Partial<SecretProviderConfigOnePasswordCli> = {},
): SecretProviderConfigOnePasswordCli {
  return { type: 'onepassword-cli', ...overrides };
}

describe('onepassword-cli provider — checkAvailability()', () => {
  it('resolves { available: true } when op whoami succeeds', async () => {
    const provider = createOnePasswordCliProvider(baseConfig(), FIXTURE);
    await expect(provider.checkAvailability({})).resolves.toEqual({ available: true });
    expect(loggedArgv()).toEqual(['whoami']);
  });

  it('includes --account in the invoked argv when config.account is set', async () => {
    const provider = createOnePasswordCliProvider(baseConfig({ account: 'team.1password.com' }), FIXTURE);
    await provider.checkAvailability({});
    expect(loggedArgv()).toEqual(['whoami', '--account', 'team.1password.com']);
  });

  it('omits --account entirely when config.account is not set', async () => {
    const provider = createOnePasswordCliProvider(baseConfig(), FIXTURE);
    await provider.checkAvailability({});
    expect(loggedArgv()).not.toContain('--account');
  });

  it('resolves { available: false, detail: "not authenticated" } when op whoami fails', async () => {
    const provider = createOnePasswordCliProvider(baseConfig({ account: 'unauthenticated-account' }), FIXTURE);
    await expect(provider.checkAvailability({})).resolves.toEqual({
      available: false,
      detail: 'not authenticated',
    });
  });

  it('resolves { available: false, detail: "op CLI not found" } instead of throwing when op is not on PATH', async () => {
    const provider = createOnePasswordCliProvider(baseConfig(), NONEXISTENT_BINARY);
    await expect(provider.checkAvailability({})).resolves.toEqual({
      available: false,
      detail: 'op CLI not found',
    });
  });
});

describe('onepassword-cli provider — resolve()', () => {
  it('rejects a reference missing the op:// prefix before invoking op at all', async () => {
    const provider = createOnePasswordCliProvider(baseConfig(), FIXTURE);

    await expect(provider.resolve('not-a-valid-reference', {})).rejects.toBeInstanceOf(GoodBoyError);
    await expect(provider.resolve('not-a-valid-reference', {})).rejects.toMatchObject({
      code: 'E_SECRET_REFERENCE_INVALID',
    });
    expect(existsSync(logPath)).toBe(false);
  });

  it('rejects a reference that is exactly "op://" with an empty remainder, before invoking op at all', async () => {
    const provider = createOnePasswordCliProvider(baseConfig(), FIXTURE);

    await expect(provider.resolve('op://', {})).rejects.toMatchObject({ code: 'E_SECRET_REFERENCE_INVALID' });
    expect(existsSync(logPath)).toBe(false);
  });

  it('resolves a valid reference to a SecretValue wrapping the exact stdout, including a reference containing a legal space', async () => {
    const reference = 'op://dev/aws/Access Keys/access_key_id';
    const provider = createOnePasswordCliProvider(baseConfig(), FIXTURE);

    const secret = await provider.resolve(reference, {});
    expect(secret.reveal()).toBe(reference);
    expect(loggedArgv()).toEqual(['read', reference, '--no-newline']);
  });

  it('includes --account in the invoked argv when config.account is set', async () => {
    const reference = 'op://vault/item/field';
    const provider = createOnePasswordCliProvider(baseConfig({ account: 'team.1password.com' }), FIXTURE);

    await provider.resolve(reference, {});
    expect(loggedArgv()).toEqual(['read', reference, '--no-newline', '--account', 'team.1password.com']);
  });

  it('throws GoodBoyError on a non-zero exit; message excludes raw stderr, safeMetadata carries it', async () => {
    const reference = 'op://fail/item';
    const provider = createOnePasswordCliProvider(baseConfig(), FIXTURE);

    let caught: GoodBoyError | undefined;
    try {
      await provider.resolve(reference, {});
    } catch (err) {
      caught = err as GoodBoyError;
    }

    expect(caught).toBeInstanceOf(GoodBoyError);
    expect(caught?.code).toBe('E_SECRET_RESOLVE_FAILED');
    expect(caught?.message).not.toContain('no such item');
    expect(caught?.safeMetadata['stderr']).toContain('no such item');
  });

  it('surfaces a timeout as a clear failure, not a hang', async () => {
    const reference = 'op://slow/item';
    const provider = createOnePasswordCliProvider(baseConfig({ timeoutMs: 100 }), FIXTURE);

    let caught: GoodBoyError | undefined;
    try {
      await provider.resolve(reference, {});
    } catch (err) {
      caught = err as GoodBoyError;
    }

    expect(caught).toBeInstanceOf(GoodBoyError);
    expect(caught?.code).toBe('E_SECRET_RESOLVE_FAILED');
    expect(caught?.safeMetadata['timedOut']).toBe(true);
  }, 10000);

  it('throws GoodBoyError when op is not on PATH at all (genuine invocation failure), with cause set', async () => {
    const provider = createOnePasswordCliProvider(baseConfig(), NONEXISTENT_BINARY);

    let caught: GoodBoyError | undefined;
    try {
      await provider.resolve('op://vault/item/field', {});
    } catch (err) {
      caught = err as GoodBoyError;
    }

    expect(caught).toBeInstanceOf(GoodBoyError);
    expect(caught?.code).toBe('E_SECRET_RESOLVE_FAILED');
    expect(caught?.cause).toBeDefined();
  });

  it('sentinel proof: a resolved value is registered with the redactor and scrubbed from logger/sanitiseError output', async () => {
    const SENTINEL_REF = 'op://fixture/GOODBOY_SECURITY_SENTINEL_SECRET_OP_TEST';
    const provider = createOnePasswordCliProvider(baseConfig(), FIXTURE);

    const secret = await provider.resolve(SENTINEL_REF, {});
    expect(secret.reveal()).toBe(SENTINEL_REF); // sanity: fixture really echoed it back

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logger.info(`leaking ${SENTINEL_REF} here`);
    const output = String(stdoutSpy.mock.calls[0]?.[0]);
    stdoutSpy.mockRestore();

    expect(output).not.toContain(SENTINEL_REF);
    expect(output).toContain(REDACTED_MARKER);
    expect(sanitiseError(new Error(`failed: ${SENTINEL_REF}`))).not.toContain(SENTINEL_REF);
  });
});
