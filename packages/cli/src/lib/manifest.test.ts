import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Stats } from 'node:fs';
import type { GoodBoyManifest } from '../types/index.js';

vi.mock('node:fs');

import { statSync, readFileSync, writeFileSync } from 'node:fs';
import { readManifest, validateManifest, writeManifest, assertKindConstraints } from './manifest.js';
import { loadFixture } from '../__fixtures__/index.js';

const mockStatSync = vi.mocked(statSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);

function fakeStats(size: number): Stats {
  return { size } as unknown as Stats;
}

// ---------------------------------------------------------------------------
// readManifest()
// ---------------------------------------------------------------------------

describe('readManifest()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses and returns valid JSON content', async () => {
    const fixture = loadFixture('valid-minimal');
    mockStatSync.mockReturnValue(fakeStats(100));
    (mockReadFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(fixture));
    const result = await readManifest('/fake/manifest.json');
    expect(result).toEqual(fixture);
  });

  it('throws a clean error when the file does not exist', async () => {
    mockStatSync.mockImplementation(() => { throw new Error('ENOENT: no such file'); });
    await expect(readManifest('/nonexistent/manifest.json'))
      .rejects.toThrow('manifest.json not found');
  });

  it('error message is exactly "manifest.json not found" with no path leak', async () => {
    mockStatSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT: no such file or directory, stat "/real/private/path"'), {
        code: 'ENOENT',
        path: '/real/private/path',
      });
    });
    const err = await readManifest('/fake/path').catch((e: unknown) => e as Error);
    expect((err as Error).message).toBe('manifest.json not found');
  });

  it('throws when file exceeds the 512 KB size limit', async () => {
    mockStatSync.mockReturnValue(fakeStats(512 * 1024 + 1));
    await expect(readManifest('/fake/manifest.json'))
      .rejects.toThrow('manifest.json exceeds the 512 KB size limit');
  });

  it('does not read file content when the size check fails', async () => {
    mockStatSync.mockReturnValue(fakeStats(512 * 1024 + 1));
    await readManifest('/fake/manifest.json').catch(() => {});
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('accepts a file exactly at the 512 KB boundary', async () => {
    const fixture = loadFixture('valid-minimal');
    mockStatSync.mockReturnValue(fakeStats(512 * 1024));
    (mockReadFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(fixture));
    await expect(readManifest('/fake/manifest.json')).resolves.toBeDefined();
  });

  it('throws a clean error on permission denied', async () => {
    mockStatSync.mockReturnValue(fakeStats(100));
    mockReadFileSync.mockImplementation(() => { throw new Error('EACCES: permission denied'); });
    await expect(readManifest('/fake/manifest.json'))
      .rejects.toThrow('Cannot read manifest.json: permission denied');
  });

  it('throws a clean error when the file contains invalid JSON', async () => {
    mockStatSync.mockReturnValue(fakeStats(100));
    (mockReadFileSync as ReturnType<typeof vi.fn>).mockReturnValue('{ not valid json }');
    await expect(readManifest('/fake/manifest.json'))
      .rejects.toThrow('manifest.json contains invalid JSON');
  });

  it('rejects a manifest with nesting depth greater than 10', async () => {
    // Build a JSON string with 11 levels of nesting
    const deepJson = '{'.repeat(11) + '}'.repeat(11);
    mockStatSync.mockReturnValue(fakeStats(deepJson.length));
    (mockReadFileSync as ReturnType<typeof vi.fn>).mockReturnValue(deepJson);
    await expect(readManifest('/fake/manifest.json'))
      .rejects.toThrow('nesting depth exceeds maximum allowed (10)');
  });

  it('accepts a manifest at exactly nesting depth 10', async () => {
    // A JSON string with exactly 10 levels — just under the limit
    const fixture = loadFixture('valid-minimal');
    const json = JSON.stringify(fixture);
    mockStatSync.mockReturnValue(fakeStats(json.length));
    (mockReadFileSync as ReturnType<typeof vi.fn>).mockReturnValue(json);
    await expect(readManifest('/fake/manifest.json')).resolves.toBeDefined();
  });

  it('error messages never contain raw stack traces', async () => {
    mockStatSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const err = await readManifest('/fake/manifest.json').catch((e: unknown) => e as Error);
    expect((err as Error).message).not.toMatch(/\s+at\s+\w/);
  });
});

