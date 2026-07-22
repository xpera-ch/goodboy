import { createHash } from 'node:crypto';
import { readdir, readFile, readlink } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

// Minimal, deliberate denylist: every exclusion is a place to hide unhashed
// payload, so only what's genuinely never meaningful skill content is here.
const EXCLUDED_DIR_NAMES = new Set(['.git']);
const EXCLUDED_FILE_NAMES = new Set(['.DS_Store']);

type EntryType = 'file' | 'symlink';

interface HashableEntry {
  /** Actual OS path, used for I/O (readFile/readlink). */
  fullPath: string;
  /** POSIX-normalized path relative to the root, used for hashing and sorting. */
  normalizedPath: string;
  type: EntryType;
}

function toPosixRelative(rootDir: string, fullPath: string): string {
  return relative(rootDir, fullPath).split(sep).join('/');
}

async function collectEntries(rootDir: string, currentDir: string): Promise<HashableEntry[]> {
  const dirents = await readdir(currentDir, { withFileTypes: true });
  const entries: HashableEntry[] = [];

  for (const dirent of dirents) {
    const fullPath = join(currentDir, dirent.name);

    if (dirent.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(dirent.name)) continue;
      entries.push(...(await collectEntries(rootDir, fullPath)));
      continue;
    }

    if (EXCLUDED_FILE_NAMES.has(dirent.name)) continue;

    // Never follow symlinks — scanForSymlinks permits symlinks that point
    // inside the skill directory, and cpSync preserves them on copy, so the
    // installed destination can genuinely contain them. Following one risks
    // an infinite loop (a permitted symlink pointing at an ancestor
    // directory) and a crash (a symlink to a directory opened as a file).
    // Reading the link target string instead is cycle-safe, cannot crash,
    // and still changes the hash if the skill author retargets the link.
    // Anything that is neither a directory nor a symlink is treated as a
    // plain file unconditionally, rather than checked with a separate
    // isFile() branch: a real skill directory never contains anything else
    // (sockets, fifos, device files), and reading such an entry as a file
    // would simply surface its own I/O error rather than being silently
    // skipped and left unhashed.
    const type: EntryType = dirent.isSymbolicLink() ? 'symlink' : 'file';
    entries.push({ fullPath, normalizedPath: toPosixRelative(rootDir, fullPath), type });
  }

  return entries;
}

/**
 * Computes a deterministic SRI-formatted content hash ("sha256-<base64>") of
 * everything under `rootDir`.
 *
 * Construction (digest-of-digests, not a plain concatenation): for each entry,
 * sorted by POSIX-normalized relative path, hash the entry-type marker plus
 * the path into one fixed-length digest, and hash the entry's content (file
 * bytes, or the symlink's target string, read via readlink and never
 * followed) into a second fixed-length digest. Concatenating two *raw*
 * strings of varying length ("path" + "content") is forgeable — e.g. path
 * "ab" + content "cd" produces the same bytes as path "abc" + content "d".
 * Hashing each half to a fixed-length digest first, before combining them,
 * removes that ambiguity entirely. Those per-entry digest pairs, in sorted
 * order, are fed into one top-level sha256 to produce the final hash.
 */
export async function computeSkillIntegrity(rootDir: string): Promise<string> {
  const entries = await collectEntries(rootDir, rootDir);

  // Sort by normalizedPath without a hand-written comparator: a custom
  // `(a, b) => a < b ? -1 : 1` here would need directory-enumeration order to
  // land on both sides of some pair to exercise both branches, which is
  // filesystem-implementation-defined and not something a test can force
  // reliably. Array.prototype.sort()'s no-argument form compares elements as
  // strings using plain UTF-16 code-unit order -- the same, locale-independent
  // ordering `<`/`>` would give -- with no custom branch in this file at all.
  const byPath = new Map(entries.map((entry) => [entry.normalizedPath, entry]));
  const sortedPaths = [...byPath.keys()].sort();

  const topLevel = createHash('sha256');
  for (const path of sortedPaths) {
    const entry = byPath.get(path)!;
    const pathDigest = createHash('sha256')
      .update(entry.type + entry.normalizedPath, 'utf-8')
      .digest('hex');

    const content =
      entry.type === 'symlink'
        ? Buffer.from(await readlink(entry.fullPath), 'utf-8')
        : await readFile(entry.fullPath);
    const contentDigest = createHash('sha256').update(content).digest('hex');

    topLevel.update(pathDigest + contentDigest, 'utf-8');
  }

  return `sha256-${topLevel.digest('base64')}`;
}
