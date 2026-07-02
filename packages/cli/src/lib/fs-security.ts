import { readdir, readlink } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

/**
 * Recursively scan `dirPath` for symlinks that point outside `dirPath`.
 * Symlinks whose resolved target starts with `dirPath + sep` are permitted
 * (internal cross-references within the skill). All other symlinks abort
 * with a security error so a malicious skill cannot use them to escape the
 * skill sandbox during copy.
 */
export async function scanForSymlinks(dirPath: string): Promise<void> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isSymbolicLink()) {
      const linkTarget = await readlink(fullPath);
      const resolvedTarget = resolve(dirPath, linkTarget);
      if (!resolvedTarget.startsWith(dirPath + sep) && resolvedTarget !== dirPath) {
        throw new Error(
          `Security: skill contains a symlink pointing outside its directory: ` +
            `${fullPath} → ${resolvedTarget}. Installation aborted.`,
        );
      }
      // Symlink points inside the skill directory — permitted
    } else if (entry.isDirectory()) {
      await scanForSymlinks(fullPath);
    }
  }
}
