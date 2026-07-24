import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

vi.mock('../../secrets/config.js', () => ({
  loadUserConfig: vi.fn(),
  loadProjectConfig: vi.fn(),
  mergeConfig: vi.fn(),
}));
vi.mock('../../secrets/provider-registry.js', () => ({
  createProviderRegistry: vi.fn(),
}));
vi.mock('../../secrets/resolver.js', () => ({
  resolveSecrets: vi.fn(),
}));
vi.mock('../../secrets/from-skill.js', () => ({
  resolveInstalledSkillSecrets: vi.fn(),
}));
vi.mock('../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
  sanitiseError: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

import { loadUserConfig, loadProjectConfig, mergeConfig } from '../../secrets/config.js';
import { createProviderRegistry } from '../../secrets/provider-registry.js';
import { resolveSecrets } from '../../secrets/resolver.js';
import { resolveInstalledSkillSecrets } from '../../secrets/from-skill.js';
import { logger } from '../../lib/logger.js';
import { GoodBoyError } from '../../lib/errors.js';
import { registerSecretsValidate } from './validate.js';

const mockLoadUserConfig = vi.mocked(loadUserConfig);
const mockLoadProjectConfig = vi.mocked(loadProjectConfig);
const mockMergeConfig = vi.mocked(mergeConfig);
const mockCreateProviderRegistry = vi.mocked(createProviderRegistry);
const mockResolveSecrets = vi.mocked(resolveSecrets);
const mockResolveInstalledSkillSecrets = vi.mocked(resolveInstalledSkillSecrets);
const mockLogger = vi.mocked(logger);

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

function buildProgram(): Command {
  const program = new Command();
  registerSecretsValidate(program);
  return program;
}

let stdoutChunks: string[];
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = undefined;
  mockLoadUserConfig.mockResolvedValue(null);
  mockLoadProjectConfig.mockResolvedValue(null);
  mockCreateProviderRegistry.mockReturnValue({ getProvider: vi.fn() });
  stdoutChunks = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdoutChunks.push(String(chunk));
    return true;
  });
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('process.exit called');
  });
});

afterEach(() => {
  process.exitCode = undefined;
});

function tableOutput(): string {
  return stripAnsi(stdoutChunks.join(''));
}

