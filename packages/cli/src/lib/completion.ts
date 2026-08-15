import { Command, Option } from 'commander';
import { createRegistryAdapter } from './registry-adapter.js';
import { readGoodBoyJson, readGoodBoyLock } from './goodboy-file.js';
import { getGoodboyHome } from './store.js';

/**
 * Shell tab-completion engine. Walks the live commander tree and local
 * sources (registry listing, goodboy.json, goodboy.lock) to produce
 * candidate completions for `goodboy __complete <words...>`. The last word
 * is the partial prefix being completed; everything before it is the typed
 * command path. Completion must never throw — every failure mode degrades
 * to an empty candidate list (docs/decisions.md, 2026-08-15).
 */

/** Which command draws skill names from where. Keyed by the leaf command
 * name — the tree walk always lands on the deepest matching command, and
 * command names are unique among siblings. */
const SKILL_SOURCES: Readonly<Record<string, SkillSource>> = {
  install: 'registry',
  upgrade: 'registry',
  diff: 'registry', // skill diff
  version: 'registry', // skill version
  info: 'registry', // registry info
  validate: 'registry', // registry validate
  remove: 'registry', // registry remove
  uninstall: 'json',
  open: 'json', // skill open
  verify: 'lock',
};

/** The internal `__complete` protocol command is callable but not offered
 * as a completion candidate. */
const HIDDEN_FROM_COMPLETION = new Set(['__complete']);

type SkillSource = 'registry' | 'json' | 'lock';

export async function complete(
  program: Command,
  words: string[],
): Promise<string[]> {
  if (words.length === 0) return [];
  // The length check above guarantees the index exists.
  const prefix = words[words.length - 1]!;
  const typed = words.slice(0, -1);
  const { cmd, positionals } = walk(program, typed);

  if (prefix.startsWith('-')) {
    return optionCandidates(cmd, prefix);
  }
  if (cmd.commands.length > 0) {
    return subcommandCandidates(cmd, prefix);
  }
  const source = SKILL_SOURCES[cmd.name()];
  if (source !== undefined && positionals < cmd.registeredArguments.length) {
    return [...new Set(await skillNames(source, words))]
      .filter((name) => name.startsWith(prefix))
      .sort();
  }
  return [];
}

interface WalkResult {
  cmd: Command;
  positionals: number;
}

/** Follows the typed words down the tree, skipping flags and counting
 * positional words, so the current position can be compared against the
 * command's declared argument list. */
function walk(program: Command, typed: string[]): WalkResult {
  let cmd = program;
  let positionals = 0;
  let skipNext = false;
  for (const word of typed) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (word.startsWith('-')) {
      const eq = word.indexOf('=');
      const flag = eq === -1 ? word : word.slice(0, eq);
      const option = findOption(cmd, flag);
      // A value-taking option consumes the next word as its value; the
      // inline form (`--opt=value`) carries its own value and does not.
      if (option && (option.required || option.optional) && eq === -1) {
        skipNext = true;
      }
      continue;
    }
    const sub = cmd.commands.find((c) => c.name() === word);
    if (sub) {
      cmd = sub;
      continue;
    }
    positionals++;
  }
  return { cmd, positionals };
}

function findOption(cmd: Command, flag: string): Option | undefined {
  return cmd.options.find((o) => o.long === flag || o.short === flag);
}

function subcommandCandidates(cmd: Command, prefix: string): string[] {
  return cmd.commands
    .map((c) => c.name())
    .filter(
      (name) => name.startsWith(prefix) && !HIDDEN_FROM_COMPLETION.has(name),
    )
    .sort();
}

function optionCandidates(cmd: Command, prefix: string): string[] {
  const names = cmd.options.flatMap((o) => {
    const forms = [o.long, o.short];
    // Most options carry both forms; long-only options (e.g. --no-commit)
    // exercise the drop side.
    return forms.filter((form): form is string => form !== undefined);
  });
  return [...new Set(names)]
    .filter((name) => name.startsWith(prefix))
    .sort();
}

async function skillNames(
  source: SkillSource,
  words: string[],
): Promise<string[]> {
  try {
    switch (source) {
      case 'registry': {
        const entries = await createRegistryAdapter().listRegistry();
        return entries.map((entry) => entry.name);
      }
      case 'json':
      case 'lock': {
        const dir = hasGlobalFlag(words) ? getGoodboyHome() : process.cwd();
        const data =
          source === 'json' ? await readGoodBoyJson(dir) : await readGoodBoyLock(dir);
        return data ? Object.keys(data.skills) : [];
      }
    }
  } catch {
    return [];
  }
}

/** `-g` detection is a plain substring check over the typed words. */
function hasGlobalFlag(words: string[]): boolean {
  return words.some((word) => word.includes('-g'));
}
