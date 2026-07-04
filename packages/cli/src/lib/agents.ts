import { mkdir, lstat, symlink, unlink, readlink } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { homedir } from 'node:os';
import { logger } from './logger.js';

export const AGENT_SKILL_DIRS: Record<string, string> = {
  'claude-code': join(homedir(), '.claude', 'skills'),
  'codex':       join(homedir(), '.codex', 'skills'),
  'gemini':      join(homedir(), '.gemini', 'skills'),
};

const DEFAULT_AGENT = 'claude-code';

export interface AgentLinkOptions {
  agents: string[];
  skillName: string;
  storePath: string;
}

export function resolveAgentFlags(flags: {
  claudeCode?: boolean;
  codex?: boolean;
  gemini?: boolean;
  allAgents?: boolean;
}): string[] {
  if (flags.allAgents) return Object.keys(AGENT_SKILL_DIRS);

  const resolved: string[] = [];
  if (flags.claudeCode) resolved.push('claude-code');
  if (flags.codex)      resolved.push('codex');
  if (flags.gemini)     resolved.push('gemini');

  if (resolved.length === 0) return [DEFAULT_AGENT];

  /* c8 ignore next 5 */
  for (const name of resolved) {
    if (!(name in AGENT_SKILL_DIRS)) {
      throw new Error(`Unknown agent: "${name}"`);
    }
  }
  return resolved;
}

export async function createAgentSymlinks(options: AgentLinkOptions): Promise<void> {
  const { agents, skillName, storePath } = options;

  for (const agent of agents) {
    if (!(agent in AGENT_SKILL_DIRS)) {
      throw new Error(`Unknown agent: "${agent}"`);
    }

    const agentDir = AGENT_SKILL_DIRS[agent]!;
    const symlinkTarget = join(agentDir, skillName);

    // Traversal guard — validated skillName should already be safe, but belt-and-suspenders
    /* c8 ignore next 3 */
    if (!symlinkTarget.startsWith(agentDir + sep) && symlinkTarget !== agentDir) {
      throw new Error(`Refused: symlink target escapes agent skills directory`);
    }

    await mkdir(agentDir, { recursive: true, mode: 0o700 });

    const stat = await lstat(symlinkTarget).catch(() => null);
    if (stat !== null) {
      if (stat.isSymbolicLink()) {
        const existing = await readlink(symlinkTarget);
        if (existing === storePath) {
          logger.info(`${agent}: already linked correctly`);
          continue;
        }
        await unlink(symlinkTarget);
      } else {
        throw new Error(
          `Cannot create symlink: ${symlinkTarget} exists as a real directory. ` +
          `Remove it manually before installing globally.`,
        );
      }
    }

    await symlink(storePath, symlinkTarget);
    logger.success(`Linked to ${agent}: ${symlinkTarget}`);
  }
}

export async function removeAgentSymlinks(skillName: string, agents: string[]): Promise<void> {
  for (const agent of agents) {
    if (!(agent in AGENT_SKILL_DIRS)) {
      logger.warn(`Unknown agent "${agent}" — skipping`);
      continue;
    }

    const agentDir = AGENT_SKILL_DIRS[agent]!;
    const symlinkTarget = join(agentDir, skillName);

    const stat = await lstat(symlinkTarget).catch(() => null);
    if (stat === null) continue;

    if (stat.isSymbolicLink()) {
      await unlink(symlinkTarget);
      logger.info(`Removed ${agent} symlink: ${symlinkTarget}`);
    } else {
      logger.warn(
        `${symlinkTarget} is a real directory — skipping (remove manually if needed)`,
      );
    }
  }
}
