import { Command } from 'commander';
import { cpSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import ora from 'ora';
import { createRegistryAdapter } from '../lib/registry-adapter.js';
import { readManifest, validateManifestDetailed } from '../lib/manifest.js';
import { requestConsent } from '../lib/consent.js';
import { scanForSymlinks } from '../lib/fs-security.js';
import { computeSkillIntegrity } from '../lib/integrity.js';
import { logger, sanitiseError } from '../lib/logger.js';
import { SKILL_NAME_RE } from '../lib/validation.js';
import {
  readGoodBoyJson,
  addSkillToManifest,
  addSkillToLock,
} from '../lib/goodboy-file.js';
import { resolveAgentFlags, createAgentSymlinks } from '../lib/agents.js';
import { installToStore, getGoodboyHome } from '../lib/store.js';

export interface InstallOptions {
  global?: boolean;
  /** Set to false when Commander sees --no-commit (Commander maps --no-x to options.x = false) */
  commit?: boolean;
  claudeCode?: boolean;
  codex?: boolean;
  gemini?: boolean;
  allAgents?: boolean;
}

// Skills readable by Claude Code (group/world read allowed)
const PROJECT_SKILLS_DIR_MODE = 0o755;

function getProjectSkillsPath(cwd: string): string {
  return join(cwd, '.claude', 'skills');
}

async function ensureGitignoreEntry(cwd: string): Promise<void> {
  const gitignorePath = join(cwd, '.gitignore');
  const entry = '.claude/skills/';

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

async function installNamedProject(
  name: string,
  skillPath: string,
  cwd: string,
): Promise<string> {
  const skillsPath = getProjectSkillsPath(cwd);
  const destPath = join(skillsPath, name);

  // Traversal guard
  if (!destPath.startsWith(skillsPath + sep) && destPath !== skillsPath) {
    throw new Error('Refused: destination path escapes the skills directory');
  }

  if (existsSync(destPath)) {
    const s = statSync(destPath);
    if (!s.isDirectory()) {
      throw new Error('Refused: destination path exists but is not a directory');
    }
  }

  mkdirSync(skillsPath, { recursive: true, mode: PROJECT_SKILLS_DIR_MODE });
  if (existsSync(destPath)) {
    cpSync(skillPath, destPath, { recursive: true, force: true });
  } else {
    cpSync(skillPath, destPath, { recursive: true });
  }

  return destPath;
}

export async function installNamed(
  name: string,
  options: InstallOptions,
  cwd: string,
): Promise<void> {
  if (!SKILL_NAME_RE.test(name)) {
    throw new Error(`Invalid skill name: "${name}". Must match ^[a-z0-9-]+$.`);
  }

  const registry = createRegistryAdapter();
  const spinner = ora(`Resolving "${name}"…`).start();

  let skillPath: string;
  try {
    skillPath = await registry.resolveSkill(name);
  } catch (err) {
    spinner.fail(`Cannot locate skill "${name}"`);
    throw err;
  }

  let manifest;
  try {
    const data = await readManifest(join(skillPath, 'manifest.json'));
    const detailed = validateManifestDetailed(data);
    manifest = detailed.manifest;
    for (const warning of detailed.warnings) {
      logger.warn(warning);
    }
  } catch (err) {
    spinner.fail('Manifest validation failed');
    throw err;
  }

  if (manifest.name !== name) {
    logger.info(
      `Note: manifest declares name "${manifest.name}", installing as "${name}".`,
    );
  }

  spinner.stop();
  const consented = await requestConsent(manifest);
  if (!consented) {
    logger.warn('Installation cancelled.');
    return;
  }
  spinner.start(`Installing "${name}"…`);

  try {
    await scanForSymlinks(skillPath);
  } catch {
    spinner.fail('Symlink check failed');
    throw new Error('Skill rejected: symlink pointing outside skill directory detected');
  }

  let resolvedPath: string;

  if (options.global) {
    let storePath: string;
    try {
      storePath = await installToStore(name, skillPath);
    } catch (err) {
      spinner.fail('Failed to install to store');
      throw err;
    }

    const agents = resolveAgentFlags({
      claudeCode: options.claudeCode,
      codex: options.codex,
      gemini: options.gemini,
      allAgents: options.allAgents,
    });

    try {
      await createAgentSymlinks({ agents, skillName: name, storePath });
    } catch (err) {
      spinner.fail('Failed to create agent symlinks');
      throw err;
    }

    resolvedPath = storePath;

    const integrity = await computeSkillIntegrity(resolvedPath);
    const goodboyHome = getGoodboyHome();
    await addSkillToManifest(goodboyHome, name, manifest.version);
    await addSkillToLock(goodboyHome, name, manifest.version, resolvedPath, integrity);
  } else {
    try {
      resolvedPath = await installNamedProject(name, skillPath, cwd);
    } catch (err) {
      spinner.fail('Failed to copy skill files');
      throw err;
    }

    if (options.commit === false) {
      await ensureGitignoreEntry(cwd);
    }

    const integrity = await computeSkillIntegrity(resolvedPath);
    await addSkillToManifest(cwd, name, manifest.version);
    await addSkillToLock(cwd, name, manifest.version, resolvedPath, integrity);
  }

  spinner.succeed(`Installed "${name}" (${manifest.version})`);
}

export async function installFromManifest(options: InstallOptions, cwd: string): Promise<void> {
  const goodboy = await readGoodBoyJson(cwd);
  if (!goodboy) {
    throw new Error(
      'No goodboy.json found in current directory. Run "goodboy install <skill-name>" to install a skill.',
    );
  }

  const skills = Object.keys(goodboy.skills);
  if (skills.length === 0) {
    logger.info('No skills listed in goodboy.json.');
    return;
  }

  const skillsPath = options.global ? undefined : getProjectSkillsPath(cwd);
  const missing = skills.filter((name) => {
    if (skillsPath === undefined) return true;
    return !existsSync(join(skillsPath, name));
  });

  if (missing.length === 0) {
    logger.info('All skills already installed.');
    return;
  }

  logger.info(`Installing ${missing.length} skill(s)…`);
  for (const name of missing) {
    await installNamed(name, options, cwd);
  }
}

export const installCommand = new Command('install')
  .alias('i')
  .description('Install a skill from the registry, or restore all from goodboy.json')
  .argument('[skill-name]', 'Skill to install (omit to restore from goodboy.json)')
  .option('-g, --global', 'Install to global store (~/.goodboy/skills/)')
  .option('--no-commit', 'Add .claude/skills/ to .gitignore (goodboy.json/lock are still written)')
  .option('--claude-code', 'Link into ~/.claude/skills/ (default when -g and no agent flag)')
  .option('--codex', 'Link into ~/.codex/skills/')
  .option('--gemini', 'Link into ~/.gemini/skills/')
  .option('--all-agents', 'Link into all agent skill directories')
  .action(async (skillName: string | undefined, options: InstallOptions) => {
    const cwd = process.cwd();
    try {
      if (skillName !== undefined) {
        await installNamed(skillName, options, cwd);
      } else {
        await installFromManifest(options, cwd);
      }
    } catch (err) {
      logger.error(sanitiseError(err));
      process.exit(1);
    }
  });
