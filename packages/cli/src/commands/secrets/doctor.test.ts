import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('../../secrets/config.js', () => ({
  loadUserConfig: vi.fn(),
  loadProjectConfig: vi.fn(),
  mergeConfig: vi.fn(),
}));
vi.mock('../../secrets/provider-registry.js', () => ({
  createProviderRegistry: vi.fn(),
}));
vi.mock('../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
  sanitiseError: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

import { loadUserConfig, loadProjectConfig, mergeConfig } from '../../secrets/config.js';
import { createProviderRegistry } from '../../secrets/provider-registry.js';
import { logger } from '../../lib/logger.js';
import { registerSecretsDoctor } from './doctor.js';
import type { ProviderRegistry } from '../../secrets/provider-registry.js';
import type { SecretProvider } from '../../secrets/types.js';

const mockLoadUserConfig = vi.mocked(loadUserConfig);
const mockLoadProjectConfig = vi.mocked(loadProjectConfig);
const mockMergeConfig = vi.mocked(mergeConfig);
const mockCreateProviderRegistry = vi.mocked(createProviderRegistry);
const mockLogger = vi.mocked(logger);

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

function buildProgram(): Command {
  const program = new Command();
  registerSecretsDoctor(program);
  return program;
}

function fakeProvider(id: string, status: { available: boolean; detail?: string }): SecretProvider {
  return {
    id,
    checkAvailability: vi.fn().mockResolvedValue(status),
    resolve: vi.fn(),
  };
}

let stdoutChunks: string[];
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadUserConfig.mockResolvedValue(null);
  mockLoadProjectConfig.mockResolvedValue(null);
  stdoutChunks = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdoutChunks.push(String(chunk));
    return true;
  });
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('process.exit called');
  });
});

function tableOutput(): string {
  return stripAnsi(stdoutChunks.join(''));
}

describe('goodboy secrets doctor', () => {
  it('shows a friendly message and never constructs a provider registry when no providers are configured', async () => {
    mockMergeConfig.mockReturnValue({ schema: '1.0.0' });

    await buildProgram().parseAsync(['doctor'], { from: 'user' });

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('No secret providers configured'));
    expect(mockCreateProviderRegistry).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('shows the "no providers" message even when mappings ARE configured (doctor ignores mappings)', async () => {
    mockMergeConfig.mockReturnValue({
      schema: '1.0.0',
      secrets: { mappings: { MY_SECRET: { reference: 'x' } } },
    });

    await buildProgram().parseAsync(['doctor'], { from: 'user' });

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('No secret providers configured'));
    expect(mockCreateProviderRegistry).not.toHaveBeenCalled();
  });

  it('shows an available provider as available', async () => {
    mockMergeConfig.mockReturnValue({
      schema: '1.0.0',
      secrets: { providers: { env: { type: 'environment' } } },
    });
    const registry: ProviderRegistry = {
      getProvider: vi.fn().mockReturnValue(fakeProvider('environment', { available: true })),
    };
    mockCreateProviderRegistry.mockReturnValue(registry);

    await buildProgram().parseAsync(['doctor'], { from: 'user' });

    const output = tableOutput();
    expect(output).toContain('env');
    expect(output).toContain('yes');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('shows an unavailable provider with its detail, and still exits 0 (informational, not fail-closed like verify.ts)', async () => {
    mockMergeConfig.mockReturnValue({
      schema: '1.0.0',
      secrets: { providers: { vault: { type: 'onepassword-cli' } } },
    });
    const registry: ProviderRegistry = {
      getProvider: vi
        .fn()
        .mockReturnValue(fakeProvider('onepassword-cli', { available: false, detail: 'not authenticated' })),
    };
    mockCreateProviderRegistry.mockReturnValue(registry);

    await buildProgram().parseAsync(['doctor'], { from: 'user' });

    const output = tableOutput();
    expect(output).toContain('vault');
    expect(output).toContain('no');
    expect(output).toContain('not authenticated');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('reports multiple providers with mixed availability, independently', async () => {
    mockMergeConfig.mockReturnValue({
      schema: '1.0.0',
      secrets: {
        providers: {
          env: { type: 'environment' },
          vault: { type: 'onepassword-cli' },
        },
      },
    });
    const okProvider = fakeProvider('environment', { available: true });
    const badProvider = fakeProvider('onepassword-cli', { available: false, detail: 'op CLI not found' });
    const registry: ProviderRegistry = {
      getProvider: vi.fn((name: string) => (name === 'env' ? okProvider : badProvider)),
    };
    mockCreateProviderRegistry.mockReturnValue(registry);

    await buildProgram().parseAsync(['doctor'], { from: 'user' });

    const output = tableOutput();
    expect(output).toContain('env');
    expect(output).toContain('vault');
    expect(output).toContain('op CLI not found');
  });

  it('reports an unexpected failure via logger.error and exits non-zero', async () => {
    mockLoadUserConfig.mockRejectedValue(new Error('config file is corrupt'));

    await buildProgram().parseAsync(['doctor'], { from: 'user' }).catch(() => {});

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('config file is corrupt'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
