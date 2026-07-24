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
import { registerSecretsList } from './list.js';

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
  registerSecretsList(program);
  return program;
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

describe('goodboy secrets list', () => {
  it('shows a friendly message and never touches provider-registry code when no mappings are configured', async () => {
    mockMergeConfig.mockReturnValue({ schema: '1.0.0' });

    await buildProgram().parseAsync(['list'], { from: 'user' });

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('No secrets configured'));
    expect(mockCreateProviderRegistry).not.toHaveBeenCalled();
  });

  it('never constructs a provider registry even when mappings ARE configured (call-count proof, not just inspection)', async () => {
    mockMergeConfig.mockReturnValue({
      schema: '1.0.0',
      secrets: {
        providers: { env: { type: 'environment' } },
        mappings: { MY_SECRET: { provider: 'env', reference: 'MY_REF' } },
      },
    });

    await buildProgram().parseAsync(['list'], { from: 'user' });

    expect(mockCreateProviderRegistry).not.toHaveBeenCalled();
  });

  it('shows an environment-resolved reference verbatim', async () => {
    mockMergeConfig.mockReturnValue({
      schema: '1.0.0',
      secrets: {
        providers: { env: { type: 'environment' } },
        mappings: { MY_SECRET: { provider: 'env', reference: 'MY_REF' } },
      },
    });

    await buildProgram().parseAsync(['list'], { from: 'user' });

    const output = tableOutput();
    expect(output).toContain('MY_SECRET');
    expect(output).toContain('env');
    expect(output).toContain('MY_REF');
  });

  it('masks a onepassword-cli-resolved reference', async () => {
    mockMergeConfig.mockReturnValue({
      schema: '1.0.0',
      secrets: {
        providers: { vault: { type: 'onepassword-cli' } },
        mappings: { MY_SECRET: { provider: 'vault', reference: 'op://dev-vault/Exoscale/api-key' } },
      },
    });

    await buildProgram().parseAsync(['list'], { from: 'user' });

    const output = tableOutput();
    expect(output).not.toContain('dev-vault');
    expect(output).not.toContain('Exoscale');
    expect(output).not.toContain('api-key');
    expect(output).toContain('op://');
  });

  it('shows a "no provider" marker, not a crash, when neither a per-mapping provider nor defaultProvider is set', async () => {
    mockMergeConfig.mockReturnValue({
      schema: '1.0.0',
      secrets: { mappings: { MY_SECRET: { reference: 'op://x/y/z' } } },
    });

    await buildProgram().parseAsync(['list'], { from: 'user' });

    expect(tableOutput()).toContain('no provider');
  });

  it('resolves via defaultProvider when the mapping omits its own provider', async () => {
    mockMergeConfig.mockReturnValue({
      schema: '1.0.0',
      secrets: {
        defaultProvider: 'env',
        providers: { env: { type: 'environment' } },
        mappings: { MY_SECRET: { reference: 'MY_REF' } },
      },
    });

    await buildProgram().parseAsync(['list'], { from: 'user' });

    const output = tableOutput();
    expect(output).toContain('env');
    expect(output).toContain('MY_REF');
  });

  it('masks conservatively when the resolved provider name is not actually configured in secrets.providers', async () => {
    mockMergeConfig.mockReturnValue({
      schema: '1.0.0',
      secrets: {
        mappings: {
          MY_SECRET: { provider: 'ghost-provider', reference: 'op://dev-vault/Exoscale/api-key' },
        },
      },
    });

    await buildProgram().parseAsync(['list'], { from: 'user' });

    const output = tableOutput();
    expect(output).not.toContain('dev-vault');
    expect(output).not.toContain('Exoscale');
    expect(output).not.toContain('api-key');
  });

  it('renders multiple mappings with mixed provider types, each masked/shown according to its own type', async () => {
    mockMergeConfig.mockReturnValue({
      schema: '1.0.0',
      secrets: {
        providers: {
          env: { type: 'environment' },
          vault: { type: 'onepassword-cli' },
        },
        mappings: {
          ENV_SECRET: { provider: 'env', reference: 'ENV_REF' },
          VAULT_SECRET: { provider: 'vault', reference: 'op://a/b/c' },
        },
      },
    });

    await buildProgram().parseAsync(['list'], { from: 'user' });

    const output = tableOutput();
    expect(output).toContain('ENV_REF');
    expect(output).not.toContain('/a/b/c');
  });

  it('reports an unexpected failure via logger.error and exits non-zero', async () => {
    mockLoadUserConfig.mockRejectedValue(new Error('config file is corrupt'));

    await buildProgram().parseAsync(['list'], { from: 'user' }).catch(() => {});

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('config file is corrupt'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
