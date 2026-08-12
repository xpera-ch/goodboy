# Contributing to GoodBoy

## Repository layout

```
packages/
  cli/               @goodboyjs/cli — the goodboy binary
  schema/            @goodboyjs/schema — manifest JSON Schema + TypeScript types
  registry-client/   @goodboyjs/registry-client — Phase 3 registry HTTP client
scripts/
  generate-types.ts  regenerates packages/schema/generated/ts/index.d.ts
```

## Prerequisites

- Node.js ≥ 18
- npm ≥ 9 (workspaces support required)

## Setup

```sh
git clone https://github.com/xpera-ch/goodboy
cd goodboy
npm install
```

## Common tasks

```sh
# Regenerate TypeScript types from the manifest schema
npm run generate:types

# Build the CLI
npm run build -w packages/cli

# Build the registry client
npm run build -w packages/registry-client
```

## Testing

### A guard is not done until you have watched it fail

**Scope — read this first, because the rule is deliberately narrow.**

It applies to **guards**: things whose *job* is to fail. A CI step, a
`verify:*` script, a coverage threshold, a security check, a negative
assertion, a lint. Ask: *does this exist to catch something?* If yes, the
rule applies.

It does **not** apply to ordinary assertions about behaviour.
`expect(resolveSkill('x')).toBe(…)` describes what the code does; it needs
no proof that it can fail. Most of the suite is this, and applying the rule
there would be pure ceremony.

**The rule:** before a guard is considered done, break the thing it
guards, observe the failure, paste the output, revert. **Evidence, not
assertion** — "I verified it works" is exactly the claim that produced
every instance below.

Keep the proof proportionate. A one-line assertion needs a one-line proof.

**Why this exists — four gates that could not fail, all found in one week:**

| Guard | Why it could never fail |
|---|---|
| `verify:types` | diffed a directory that was gitignored |
| CI "green" | the workflow never ran the tests |
| `security-sensitive.json` | invisible to entry *removal*, by construction |
| lockfile vs `package.json` versions | nothing compared the two records |

Plus two guards that *could* fail but passed for the wrong reason: a test
covering unreachable code (so it only passed because `node:fs` was mocked
into a state the real filesystem cannot produce), and a negative assertion
satisfied by test ordering rather than by the code being correct.

In every case the guard was written, it passed, and nobody ever saw it
fail.

**Worked examples from this repo**, all cheap:

- Threshold enforcement: `it.skip` one test on a 100%-pinned file, confirm
  `test:coverage` exits non-zero, revert.
- A negative assertion: temporarily make the code do the thing being
  asserted against, watch the test fail, revert.
- A schema or identity guard: mutate the value it checks, confirm the guard
  catches it, revert.
- A fixture pinned to a previous state: try migrating it and confirm the
  guard rejects the migration.

### Tests must be order-independent

The suite is verified under randomised ordering, not just the default file
order:

```sh
cd packages/cli
npx vitest run --sequence.shuffle                  # random order
npx vitest run --sequence.shuffle --sequence.seed=42   # reproducible order
```

A test that only passes because of what ran before it certifies nothing —
and a negative assertion (`expect(fn).not.toHaveBeenCalled()`) can silently
invert its meaning that way, passing while the behaviour is broken. Three
kinds of state leak between tests, and they need different handling:

- **Recorded mock calls** — handled globally by `clearMocks: true` in
  `packages/cli/vitest.config.ts`. Nothing to do per test.
- **Mock implementations** — `clearMocks` does *not* remove these. A test
  that installs one (`mockFn.mockImplementation(() => { throw … })`) must
  ensure it cannot leak, e.g. by resetting the mock in the suite's
  `beforeEach`.
- **Non-mock module state** — the one that bites hardest, and the one
  nothing global can fix. Commander keeps parsed option values on the
  `Command` instance, so parsing `['-g']` in one test leaves
  `global: true` set for every later test that parses `[]`.

### Writing a command test

There is no global reset for commander state — it cannot be done from a
vitest `setupFiles` entry, because importing the command modules there
binds them to real `lib/` implementations before each test file's hoisted
`vi.mock()` factories apply. This was measured: it breaks ~26% of the
suite, including files that never touch commander. So a command test must
use one of these two patterns:

1. **Build a fresh `Command` per parse.** A `buildProgram()` helper that
   returns `new Command()` each time it is called, as in
   `skill-version.test.ts`, `skill-status.test.ts`, `skill-diff.test.ts`,
   `skill-open.test.ts`, `skill-create.test.ts`. Nothing is shared, so
   nothing can leak. Prefer this for new tests.
2. **Reuse the exported singleton, and reset it.** If the test imports a
   module-level command (`installCommand`, `addCommand`, …), it must call
   `resetCommandOptions(<command>)` (from `src/__fixtures__`) in its
   `beforeEach`. The helper recurses into subcommands, because commander
   stores a subcommand's values on the *child*: after parsing
   `['version', 'x', '--bump', 'patch']`, the parent's `opts()` is `{}`
   while the child's is `{ bump: 'patch' }`.

