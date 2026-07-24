import { readFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from './logger.js';

/**
 * Ensures a single line is present in <cwd>/.gitignore, appending it if
 * missing. Idempotent: a line already present (exact match after trimming)
 * is never duplicated. Creates the file if it doesn't exist yet.
 */
export async function ensureGitignoreEntry(cwd: string, entry: string): Promise<void> {
  const gitignorePath = join(cwd, '.gitignore');

  let existing = '';
  try {
    existing = await readFile(gitignorePath, 'utf-8');
  } catch {
    // .gitignore doesn't exist yet — will be created
  }

  const lines = existing.split('\n');
  if (!lines.some((l) => l.trim() === entry)) {
    const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    await appendFile(gitignorePath, `${prefix}${entry}\n`, 'utf-8');
    logger.info(`Added "${entry}" to .gitignore`);
  }
}
