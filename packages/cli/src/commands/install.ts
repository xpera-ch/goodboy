import { Command } from 'commander';
import { cpSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import ora from 'ora';
import { createRegistryAdapter } from '../lib/registry-adapter.js';
import { readManifest, validateManifest } from '../lib/manifest.js';
import { runHooks } from '../lib/hooks.js';
import { scanForSymlinks } from '../lib/registry.js';
import { logger } from '../lib/logger.js';

async function run(name: string): Promise<void> {
  const registry = createRegistryAdapter();
  const spinner = ora(`Installing skill "${name}"…`).start();

  let skillPath: string;
  try {
    skillPath = await registry.resolveSkill(name);
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

  // Run preinstall hook (manifest validated above)
  if (manifest.hooks?.preinstall !== undefined) {
    spinner.text = `Running preinstall hook for "${name}"…`;
    try {
      await runHooks(manifest, ['preinstall'], { skillName: name, skillPath });
    } catch (err) {
      spinner.fail('preinstall hook failed');
      throw err;
    }
  }

  // Symlink scan: reject symlinks escaping the skill directory.
  // Runs after preinstall so any hook-created symlinks are also caught.
  try {
    await scanForSymlinks(skillPath);
  } catch (err) {
    spinner.fail('Skill rejected: symlink pointing outside skill directory detected');
    throw err;
  }

  // Copy skill into skills directory
  const skillsPath = registry.getSkillsLocation();
  const destPath = join(skillsPath, name);

  // Traversal guard on destination
  const expectedPrefix = skillsPath.endsWith(sep) ? skillsPath : skillsPath + sep;
  if (!destPath.startsWith(expectedPrefix)) {
    spinner.fail('Refused: destination path escapes the skills directory');
    throw new Error('Refused: destination path escapes the skills directory');
  }

  // Destination must not already exist as a non-directory (e.g. a file or symlink)
  if (existsSync(destPath)) {
    const destStat = statSync(destPath);
    if (!destStat.isDirectory()) {
      spinner.fail('Refused: destination path exists but is not a directory');
      throw new Error('Refused: destination path exists but is not a directory');
    }
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