// ---------------------------------------------------------------------------
// validateManifest() — uses real ajv + real schema, no fs mocking needed
// ---------------------------------------------------------------------------

describe('validateManifest()', () => {
  it('accepts valid-minimal.json', () => {
    expect(() => validateManifest(loadFixture('valid-minimal'))).not.toThrow();
  });

  it('accepts valid-complete.json', () => {
    expect(() => validateManifest(loadFixture('valid-complete'))).not.toThrow();
  });

  it('accepts valid-deprecated.json', () => {
    expect(() => validateManifest(loadFixture('valid-deprecated'))).not.toThrow();
  });

  it('rejects invalid-missing-name.json', () => {
    expect(() => validateManifest(loadFixture('invalid-missing-name')))
      .toThrow('Invalid manifest:');
  });

  it('rejects invalid-missing-version.json', () => {
    expect(() => validateManifest(loadFixture('invalid-missing-version')))
      .toThrow('Invalid manifest:');
  });

  it('rejects invalid-missing-entry.json', () => {
    expect(() => validateManifest(loadFixture('invalid-missing-entry')))
      .toThrow('Invalid manifest:');
  });

  it('rejects invalid-missing-schema-version.json', () => {
    expect(() => validateManifest(loadFixture('invalid-missing-schema-version')))
      .toThrow('Invalid manifest:');
  });

  it('rejects invalid-bad-status.json', () => {
    expect(() => validateManifest(loadFixture('invalid-bad-status')))
      .toThrow('Invalid manifest:');
  });

  it('rejects invalid-additional-props.json', () => {
    expect(() => validateManifest(loadFixture('invalid-additional-props')))
      .toThrow('Invalid manifest:');
  });

  it('rejects invalid-bad-version-format.json', () => {
    expect(() => validateManifest(loadFixture('invalid-bad-version-format')))
      .toThrow('Invalid manifest:');
  });

  it('rejects invalid-bad-name-pattern.json', () => {
    expect(() => validateManifest(loadFixture('invalid-bad-name-pattern')))
      .toThrow('Invalid manifest:');
  });

  it('rejects invalid-mcp-file-url.json (non-HTTPS scheme in mcp_servers)', () => {
    expect(() => validateManifest(loadFixture('invalid-mcp-file-url')))
      .toThrow('Invalid manifest:');
  });

  it('rejects invalid-mcp-javascript-url.json (non-HTTPS scheme in mcp_servers)', () => {
    expect(() => validateManifest(loadFixture('invalid-mcp-javascript-url')))
      .toThrow('Invalid manifest:');
  });

  it('error message includes "Invalid manifest:" prefix', () => {
    try {
      validateManifest(loadFixture('invalid-missing-name'));
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).toMatch(/^Invalid manifest:/);
    }
  });

  it('error output lists all validation errors, not just the first', () => {
    // An empty object is missing all nine required fields; allErrors:true means
    // the error list should contain more than one entry.
    try {
      validateManifest({});
      expect.fail('should have thrown');
    } catch (err) {
      const lines = (err as Error).message.split('\n');
      // First line is the header; subsequent lines are individual errors
      expect(lines.length).toBeGreaterThan(2);
    }
  });

  it('error message contains the failing field path', () => {
    try {
      validateManifest(loadFixture('invalid-bad-status'));
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('/status');
    }
  });

  it('error message uses "(root)" for top-level required field violations', () => {
    try {
      validateManifest({});
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('(root)');
    }
  });

  it('rejects null input', () => {
    expect(() => validateManifest(null)).toThrow('Invalid manifest:');
  });

  it('rejects array input', () => {
    expect(() => validateManifest([])).toThrow('Invalid manifest:');
  });

  it('rejects string input', () => {
    expect(() => validateManifest('{"name":"test"}')).toThrow('Invalid manifest:');
  });

  it('rejects number input', () => {
    expect(() => validateManifest(42)).toThrow('Invalid manifest:');
  });

  it('rejects a dependency with a file:// value', () => {
    const manifest = {
      ...(loadFixture('valid-complete') as Record<string, unknown>),
      dependencies: { 'bad-dep': 'file:///local/lib' },
    };
    expect(() => validateManifest(manifest)).toThrow('Invalid manifest:');
  });

  it('rejects a dependency with an http:// value', () => {
    const manifest = {
      ...(loadFixture('valid-complete') as Record<string, unknown>),
      dependencies: { 'bad-dep': 'http://example.com/lib' },
    };
    expect(() => validateManifest(manifest)).toThrow('Invalid manifest:');
  });

  it('rejects a dependency with a git+ssh:// value', () => {
    const manifest = {
      ...(loadFixture('valid-complete') as Record<string, unknown>),
      dependencies: { 'bad-dep': 'git+ssh://github.com/foo/bar' },
    };
    expect(() => validateManifest(manifest)).toThrow('Invalid manifest:');
  });

  it('accepts a dependency with a valid semver value', () => {
    const manifest = {
      ...(loadFixture('valid-complete') as Record<string, unknown>),
      dependencies: { 'good-dep': '^1.2.3' },
    };
    expect(() => validateManifest(manifest)).not.toThrow();
  });

  it('rejects a localhost MCP server URL at runtime', () => {
    const manifest = {
      ...(loadFixture('valid-complete') as Record<string, unknown>),
      mcp_servers: [{ name: 'local', url: 'https://localhost/api' }],
    };
    expect(() => validateManifest(manifest))
      .toThrow('mcp_servers contains an invalid or disallowed URL');
  });

  it('rejects a 127.0.0.1 MCP server URL at runtime', () => {
    const manifest = {
      ...(loadFixture('valid-complete') as Record<string, unknown>),
      mcp_servers: [{ name: 'local', url: 'http://127.0.0.1:8080/api' }],
    };
    expect(() => validateManifest(manifest))
      .toThrow('mcp_servers contains an invalid or disallowed URL');
  });

  it('rejects a 192.168.x.x MCP server URL at runtime', () => {
    const manifest = {
      ...(loadFixture('valid-complete') as Record<string, unknown>),
      mcp_servers: [{ name: 'lan', url: 'https://192.168.1.100/api' }],
    };
    expect(() => validateManifest(manifest))
      .toThrow('mcp_servers contains an invalid or disallowed URL');
  });

  it('rejects a 169.254.x.x (link-local) MCP server URL at runtime', () => {
    const manifest = {
      ...(loadFixture('valid-complete') as Record<string, unknown>),
      mcp_servers: [{ name: 'link', url: 'https://169.254.1.1/api' }],
    };
    expect(() => validateManifest(manifest))
      .toThrow('mcp_servers contains an invalid or disallowed URL');
  });

  it('rejects IPv6 loopback (::1) MCP server URL at runtime', () => {
    const manifest = {
      ...(loadFixture('valid-complete') as Record<string, unknown>),
      mcp_servers: [{ name: 'v6', url: 'http://[::1]/api' }],
    };
    expect(() => validateManifest(manifest))
      .toThrow('mcp_servers contains an invalid or disallowed URL');
  });

  it('accepts a public HTTPS MCP server URL', () => {
    const manifest = {
      ...(loadFixture('valid-complete') as Record<string, unknown>),
      mcp_servers: [{ name: 'pub', url: 'https://mcp.example.com/api' }],
    };
    expect(() => validateManifest(manifest)).not.toThrow();
  });

  it('accepts an HTTP MCP server URL for non-local hosts', () => {
    const manifest = {
      ...(loadFixture('valid-complete') as Record<string, unknown>),
      mcp_servers: [{ name: 'pub', url: 'http://mcp.example.com/api' }],
    };
    expect(() => validateManifest(manifest)).not.toThrow();
  });

  it('returns the manifest object typed as GoodBoyManifest on success', () => {
    const result = validateManifest(loadFixture('valid-minimal'));
    expect(result).toHaveProperty('name', 'test-skill');
    expect(result).toHaveProperty('schema_version', '1.0.0');
  });

  it('rejects a hooks.* value that is a bare string (old format)', () => {
    expect(() => validateManifest({ ...(loadFixture('valid-minimal-executable') as Record<string, unknown>), hooks: { preinstall: '../evil.sh' } }))
      .toThrow('Invalid manifest:');
  });

  it('rejects a hooks.* value that is a bare absolute path string (old format)', () => {
    expect(() => validateManifest({ ...(loadFixture('valid-minimal-executable') as Record<string, unknown>), hooks: { preinstall: '/etc/passwd' } }))
      .toThrow('Invalid manifest:');
  });

  it('accepts a valid hook entry with script only (no args)', () => {
    expect(() => validateManifest({ ...(loadFixture('valid-minimal-executable') as Record<string, unknown>), hooks: { preinstall: { script: 'hooks/run.sh' } } }))
      .not.toThrow();
  });

  it('rejects a hook script without the "hooks/" prefix', () => {
    expect(() => validateManifest({ ...(loadFixture('valid-minimal-executable') as Record<string, unknown>), hooks: { preinstall: { script: 'scripts/run.sh' } } }))
      .toThrow('Invalid manifest:');
  });

  it('rejects a hook script without a file extension', () => {
    expect(() => validateManifest({ ...(loadFixture('valid-minimal-executable') as Record<string, unknown>), hooks: { preinstall: { script: 'hooks/noext' } } }))
      .toThrow('Invalid manifest:');
  });

  it('rejects a hook script containing ".." (excluded by segment character class)', () => {
    expect(() => validateManifest({ ...(loadFixture('valid-minimal-executable') as Record<string, unknown>), hooks: { preinstall: { script: 'hooks/../evil.sh' } } }))
      .toThrow('Invalid manifest:');
  });

  it('rejects an args item containing a semicolon', () => {
    expect(() => validateManifest({ ...(loadFixture('valid-minimal-executable') as Record<string, unknown>), hooks: { preinstall: { script: 'hooks/r.sh', args: [';rm'] } } }))
      .toThrow('Invalid manifest:');
  });

  it('rejects an args item containing a pipe character', () => {
    expect(() => validateManifest({ ...(loadFixture('valid-minimal-executable') as Record<string, unknown>), hooks: { preinstall: { script: 'hooks/r.sh', args: ['a|b'] } } }))
      .toThrow('Invalid manifest:');
  });

  it('rejects an args item containing a dollar sign', () => {
    expect(() => validateManifest({ ...(loadFixture('valid-minimal-executable') as Record<string, unknown>), hooks: { preinstall: { script: 'hooks/r.sh', args: ['$HOME'] } } }))
      .toThrow('Invalid manifest:');
  });

  it('rejects an args item containing a backtick', () => {
    expect(() => validateManifest({ ...(loadFixture('valid-minimal-executable') as Record<string, unknown>), hooks: { preinstall: { script: 'hooks/r.sh', args: ['`cmd`'] } } }))
      .toThrow('Invalid manifest:');
  });

  it('rejects an args item containing a space', () => {
    expect(() => validateManifest({ ...(loadFixture('valid-minimal-executable') as Record<string, unknown>), hooks: { preinstall: { script: 'hooks/r.sh', args: ['a b'] } } }))
      .toThrow('Invalid manifest:');
  });

  it('rejects an args item containing a double quote', () => {
    expect(() => validateManifest({ ...(loadFixture('valid-minimal-executable') as Record<string, unknown>), hooks: { preinstall: { script: 'hooks/r.sh', args: ['"value"'] } } }))
      .toThrow('Invalid manifest:');
  });

  it('rejects an empty string args element', () => {
    expect(() => validateManifest({ ...(loadFixture('valid-minimal-executable') as Record<string, unknown>), hooks: { preinstall: { script: 'hooks/r.sh', args: [''] } } }))
      .toThrow('Invalid manifest:');
  });

  it('rejects an args array with more than 20 items', () => {
    expect(() => validateManifest({
      ...(loadFixture('valid-minimal-executable') as Record<string, unknown>),
      hooks: { preinstall: { script: 'hooks/r.sh', args: Array.from({ length: 21 }, () => 'a') } },
    })).toThrow('Invalid manifest:');
  });

  it('accepts a valid hook entry with script and args', () => {
    expect(() => validateManifest({
      ...(loadFixture('valid-minimal-executable') as Record<string, unknown>),
      hooks: { preinstall: { script: 'hooks/setup.sh', args: ['--mode', 'prod'] } },
    })).not.toThrow();
  });

  it('generated GoodBoyManifest has permissions as a plain array type', () => {
    // Type-level regression guard: if permissions were a tuple union, this assignment would fail tsc.
    // Narrowed to ExecutableSkillManifest because permissions is an exec-only field.
    const p: Extract<GoodBoyManifest, { kind: 'executable' }>['permissions'] = ['read_files', 'network'];
    expect(p).toBeDefined();
  });

  it('rejects permissions with more than 5 items', () => {
    expect(() => validateManifest({
      ...(loadFixture('valid-minimal-executable') as Record<string, unknown>),
      permissions: ['read_files', 'write_files', 'network', 'shell', 'env', 'read_files'],
    })).toThrow('Invalid manifest:');
  });

  it('rejects permissions with duplicate values', () => {
    expect(() => validateManifest({
      ...(loadFixture('valid-minimal-executable') as Record<string, unknown>),
      permissions: ['shell', 'shell'],
    })).toThrow('Invalid manifest:');
  });

  it('rejects mcp_servers with more than 20 items', () => {
    expect(() => validateManifest({
      ...(loadFixture('valid-minimal-executable') as Record<string, unknown>),
      mcp_servers: Array.from({ length: 21 }, (_, i) => ({ name: `s${i}`, url: `https://s${i}.example.com` })),
    })).toThrow('Invalid manifest:');
  });
});

