#!/usr/bin/env node
/**
 * Detection script (drafting aid) for the security-impact skill.
 *
 * Deliberately decoupled from any CI enforcement gate — this is a script
 * that helps DRAFT a security-impact section, not a gate that blocks a
 * merge. It has no shared unit or file-dependency link with CI; if a CI
 * check for the same config is ever built, it should be a separate script,
 * not a caller of this one.
 *
 * Source of truth is a dedicated structured config file (JSON), never
 * CONTRIBUTING.md — CONTRIBUTING.md is reserved for human-facing
 * contributor onboarding, and parsing it as a machine contract is fragile
 * (a prose reformat could silently break the parse) and violates single
 * responsibility.
 *
 * Zero dependencies by design — this must run inside a bare skill
 * environment without an `npm install` step.
 *
 * Usage:
 *   node check-sensitive-files.mjs [--config <path>] [--diff <ref>] [--files <a,b,c>]
 *
 *   --config <path>   Path to the structured sensitive-files config.
 *                      Default: security-sensitive.json at the repo root
 *                      (cwd when the script is run).
 *   --diff <ref>       Passed straight to `git diff --name-only <ref>`.
 *                      Default (no --diff, no --files): `git diff --name-only HEAD`
 *                      (uncommitted working-tree + staged changes).
 *   --files <a,b,c>    Explicit comma-separated file list; skips git
 *                      entirely. Useful outside a git context or for
 *                      testing.
 *
 * Fails closed: a missing or unreadable config file is a hard error (exit
 * 1), never treated as "nothing is sensitive."
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

function parseArgs(argv) {
  const args = { config: 'security-sensitive.json' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') args.config = argv[++i];
    else if (a === '--diff') args.diff = argv[++i];
    else if (a === '--files') args.files = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printHelpAndExit() {
  process.stdout.write(
    'Usage: node check-sensitive-files.mjs [--config <path>] [--diff <ref>] [--files <a,b,c>]\n',
  );
  process.exit(0);
}

// Minimal, dependency-free glob support: '**' matches across path
// separators, '*' matches within a single path segment. Everything else in
// the pattern is treated as a literal (regex-escaped).
function globToRegExp(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      out += '.*';
      i++;
    } else if (c === '*') {
      out += '[^/]*';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      out += '\\' + c;
    } else {
      out += c;
    }
  }
  return new RegExp(`^${out}$`);
}

function loadConfig(configPath) {
  if (!existsSync(configPath)) {
    process.stderr.write(
      `security-impact: config not found at "${configPath}". ` +
        `This is a hard error, not "no sensitive files" — a project using ` +
        `this skill must declare its sensitive-file config explicitly. ` +
        `See assets/security-sensitive.example.json for the expected shape.\n`,
    );
    process.exit(1);
  }
  let raw;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (err) {
    process.stderr.write(`security-impact: could not read "${configPath}": ${err.message}\n`);
    process.exit(1);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`security-impact: invalid JSON in "${configPath}": ${err.message}\n`);
    process.exit(1);
  }
  if (!parsed || !Array.isArray(parsed.sensitive_files)) {
    process.stderr.write(
      `security-impact: "${configPath}" must have a top-level "sensitive_files" array.\n`,
    );
    process.exit(1);
  }
  for (const entry of parsed.sensitive_files) {
    if (typeof entry.pattern !== 'string' || typeof entry.reason !== 'string') {
      process.stderr.write(
        `security-impact: each sensitive_files entry needs a string "pattern" and "reason". ` +
          `Offending entry: ${JSON.stringify(entry)}\n`,
      );
      process.exit(1);
    }
  }
  return parsed;
}

function getChangedFiles(args) {
  if (args.files) {
    return args.files.split(',').map((f) => f.trim()).filter(Boolean);
  }
  const diffArg = args.diff ?? 'HEAD';
  let diffOutput;
  try {
    diffOutput = execFileSync('git', ['diff', '--name-only', diffArg], { encoding: 'utf-8' });
  } catch (err) {
    process.stderr.write(
      `security-impact: "git diff --name-only ${diffArg}" failed: ${err.message}\n` +
        `Pass --files explicitly if this isn't a git repository.\n`,
    );
    process.exit(1);
  }
  // `git diff` alone only reports tracked files (modified/deleted). A newly
  // added file that matches a sensitive pattern but hasn't been staged yet
  // would otherwise be invisible — merge in untracked-but-not-ignored files
  // too, so a brand-new sensitive file gets caught just as reliably as a
  // modified one.
  let untrackedOutput = '';
  try {
    untrackedOutput = execFileSync(
      'git',
      ['ls-files', '--others', '--exclude-standard'],
      { encoding: 'utf-8' },
    );
  } catch {
    // Non-fatal: if this fails, we still have the tracked-diff results.
  }
  const combined = new Set(
    [...diffOutput.split('\n'), ...untrackedOutput.split('\n')]
      .map((f) => f.trim())
      .filter(Boolean),
  );
  return [...combined];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) printHelpAndExit();

  const config = loadConfig(args.config);
  const changedFiles = getChangedFiles(args);

  const compiled = config.sensitive_files.map((entry) => ({
    ...entry,
    regex: globToRegExp(entry.pattern),
  }));

  const matches = [];
  const matchedFiles = new Set();

  for (const file of changedFiles) {
    for (const entry of compiled) {
      if (entry.regex.test(file)) {
        matches.push({
          file,
          pattern: entry.pattern,
          reason: entry.reason,
          invariants: entry.invariants ?? [],
        });
        matchedFiles.add(file);
      }
    }
  }

  const result = {
    configPath: args.config,
    changedFiles,
    matches,
    unmatchedChangedFiles: changedFiles.filter((f) => !matchedFiles.has(f)),
  };

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main();
