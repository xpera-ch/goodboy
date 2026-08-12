/**
 * Cross-cutting security integration tests.
 *
 * Each test targets a specific threat vector documented in SECURITY.md and
 * verifies that at least one independent layer of defence catches it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Stats } from 'node:fs';
import type { Dirent } from 'node:fs';

vi.mock('node:fs');
vi.mock('node:fs/promises');
vi.mock('../lib/manifest.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/manifest.js')>();
  return actual;
});
// Restore real manifest.js — we want real validation, not mocks
vi.unmock('../lib/manifest.js');

vi.mock('node:fs');
vi.mock('node:fs/promises');

import { statSync, readFileSync } from 'node:fs';
import { readdir, readlink } from 'node:fs/promises';
import { readManifest } from '../lib/manifest.js';
import { resolveSkill } from '../lib/registry.js';
import { scanForSymlinks } from '../lib/fs-security.js';

const mockStatSync = vi.mocked(statSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockReaddir = vi.mocked(readdir);
const mockReadlink = vi.mocked(readlink);

function fakeStats(size: number): Stats {
  return { size } as unknown as Stats;
}

function makeDirent(
  name: string,
  opts: { isDir?: boolean; isSymlink?: boolean },
): Dirent {
  return {
    name,
    isDirectory: () => !!opts.isDir,
    isFile: () => !opts.isDir && !opts.isSymlink,
    isSymbolicLink: () => !!opts.isSymlink,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    path: '/skill',
    parentPath: '/skill',
  } as unknown as Dirent;
}

// ---------------------------------------------------------------------------
// Path traversal via skill name (HARDENING 5)
// ---------------------------------------------------------------------------

describe('security — skill name path traversal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['GOODBOY_REGISTRY'];
  });

  it('URL-encoded traversal (..%2F) is caught before filesystem access', async () => {
    await expect(resolveSkill('..%2Fetc%2Fpasswd'))
      .rejects.toThrow('Skill name contains invalid characters');
  });

  it('null byte injection in skill name is caught before filesystem access', async () => {
    await expect(resolveSkill('legit\x00evil'))
      .rejects.toThrow('Skill name contains invalid characters');
  });

  it('double URL-encoded traversal (%252F) is caught', async () => {
    // %252F decodes to %2F on first pass, then / on second — the first pass
    // already produces a different string so the name check fires immediately.
    await expect(resolveSkill('foo%252Fbar'))
      .rejects.toThrow('Skill name contains invalid characters');
  });
});

// ---------------------------------------------------------------------------
// Symlink attacks (HARDENING 2)
// ---------------------------------------------------------------------------

describe('security — symlink attack prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('absolute symlink pointing outside skill dir aborts installation', async () => {
    mockReaddir.mockResolvedValue([
      makeDirent('evil-link', { isSymlink: true }),
    ] as unknown as Awaited<ReturnType<typeof readdir>>);
    mockReadlink.mockResolvedValue('/etc/passwd');

    await expect(scanForSymlinks('/skill')).rejects.toThrow(
      'Security: skill contains a symlink pointing outside its directory',
    );
  });

  it('relative traversal symlink pointing outside skill dir aborts installation', async () => {
    mockReaddir.mockResolvedValue([
      makeDirent('escape', { isSymlink: true }),
    ] as unknown as Awaited<ReturnType<typeof readdir>>);
    mockReadlink.mockResolvedValue('../../etc/passwd');

    await expect(scanForSymlinks('/skill')).rejects.toThrow(
      'Security: skill contains a symlink pointing outside its directory',
    );
  });

  it('symlink pointing inside skill dir is permitted', async () => {
    mockReaddir.mockResolvedValue([
      makeDirent('internal', { isSymlink: true }),
    ] as unknown as Awaited<ReturnType<typeof readdir>>);
    mockReadlink.mockResolvedValue('safe-target');

    await expect(scanForSymlinks('/skill')).resolves.toBeUndefined();
  });

  it('no symlinks in directory resolves cleanly', async () => {
    mockReaddir.mockResolvedValue([
      makeDirent('index.ts', { isDir: false }),
      makeDirent('package.json', { isDir: false }),
    ] as unknown as Awaited<ReturnType<typeof readdir>>);

    await expect(scanForSymlinks('/skill')).resolves.toBeUndefined();
  });

  // ---------------------------------------------------------------------
  // Nested structure. Every case above uses a flat directory listing, so
  // the recursive branch (fs-security.ts:26) was never executed: a symlink
  // one directory deep had no test proving the scanner reaches it at all.
  //
  // These mock readdir per-path rather than with a single fixed list,
  // because the recursive call needs a different dirent list than the
  // top-level call.
  // ---------------------------------------------------------------------

  type ReaddirResult = Awaited<ReturnType<typeof readdir>>;

  function mockTree(tree: Record<string, Dirent[]>): void {
    mockReaddir.mockImplementation(async (dir) => {
      const entries = tree[String(dir)];
      if (!entries) throw new Error(`unexpected readdir on ${String(dir)}`);
      return entries as unknown as ReaddirResult;
    });
  }

  it('symlink nested one directory deep escaping the skill dir aborts installation', async () => {
    mockTree({
      '/skill': [makeDirent('nested', { isDir: true })],
      '/skill/nested': [makeDirent('evil-link', { isSymlink: true })],
    });
    mockReadlink.mockResolvedValue('/etc/passwd');

    await expect(scanForSymlinks('/skill')).rejects.toThrow(
      'Security: skill contains a symlink pointing outside its directory',
    );
  });

  it('symlink nested two directories deep escaping the skill dir aborts installation', async () => {
    // Proves the rejection propagates back up through more than one frame,
    // not merely that one recursive call happens.
    mockTree({
      '/skill': [makeDirent('a', { isDir: true })],
      '/skill/a': [makeDirent('b', { isDir: true })],
      '/skill/a/b': [makeDirent('escape', { isSymlink: true })],
    });
    mockReadlink.mockResolvedValue('../../../../etc/passwd');

    await expect(scanForSymlinks('/skill')).rejects.toThrow(
      'Security: skill contains a symlink pointing outside its directory',
    );
  });

  it('nested subdirectory containing only regular files resolves cleanly', async () => {
    mockTree({
      '/skill': [
        makeDirent('SKILL.md', { isDir: false }),
        makeDirent('scripts', { isDir: true }),
      ],
      '/skill/scripts': [
        makeDirent('run.sh', { isDir: false }),
        makeDirent('helper.sh', { isDir: false }),
      ],
    });

    await expect(scanForSymlinks('/skill')).resolves.toBeUndefined();
  });

  it('symlink inside a nested subdirectory pointing within that subdirectory is permitted', async () => {
    // Recursion must not false-positive on legitimate nested structure.
    mockTree({
      '/skill': [makeDirent('scripts', { isDir: true })],
      '/skill/scripts': [makeDirent('alias.sh', { isSymlink: true })],
    });
    mockReadlink.mockResolvedValue('real.sh');

    await expect(scanForSymlinks('/skill')).resolves.toBeUndefined();
  });

  it('CHARACTERISATION: a nested symlink to a sibling at skill root is rejected', async () => {
    // Documents current behaviour, which is stricter than the doc comment on
    // scanForSymlinks() describes. The containment check compares against
    // `dirPath`, and `dirPath` becomes the SUBDIRECTORY on a recursive call —
    // so "points inside the skill" narrows to "points inside this
    // subdirectory" as soon as recursion begins. `scripts/alias.sh -> ../
    // real.sh` resolves to /skill/real.sh, still inside the skill, and is
    // nonetheless rejected as an escape.
    //
    // This fails closed (it over-rejects; it does not let an escape through),
    // so it is not a hole — but it is a false-positive risk for legitimate
    // skills, and it is NOT what the function's own docstring promises. Left
    // unchanged deliberately: see the phase report. This test exists so that
    // any future change to the containment rule is a deliberate decision
    // rather than a silent one.
    mockTree({
      '/skill': [makeDirent('scripts', { isDir: true })],
      '/skill/scripts': [makeDirent('alias.sh', { isSymlink: true })],
    });
    mockReadlink.mockResolvedValue('../real.sh');

    await expect(scanForSymlinks('/skill')).rejects.toThrow(
      'Security: skill contains a symlink pointing outside its directory',
    );
  });
});

// ---------------------------------------------------------------------------
// Manifest nesting depth (HARDENING 3.5)
// ---------------------------------------------------------------------------

describe('security — manifest nesting depth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('nesting depth > 10 is rejected before JSON.parse', async () => {
    const deepJson = '{'.repeat(11) + '}'.repeat(11);
    mockStatSync.mockReturnValue(fakeStats(deepJson.length));
    (mockReadFileSync as ReturnType<typeof vi.fn>).mockReturnValue(deepJson);

    await expect(readManifest('/skill/manifest.json'))
      .rejects.toThrow('nesting depth exceeds maximum allowed (10)');
  });
});

// ---------------------------------------------------------------------------
// Error message hygiene (HARDENING 6)
// ---------------------------------------------------------------------------

describe('security — error message hygiene', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['GOODBOY_REGISTRY'];
  });

  it('readManifest error contains no absolute home path', async () => {
    mockStatSync.mockImplementation(() => {
      throw Object.assign(new Error(`ENOENT: no such file: ${join(homedir(), '.goodboy/skills/skill/manifest.json')}`), {
        code: 'ENOENT',
      });
    });
    const err = await readManifest('/fake/path').catch((e: unknown) => e as Error);
    expect((err as Error).message).not.toContain(homedir());
  });

  it('readManifest error contains no raw stack traces', async () => {
    mockStatSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const err = await readManifest('/fake/path').catch((e: unknown) => e as Error);
    expect((err as Error).message).not.toMatch(/\s+at\s+\w/);
  });
});
