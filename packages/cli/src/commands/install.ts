import { Command } from 'commander';
import { cpSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import ora from 'ora';
import { resolveSkill, getSkillsPath } from '../lib/registry.js';
import { readManifest, validateManifest } from '../lib/manifest.js';
import { runHooks } from '../lib/hooks.js';
import { logger } from '../lib/logger.js';

// KNOWN LIMITATION (Phase 1): symlinks created by a preinstall hook inside
// skillPath (the registry source) after this check passes will be copied by
// cpSync. To partially mitigate this, assertNoSymlinks is called a second
// time after preinstall runs (before copy). A complete fix requires an
// O_NOFOLLOW-based copy routine. Tracked in SECURITY.md §3.
function assertNoSymlinks(dirPath: string, root: string): void {
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isSymbolicLink()) {
      const rel = fullPath.slice(root.length + 1);
      throw new Error(
        `Skill contains a symlink "${rel}" — installation refused to prevent path traversal`,
      );
    }
    if (entry.isDirectory()) {
      assertNoSymlinks(fullPath, root);
    }
  }
}

async function run(name: string): Promise<void> {
  const spinner = ora(`Installing skill "${name}"…`).start();

  let skillPath: string;
  try {
    skillPath = await resolveSkill(name);
  } catch (err) {
    spinner.fail(`Cannot locate skill "${name}"`);
    throw err;
  }

  // Read and validate manifest before executing any hooks
  const manifestPath = join(skillPath, 'manifest.json');
  let manifest;
  try {
    const data = await readManifest(manifestPath);
    manifest = validateManifest(data);
  } catch (err) {
    spinner.fail('Manifest validation failed');
    throw err;
  }

  // First symlink check: reject skills that already contain symlinks
  try {
    assertNoSymlinks(skillPath, skillPath);
  } catch (err) {
    spinner.fail('Skill rejected: symlink detected');
    throw err;
  }

  // Run preinstall hook (manifest validated above, symlinks checked above)
  if (manifest.hooks?.preinstall !== undefined) {
    spinner.text = `Running preinstall hook for "${name}"…`;
    try {
      await runHooks(manifest, ['preinstall'], { skillName: name, skillPath });
    } catch (err) {
      spinner.fail('preinstall hook failed');
      throw err;
    }
  }

  // Second symlink check: the preinstall hook may have created symlinks
  // in skillPath after the first check passed. Defense-in-depth.
  try {
    assertNoSymlinks(skillPath, skillPath);
  } catch (err) {
    spinner.fail('Skill rejected: preinstall hook created a symlink');
    throw err;
  }

  // Copy skill into skills directory
  const skillsPath = getSkillsPath();
  const destPath = join(skillsPath, name);

  // Traversal guard on destination
  const expectedPrefix = skillsPath.endsWith(sep) ? skillsPath : skillsPath + sep;
  if (!destPath.startsWith(expectedPrefix)) {
    spinner.fail('Refused: destination path escapes the skills directory');
    throw new Error('Refused: destination path escapes the skills directory');
  }

  try {
    // 0o700: skills are user-private, no group/world read
    mkdirSync(skillsPath, { recursive: true, mode: 0o700 });
    if (existsSync(destPath)) {
      cpSync(skillPath, destPath, { recursive: true, force: true });
    } else {
      cpSync(skillPath, destPath, { recursive: true });
    }
  } catch (err) {
    spinner.fail('Failed to copy skill files');
    throw new Error(
      `Could not install skill: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Run postinstall hook
  if (manifest.hooks?.postinstall !== undefined) {
    spinner.text = `Running postinstall hook for "${name}"…`;
    try {
      await runHooks(manifest, ['postinstall'], { skillName: name, skillPath: destPath });
    } catch (err) {
      spinner.warn('postinstall hook failed (skill was installed)');
      logger.warn(err instanceof Error ? err.message : String(err));
    }
  }

  spinner.succeed(`Installed "${name}" (${manifest.version})`);
}

export const installCommand = new Command('install')
  .description('Install a skill from the registry')
  .argument('<name>', 'Skill name')
  .action(async (name: string) => {
    try {
      await run(name);
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
