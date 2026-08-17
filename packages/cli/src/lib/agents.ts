import { mkdir, lstat, symlink, unlink, readlink } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { homedir } from 'node:os';
import { confirm } from '@inquirer/prompts';
import { logger } from './logger.js';

// Each agent maps to a LIST of directories. A flag names an intent — "make
// this visible to X" — and the list is the current mechanism for satisfying
// it, so it can gain or lose entries later without the flag's meaning
// changing. ~/.agents/skills/ is the emerging cross-vendor convention
// (Codex and Gemini both scan it), and ~/.codex/skills/ is Codex's own
// skills home — codex-cli 0.147 scans both (verified 2026-08-17 from
// session context blocks; see docs/decisions.md, 2026-08-17). 'agents' is
// the generic escape hatch for agents GoodBoy has no dedicated flag for
// yet (see docs/decisions.md, 2026-08-13).
export const AGENT_SKILL_DIRS: Record<string, string[]> = {
  'claude-code': [join(homedir(), '.claude', 'skills')],
  'codex':       [join(homedir(), '.agents', 'skills'), join(homedir(), '.codex', 'skills')],
  'gemini':      [join(homedir(), '.agents', 'skills'), join(homedir(), '.gemini', 'skills')],
  'agents':      [join(homedir(), '.agents', 'skills')],
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
  agents?: boolean;
  allAgents?: boolean;
}): string[] {
  if (flags.allAgents) {
    // 'agents' is not a product with its own directory — it names the shared
    // convention path itself, which --all-agents already reaches through
    // codex's and gemini's lists. Including the key would symlink the same
    // physical path a second time for no new visibility.
    return Object.keys(AGENT_SKILL_DIRS).filter((name) => name !== 'agents');
  }

  const resolved: string[] = [];
  if (flags.claudeCode) resolved.push('claude-code');
  if (flags.codex)      resolved.push('codex');
  if (flags.gemini)     resolved.push('gemini');
  if (flags.agents)     resolved.push('agents');

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

    for (const agentDir of AGENT_SKILL_DIRS[agent]) {
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
            logger.info(`${agent}: already linked correctly: ${symlinkTarget}`);
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
}

// Every agent key whose list contains this path. Shared-ness is derived live
// from the map, never stored — GoodBoy cannot know which other tools actually
// read a directory (see docs/decisions.md, 2026-08-13).
export function agentsSharingPath(path: string): string[] {
  return Object.entries(AGENT_SKILL_DIRS)
    .filter(([, dirs]) => dirs.includes(path))
    .map(([name]) => name);
}

// What to tell the user a shared path is also read by. 'agents' is GoodBoy's
// internal key for the shared-convention target, not a tool a user installed
// for — it counts toward whether a path is shared (the gate above) but never
// appears in what's displayed. If filtering leaves no real names — only
// possible when 'agents' is the sole other owner — describe the shared
// convention itself rather than naming no one.
export function formatOtherReaders(owners: string[], selfAgent: string): string {
  const others = owners.filter((name) => name !== selfAgent && name !== 'agents');
  if (others.length > 0) return `also read by: ${others.join(', ')}`;
  return `part of the shared ${AGENT_SKILL_DIRS['agents'][0]} convention`;
}

// What the plan pass of removeAgentSymlinks records about one existing
// symlink. agent is the first one (in argument order) whose list referenced
// the path — it determines the prompt's perspective and the "Removed <agent>
// symlink" log line. otherReaders is precomputed at plan time so the prompt
// and the abort message always name the same set.
interface PlannedRemoval {
  path: string;
  agent: string;
  shared: boolean;
  otherReaders: string;
}

export async function removeAgentSymlinks(skillName: string, agents: string[]): Promise<boolean> {
  // Two passes. Plan (read-only): classify every existing target and ask
  // every needed confirmation BEFORE anything is removed, so a decline can
  // abort with zero side effects. Commit: only reached when no confirmation
  // was declined — unlink every planned path. A shared path is one physical
  // file, read by whichever tools scan its directory; there is no
  // per-agent removal of it, only remove-for-everyone or leave-it.
  const plan: PlannedRemoval[] = [];
  const plannedPaths = new Set<string>();

  for (const agent of agents) {
    if (!(agent in AGENT_SKILL_DIRS)) {
      logger.warn(`Unknown agent "${agent}" — skipping`);
      continue;
    }

    for (const agentDir of AGENT_SKILL_DIRS[agent]) {
      const symlinkTarget = join(agentDir, skillName);

      // A physical path appears in more than one agent's list; plan it once,
      // on its first hit, or the prompt and unlink would duplicate.
      if (plannedPaths.has(symlinkTarget)) continue;

      const stat = await lstat(symlinkTarget).catch(() => null);
      if (stat === null) continue;

      if (!stat.isSymbolicLink()) {
        logger.warn(
          `${symlinkTarget} is a real directory — skipping (remove manually if needed)`,
        );
        continue;
      }

      const sharedOwners = agentsSharingPath(agentDir);
      const shared = sharedOwners.length > 1;
      plan.push({
        path: symlinkTarget,
        agent,
        shared,
        otherReaders: shared ? formatOtherReaders(sharedOwners, agent) : '',
      });
      plannedPaths.add(symlinkTarget);
    }
  }

  // Decision point: every shared-path confirmation, before anything is
  // removed. Any decline aborts the whole call — nothing is unlinked, not
  // even exclusive paths that needed no confirmation.
  for (const item of plan) {
    if (!item.shared) continue;
    const proceed = await confirm({
      message: `${item.path} is ${item.otherReaders}. Remove anyway?`,
      default: false,
    });
    if (!proceed) {
      logger.warn(
        `Removal declined: ${item.path} is ${item.otherReaders}. Nothing was uninstalled.`,
      );
      return false;
    }
  }

  // Commit pass. Re-lstat each target: the prompt can sit on a real human
  // while something else touches the filesystem, and a target that vanished
  // or stopped being a symlink since planning is skipped, never thrown at
  // (the same lstat-null-continue tolerance the single-pass code had).
  for (const item of plan) {
    const stat = await lstat(item.path).catch(() => null);
    if (stat === null || !stat.isSymbolicLink()) continue;
    await unlink(item.path);
    logger.info(`Removed ${item.agent} symlink: ${item.path}`);
  }
  return true;
}
