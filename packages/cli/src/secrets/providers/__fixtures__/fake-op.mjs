#!/usr/bin/env node
// Fake `op` (1Password CLI) for tests — a Node script, never a shell, per
// the concept doc's testing strategy (§6). Scoped to exactly what S4c's
// tests need: `whoami` and `read`. Does NOT simulate `op run` — that's
// S5's concern, and nothing in this phase exercises it.
//
// Scenario selection is driven by the invocation itself (account name /
// reference prefix), not by extra env vars, so parallel test runs never
// race each other. The one env var this script does read,
// FAKE_OP_ARGV_LOG, is a per-test-controlled file path used purely so
// tests can assert exactly which argv this fixture was invoked with
// (e.g. that --no-newline and --account were really passed).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const argv = process.argv.slice(2);

const logPath = process.env['FAKE_OP_ARGV_LOG'];
if (logPath) {
  mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(logPath, JSON.stringify(argv));
}

const [subcommand, ...rest] = argv;

function accountArg() {
  const idx = rest.indexOf('--account');
  return idx === -1 ? undefined : rest[idx + 1];
}

if (subcommand === 'whoami') {
  if (accountArg() === 'unauthenticated-account') {
    process.stderr.write('[ERROR] 401: You are not currently signed in. Please run `op signin`.\n');
    process.exit(1);
  }
  process.stdout.write('url:    https://example.1password.com\nemail:  test@example.com\n');
  process.exit(0);
} else if (subcommand === 'read') {
  const reference = rest[0] ?? '';
  if (reference.startsWith('op://fail/')) {
    process.stderr.write('[ERROR] 404: no such item.\n');
    process.exit(1);
  } else if (reference.startsWith('op://slow/')) {
    setTimeout(() => {
      process.stdout.write(reference);
      process.exit(0);
    }, 2000);
  } else {
    // Echoes the reference verbatim (no trailing newline, matching
    // --no-newline) so tests can assert byte-exact round-tripping,
    // including references containing a legal space.
    process.stdout.write(reference);
    process.exit(0);
  }
} else {
  process.stderr.write(`fake-op: unrecognized subcommand "${subcommand}"\n`);
  process.exit(2);
}
