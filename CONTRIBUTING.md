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
| `packages/cli/src/lib/errors.ts` | Shared `GoodBoyError` base for the secrets feature. Never gets a `toJSON`/`toString` override that would flatten `cause` into logged output. |
| `packages/cli/src/lib/process.ts` | Shared subprocess runner (`runCapture`/`runInherit`) for the secrets feature. `shell: false` is hard-coded in both, never caller-configurable; a timeout/abort never leaves a hung child process. |
| `packages/cli/src/lib/redact.ts` | The mechanism backing the secrets feature's "no secret material in logs" invariant. Registered values are matched as literal substrings, never compiled into a `RegExp`. |
| `packages/schema/src/config.schema.json` | The JSON Schema for `~/.goodboy/config.json` and `<project>/goodboy.local.json`. `additionalProperties: false` everywhere; `secrets.providers` is a closed `oneOf` over exactly the v1 provider types — widening it is a deliberate schema decision. |
| `packages/cli/src/secrets/config.ts` | Loads, validates, and merges the two secrets-config files. A schema-invalid or malformed config always throws a clear error, never silently coerced; colliding entries are replaced wholesale, never deep-merged. |
| `packages/cli/src/secrets/types.ts` | Defines `SecretValue`, the wrapper every resolved secret flows through. `toString()`/`toJSON()`/`util.inspect` always return a redacted marker — `reveal()` is the only accessor that returns the real value. |
| `packages/cli/src/secrets/provider-registry.ts` | Lazily constructs and caches `SecretProvider` instances by configured name. A provider is never constructed until actually requested — no non-secrets command may trigger provider construction. |
| `packages/cli/src/secrets/providers/environment.ts` | Reads `process.env[reference]` — the point where a raw secret value first enters the system. Only reads the single named variable, never logs `process.env` wholesale. |
| `packages/cli/src/secrets/providers/onepassword-cli.ts` | Shells out to the real `op` CLI via `lib/process.ts`. Always `execFile` with `shell: false`, never `op run`; the `op://` prefix is validated before any subprocess is invoked; raw stderr is never echoed into a thrown error message. |
| `packages/cli/src/secrets/resolver.ts` | Resolves requested secret names against providers and aggregates concurrent failures. Only ever touches the requested names — never iterates config wholesale; never calls `.reveal()` when assembling error messages. |
| `packages/cli/src/secrets/reference-masking.ts` | Keeps vault/item/field content out of `goodboy secrets list` output. An undetermined provider type is masked exactly as conservatively as a known-sensitive one — never assumed safe to show in full. |
| `packages/cli/src/secrets/from-skill.ts` | Resolves an installed project skill's declared secrets by name. Only resolves an installed project skill against `goodboy.json` — no raw path argument, no registry or global-scope fallback. |
| `packages/cli/src/commands/secrets/validate.ts` | The first command to call `resolver.ts`'s `resolveSecrets()`. Never calls `.reveal()` on a `SecretValue`; fail-closed — non-zero exit on any structural or resolution failure. |

### Hard requirements for contributors

The following constraints are not optional. A PR that violates any of them will not be merged regardless of its other merits:

1. **Never use `exec()`, `spawn()` with `shell: true`, or `eval()`** anywhere in the codebase. The one legitimate use of `spawn()` — opening an editor in `goodboy skill open` — must always pass an explicit argv array, never a shell string.
2. **Untrusted manifest JSON must always go through `readManifest()`** (size limit, nesting-depth check) before `JSON.parse`. Never parse a `manifest.json` directly.
3. **All skill names must be validated against `SKILL_NAME_RE`** (`^[a-z0-9-]+$`) before any filesystem operation. Do not construct paths from unvalidated strings.
4. **All path operations on resolved paths must use `startsWith(base + sep)`** to guard against traversal. Never use user-supplied strings in path operations without prior validation.
5. **`additionalProperties: false` must be set on every new object definition** added to `manifest.schema.json`.
6. **`ajv` must be instantiated with `{ strict: true, allErrors: true }`**. Do not loosen these settings.