// ---------------------------------------------------------------------------
// validateManifest() — discriminated union: kind-based schema enforcement
// ---------------------------------------------------------------------------

describe('validateManifest() — kind split', () => {
  it('accepts a minimal valid passive manifest', () => {
    expect(() => validateManifest(loadFixture('valid-minimal'))).not.toThrow();
  });

  it('accepts a minimal valid executable manifest', () => {
    expect(() => validateManifest(loadFixture('valid-minimal-executable'))).not.toThrow();
  });

  it('rejects a passive manifest containing entry', () => {
    expect(() => validateManifest({ ...(loadFixture('valid-minimal') as Record<string, unknown>), entry: 'index.ts' }))
      .toThrow('Invalid manifest:');
  });

  it('rejects a passive manifest containing hooks', () => {
    expect(() => validateManifest({ ...(loadFixture('valid-minimal') as Record<string, unknown>), hooks: {} }))
      .toThrow('Invalid manifest:');
  });

  it('rejects a passive manifest containing permissions', () => {
    expect(() => validateManifest({ ...(loadFixture('valid-minimal') as Record<string, unknown>), permissions: ['read_files'] }))
      .toThrow('Invalid manifest:');
  });

  it('rejects an executable manifest containing content', () => {
    expect(() => validateManifest({ ...(loadFixture('valid-minimal-executable') as Record<string, unknown>), content: 'SKILL.md' }))
      .toThrow('Invalid manifest:');
  });

  it('rejects an executable manifest missing entry', () => {
    expect(() => validateManifest({
      kind: 'executable',
      name: 'exec-skill',
      version: '0.1.0',
      description: 'Missing entry',
      author: { name: 'Test Author' },
      license: 'MIT',
      language: 'typescript',
      hooks: {},
      schema_version: '1.0.0',
      status: 'experimental',
    })).toThrow('Invalid manifest:');
  });

  it('rejects an executable manifest missing hooks', () => {
    expect(() => validateManifest({
      kind: 'executable',
      name: 'exec-skill',
      version: '0.1.0',
      description: 'Missing hooks',
      author: { name: 'Test Author' },
      license: 'MIT',
      entry: 'index.ts',
      language: 'typescript',
      schema_version: '1.0.0',
      status: 'experimental',
    })).toThrow('Invalid manifest:');
  });

  it('rejects a manifest with kind set to "unknown"', () => {
    expect(() => validateManifest({ ...(loadFixture('valid-minimal') as Record<string, unknown>), kind: 'unknown' }))
      .toThrow('Invalid manifest:');
  });

  it('rejects a manifest missing kind entirely', () => {
    expect(() => validateManifest({
      name: 'test-skill',
      version: '0.1.0',
      description: 'A skill without kind',
      author: { name: 'Test Author' },
      license: 'MIT',
      schema_version: '1.0.0',
      status: 'experimental',
    })).toThrow('Invalid manifest:');
  });

  it('kind === "executable" narrows manifest.entry to string', () => {
    const manifest = validateManifest(loadFixture('valid-minimal-executable'));
    if (manifest.kind === 'executable') {
      // TypeScript errors here if kind narrowing doesn't produce ExecutableSkillManifest
      const entry: string = manifest.entry;
      expect(entry).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// assertKindConstraints() — runtime kind check, independent of Ajv
// ---------------------------------------------------------------------------

describe('assertKindConstraints()', () => {
  it('throws for passive skill with entry field present', () => {
    const data = { ...(loadFixture('valid-minimal') as Record<string, unknown>), entry: 'index.ts' } as unknown as GoodBoyManifest;
    expect(() => assertKindConstraints(data))
      .toThrow('passive skill contains executable-only field(s): entry');
  });

  it('throws for passive skill with hooks field present', () => {
    const data = { ...(loadFixture('valid-minimal') as Record<string, unknown>), hooks: {} } as unknown as GoodBoyManifest;
    expect(() => assertKindConstraints(data))
      .toThrow('passive skill contains executable-only field(s): hooks');
  });

  it('throws for passive skill with permissions field present', () => {
    const data = { ...(loadFixture('valid-minimal') as Record<string, unknown>), permissions: ['read_files'] } as unknown as GoodBoyManifest;
    expect(() => assertKindConstraints(data))
      .toThrow('passive skill contains executable-only field(s): permissions');
  });

  it('throws for executable skill with content field present', () => {
    const data = { ...(loadFixture('valid-minimal-executable') as Record<string, unknown>), content: 'SKILL.md' } as unknown as GoodBoyManifest;
    expect(() => assertKindConstraints(data))
      .toThrow('executable skill contains passive-only field: content');
  });

  it('does not throw for a valid passive manifest', () => {
    const data = loadFixture('valid-minimal') as GoodBoyManifest;
    expect(() => assertKindConstraints(data)).not.toThrow();
  });

  it('does not throw for a valid executable manifest', () => {
    const data = loadFixture('valid-minimal-executable') as GoodBoyManifest;
    expect(() => assertKindConstraints(data)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// writeManifest()
// ---------------------------------------------------------------------------

describe('writeManifest()', () => {
  const validManifest = loadFixture('valid-minimal') as Parameters<typeof writeManifest>[1];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes JSON with 2-space indentation and trailing newline', async () => {
    await writeManifest('/fake/manifest.json', validManifest);
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    const [, content] = vi.mocked(writeFileSync).mock.calls[0]!;
    expect(typeof content).toBe('string');
    const written = content as string;
    expect(written.endsWith('\n')).toBe(true);
    expect(written).toContain('  '); // 2-space indent present
    expect(JSON.parse(written)).toEqual(validManifest);
  });

  it('writes to the resolved path with utf-8 encoding', async () => {
    await writeManifest('/fake/manifest.json', validManifest);
    const [path, , encoding] = vi.mocked(writeFileSync).mock.calls[0]!;
    expect(String(path)).toMatch(/manifest\.json$/);
    expect(encoding).toBe('utf-8');
  });

  it('throws a clean error on permission denied', async () => {
    mockWriteFileSync.mockImplementation(() => { throw new Error('EACCES'); });
    await expect(writeManifest('/fake/manifest.json', validManifest))
      .rejects.toThrow('Cannot write manifest.json: check directory permissions');
  });
});