describe('goodboy secrets validate', () => {
  it('exits 0 when all configured mappings are structurally valid', async () => {
    mockMergeConfig.mockReturnValue({
      schema: '1.0.0',
      secrets: {
        providers: { env: { type: 'environment' } },
        mappings: { MY_SECRET: { provider: 'env', reference: 'MY_REF' } },
      },
    });

    await buildProgram().parseAsync(['validate'], { from: 'user' });

    expect(tableOutput()).toContain('ok');
    expect(process.exitCode).toBeUndefined();
  });

  it('reports each structural problem with its reason, exits non-zero, and never touches provider/resolver code', async () => {
    mockMergeConfig.mockReturnValue({
      schema: '1.0.0',
      secrets: {
        mappings: {
          NO_PROVIDER: { reference: 'x' },
          BAD_PROVIDER: { provider: 'ghost', reference: 'y' },
        },
      },
    });

    await buildProgram().parseAsync(['validate'], { from: 'user' });

    const output = tableOutput();
    expect(output).toContain('NO_PROVIDER');
    expect(output).toContain('no provider set');
    expect(output).toContain('BAD_PROVIDER');
    expect(output).toContain('provider "ghost" is not configured');
    expect(process.exitCode).toBe(1);
    expect(mockCreateProviderRegistry).not.toHaveBeenCalled();
    expect(mockResolveSecrets).not.toHaveBeenCalled();
  });

  it('shows an informational message and exits 0 when nothing is configured to validate', async () => {
    mockMergeConfig.mockReturnValue({ schema: '1.0.0' });

    await buildProgram().parseAsync(['validate'], { from: 'user' });

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Nothing configured to validate'));
    expect(process.exitCode).toBeUndefined();
  });

  it("--skill: only the skill's declared names appear, even when other unrelated mappings are configured", async () => {
    mockMergeConfig.mockReturnValue({
      schema: '1.0.0',
      secrets: {
        providers: { env: { type: 'environment' } },
        mappings: {
          SKILL_SECRET: { provider: 'env', reference: 'ref-1' },
          UNRELATED_SECRET: { provider: 'env', reference: 'ref-2' },
        },
      },
    });
    mockResolveInstalledSkillSecrets.mockResolvedValue(['SKILL_SECRET']);

    await buildProgram().parseAsync(['validate', '--skill', 'demo-skill'], { from: 'user' });

    const output = tableOutput();
    expect(output).toContain('SKILL_SECRET');
    expect(output).not.toContain('UNRELATED_SECRET');
    expect(process.exitCode).toBeUndefined();
  });

  it('--skill: a declared secret with no mapping at all is reported as a failure, exit non-zero', async () => {
    mockMergeConfig.mockReturnValue({ schema: '1.0.0' });
    mockResolveInstalledSkillSecrets.mockResolvedValue(['UNMAPPED_SECRET']);

    await buildProgram().parseAsync(['validate', '--skill', 'demo-skill'], { from: 'user' });

    const output = tableOutput();
    expect(output).toContain('UNMAPPED_SECRET');
    expect(output).toContain('no mapping configured');
    expect(process.exitCode).toBe(1);
  });

  it('--skill for a skill that is not installed: clear error, exit 1', async () => {
    mockResolveInstalledSkillSecrets.mockRejectedValue(
      new GoodBoyError('Skill "ghost-skill" is not installed in this project.', {
        code: 'E_SKILL_NOT_INSTALLED',
        safeMetadata: { skillName: 'ghost-skill' },
      }),
    );

    await buildProgram()
      .parseAsync(['validate', '--skill', 'ghost-skill'], { from: 'user' })
      .catch(() => {});

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('is not installed'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('--skill in a directory with no goodboy.json: clear error, exit 1', async () => {
    mockResolveInstalledSkillSecrets.mockRejectedValue(
      new GoodBoyError('No goodboy.json found in "/project". Run `goodboy init` first.', {
        code: 'E_SKILL_PROJECT_NOT_FOUND',
        safeMetadata: { cwd: '/project' },
      }),
    );

    await buildProgram()
      .parseAsync(['validate', '--skill', 'demo-skill'], { from: 'user' })
      .catch(() => {});

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('goodboy init'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('--skill for a skill declaring zero secrets: informational message, exit 0', async () => {
    mockMergeConfig.mockReturnValue({ schema: '1.0.0' });
    mockResolveInstalledSkillSecrets.mockResolvedValue([]);

    await buildProgram().parseAsync(['validate', '--skill', 'demo-skill'], { from: 'user' });

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('declares no secrets'));
    expect(process.exitCode).toBeUndefined();
  });

  it('--resolve: all structurally-valid names actually resolve, exit 0, no resolved value ever appears in the output', async () => {
    mockMergeConfig.mockReturnValue({
      schema: '1.0.0',
      secrets: {
        providers: { env: { type: 'environment' } },
        mappings: { MY_SECRET: { provider: 'env', reference: 'MY_REF' } },
      },
    });
    mockResolveSecrets.mockResolvedValue({});

    await buildProgram().parseAsync(['validate', '--resolve'], { from: 'user' });

    const output = tableOutput();
    expect(output).toContain('resolved');
    expect(process.exitCode).toBeUndefined();
    expect(mockResolveSecrets).toHaveBeenCalledWith(['MY_SECRET'], expect.anything(), expect.anything(), {});
  });

  it('--resolve: one name fails to resolve, reported with its reason, others reported resolved, exit non-zero', async () => {
    mockMergeConfig.mockReturnValue({
      schema: '1.0.0',
      secrets: {
        providers: { env: { type: 'environment' } },
        mappings: {
          GOOD_SECRET: { provider: 'env', reference: 'ref-good' },
          BAD_SECRET: { provider: 'env', reference: 'ref-bad' },
        },
      },
    });
    mockResolveSecrets.mockRejectedValue(
      new GoodBoyError('Failed to resolve secret(s): BAD_SECRET.', {
        code: 'E_SECRETS_RESOLUTION_FAILED',
        safeMetadata: {
          failures: [{ name: 'BAD_SECRET', cause: new Error('op read failed') }],
        },
      }),
    );

    await buildProgram().parseAsync(['validate', '--resolve'], { from: 'user' });

    const output = tableOutput();
    expect(output).toContain('GOOD_SECRET');
    expect(output).toContain('resolved');
    expect(output).toContain('BAD_SECRET');
    expect(output).toContain('resolve failed');
    expect(output).toContain('op read failed');
    expect(process.exitCode).toBe(1);
  });

  it('--resolve combined with a structural failure: the bad name is never passed into resolveSecrets, reported as structural not resolution failure', async () => {
    mockMergeConfig.mockReturnValue({
      schema: '1.0.0',
      secrets: {
        providers: { env: { type: 'environment' } },
        mappings: {
          GOOD_SECRET: { provider: 'env', reference: 'ref-good' },
          NO_PROVIDER_SECRET: { reference: 'ref-bad' },
        },
      },
    });
    mockResolveSecrets.mockResolvedValue({});

    await buildProgram().parseAsync(['validate', '--resolve'], { from: 'user' });

    expect(mockResolveSecrets).toHaveBeenCalledWith(['GOOD_SECRET'], expect.anything(), expect.anything(), {});
    const output = tableOutput();
    expect(output).toContain('NO_PROVIDER_SECRET');
    expect(output).toContain('no provider set');
    expect(output).not.toContain('resolve failed');
    expect(process.exitCode).toBe(1); // still non-zero, due to the structural failure
  });

  it('--resolve: a structural failure and a resolve failure coexist, each reported with its own reason', async () => {
    mockMergeConfig.mockReturnValue({
      schema: '1.0.0',
      secrets: {
        providers: { env: { type: 'environment' } },
        mappings: {
          GOOD_SECRET: { provider: 'env', reference: 'ref-good' },
          BAD_RESOLVE_SECRET: { provider: 'env', reference: 'ref-bad' },
          NO_PROVIDER_SECRET: { reference: 'ref-none' },
        },
      },
    });
    mockResolveSecrets.mockRejectedValue(
      new GoodBoyError('Failed to resolve secret(s): BAD_RESOLVE_SECRET.', {
        code: 'E_SECRETS_RESOLUTION_FAILED',
        safeMetadata: {
          failures: [{ name: 'BAD_RESOLVE_SECRET', cause: new Error('op read failed') }],
        },
      }),
    );

    await buildProgram().parseAsync(['validate', '--resolve'], { from: 'user' });

    expect(mockResolveSecrets).toHaveBeenCalledWith(
      ['GOOD_SECRET', 'BAD_RESOLVE_SECRET'],
      expect.anything(),
      expect.anything(),
      {},
    );
    const output = tableOutput();
    expect(output).toContain('GOOD_SECRET');
    expect(output).toContain('resolved');
    expect(output).toContain('BAD_RESOLVE_SECRET');
    expect(output).toContain('resolve failed');
    expect(output).toContain('NO_PROVIDER_SECRET');
    expect(output).toContain('no provider set');
    expect(process.exitCode).toBe(1);
  });

  it('--resolve: a rejection whose failure cause is not an Error instance is still described without crashing', async () => {
    mockMergeConfig.mockReturnValue({
      schema: '1.0.0',
      secrets: {
        providers: { env: { type: 'environment' } },
        mappings: { BAD_SECRET: { provider: 'env', reference: 'ref-bad' } },
      },
    });
    mockResolveSecrets.mockRejectedValue(
      new GoodBoyError('Failed to resolve secret(s): BAD_SECRET.', {
        code: 'E_SECRETS_RESOLUTION_FAILED',
        safeMetadata: { failures: [{ name: 'BAD_SECRET', cause: 'a plain string cause' }] },
      }),
    );

    await buildProgram().parseAsync(['validate', '--resolve'], { from: 'user' });

    expect(tableOutput()).toContain('a plain string cause');
    expect(process.exitCode).toBe(1);
  });

  it('--resolve when nothing is structurally valid: resolveSecrets and createProviderRegistry are never called at all', async () => {
    mockMergeConfig.mockReturnValue({
      schema: '1.0.0',
      secrets: { mappings: { BAD_SECRET: { reference: 'x' } } },
    });

    await buildProgram().parseAsync(['validate', '--resolve'], { from: 'user' });

    expect(mockCreateProviderRegistry).not.toHaveBeenCalled();
    expect(mockResolveSecrets).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('without --resolve, resolveSecrets is never invoked (call-count proof)', async () => {
    mockMergeConfig.mockReturnValue({
      schema: '1.0.0',
      secrets: {
        providers: { env: { type: 'environment' } },
        mappings: { MY_SECRET: { provider: 'env', reference: 'MY_REF' } },
      },
    });

    await buildProgram().parseAsync(['validate'], { from: 'user' });

    expect(mockResolveSecrets).not.toHaveBeenCalled();
  });

  it('reports an unexpected failure via logger.error and exits non-zero', async () => {
    mockLoadUserConfig.mockRejectedValue(new Error('config file is corrupt'));

    await buildProgram().parseAsync(['validate'], { from: 'user' }).catch(() => {});

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('config file is corrupt'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