A command with no options (`adopt`) has nothing to leak and needs neither.

If you add a test that fails under `--sequence.shuffle` but passes in
default order, that is a real defect in the test, not a flake — fix the
setup rather than pinning the order.

## Updating the schema

1. Edit `packages/schema/src/manifest.schema.json`
2. Run `npm run generate:types` to regenerate the TypeScript types
3. Copy the updated schema to `packages/schema/versions/v1/manifest.schema.json` if this is a new published version

## Pull requests

- One logical change per PR
- All TypeScript must compile without errors (`tsc --noEmit`)
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)

## Security

### Filing a report

If you discover a security vulnerability, **do not open a public issue**. Follow the process in [SECURITY.md](SECURITY.md).

### Security-sensitive files

The following files implement security-critical logic. Changes to them require extra scrutiny and must be explicitly called out in the PR description:

| File | Why it is sensitive |
|---|---|
| `packages/cli/src/lib/manifest.ts` | Parses and validates untrusted JSON. Size limits, schema enforcement, and error handling must be preserved. |
| `packages/cli/src/lib/registry.ts` | Resolves the registry path (including the `GOODBOY_REGISTRY` override) and skill resolution used by every command. Path traversal guards must be preserved. |
| `packages/cli/src/lib/registry-entry.ts` | Reads/writes `registry-entry.json`, the versioned record every install/upgrade relies on. Held to 100% test coverage. |
| `packages/cli/src/lib/skill-validator.ts` | Validates an entire skill directory (manifest + SKILL.md + symlink scan) before it's trusted enough to add or install. |
| `packages/cli/src/lib/goodboy-file.ts` | Reads/writes `goodboy.json`, the per-project manifest of installed skills. Skill names must be validated before being written or used in a path. |
| `packages/cli/src/lib/agents.ts` | Symlinks installed skills into agent directories (`.claude/skills/`, `.codex/skills/`, etc.). Symlink targets must stay within the resolved store/registry path. |
| `packages/cli/src/lib/store.ts` | Resolves the global skill store path (`~/.goodboy/skills/`). Path traversal guards (`assertWithinStore`) must be preserved. |
| `packages/cli/src/lib/validation.ts` | Defines the canonical `SKILL_NAME_RE` regex used across the codebase. |
| `packages/cli/src/lib/fs-security.ts` | Implements `scanForSymlinks`, the guard that rejects a skill directory containing a symlink pointing outside itself before it's added to the registry. |
| `packages/cli/src/lib/integrity.ts` | Computes the SRI content-integrity hash recorded in `goodboy.lock` at install/upgrade time. The hash construction is versioned/frozen — changing it breaks every stored lock hash. |
| `packages/cli/src/commands/skill-version.ts` | Bumps a registry skill's version, including cleanup of an orphaned version directory on a refused bump. Held to the same 100% coverage bar as the files above. |
| `packages/cli/src/lib/verify.ts` | Recomputes an installed skill's content-integrity hash and classifies it against `goodboy.lock`. Never treats a missing `integrity` field as a match — that's its own not-verified state. |
| `packages/cli/src/commands/verify.ts` | The `goodboy verify` fail-closed gate on top of `verify.ts`. Exits non-zero on any mismatch; a not-verified skill never affects the exit code. |
| `packages/cli/src/commands/skill-status.ts` | Displays installed-skill drift via the same whole-tree integrity comparison as `verify.ts`. Informational only, but a false "up to date" here is the same class of false confidence as a wrong `goodboy verify` result. |
| `packages/cli/src/commands/skill-open.ts` | Spawns `$EDITOR` (or an autodetected editor) as a subprocess — the one place GoodBoy launches an external process. Must never use `shell: true`, and must only ever pass the resolved `SKILL.md` path as an argument. |
| `packages/schema/src/manifest.schema.json` | The JSON Schema used to validate all manifests. Adding `additionalProperties: true` to any object definition is a breaking security change. |

### Hard requirements for contributors

The following constraints are not optional. A PR that violates any of them will not be merged regardless of its other merits:

1. **Never use `exec()`, `spawn()` with `shell: true`, or `eval()`** anywhere in the codebase. The one legitimate use of `spawn()` — opening an editor in `goodboy skill open` — must always pass an explicit argv array, never a shell string.
2. **Untrusted manifest JSON must always go through `readManifest()`** (size limit, nesting-depth check) before `JSON.parse`. Never parse a `manifest.json` directly.
3. **All skill names must be validated against `SKILL_NAME_RE`** (`^[a-z0-9-]+$`) before any filesystem operation. Do not construct paths from unvalidated strings.
4. **All path operations on resolved paths must use `startsWith(base + sep)`** to guard against traversal. Never use user-supplied strings in path operations without prior validation.
5. **`additionalProperties: false` must be set on every new object definition** added to `manifest.schema.json`.
6. **`ajv` must be instantiated with `{ strict: true, allErrors: true }`**. Do not loosen these settings.
