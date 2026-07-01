# Contributing to GoodBoy

## Repository layout

```
packages/
  cli/               @goodboy/cli — the goodboy binary
  schema/            @goodboy/schema — manifest JSON Schema + TypeScript types
  registry-client/   @goodboy/registry-client — Phase 3 registry HTTP client
scripts/
  generate-types.ts  regenerates packages/schema/generated/ts/index.d.ts
```

## Prerequisites

- Node.js ≥ 18
- npm ≥ 9 (workspaces support required)

## Setup

```sh
git clone https://github.com/<org>/goodboy
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
| `packages/cli/src/lib/hooks.ts` | Executes user-provided hook commands. Any change here can affect whether shell injection is possible. |
| `packages/cli/src/lib/manifest.ts` | Parses and validates untrusted JSON. Size limits, schema enforcement, and error handling must be preserved. |
| `packages/cli/src/lib/registry.ts` | Performs all filesystem path construction. Path traversal guards and directory permission modes must be preserved. |
| `packages/cli/src/lib/validation.ts` | Defines the canonical `SKILL_NAME_RE` regex used across the codebase. |
| `packages/schema/src/manifest.schema.json` | The JSON Schema used to validate all manifests. Adding `additionalProperties: true` to any object definition is a breaking security change. |

### Hard requirements for contributors

The following constraints are not optional. A PR that violates any of them will not be merged regardless of its other merits:

1. **Never use `exec()`, `spawn()` with `shell: true`, or `eval()`** anywhere in the codebase. Hook execution must always use `execFile()` with an explicit argv array.
2. **Manifest validation must occur before hook execution.** The validated in-memory manifest object is the source of truth for hook commands, not a re-read from disk.
3. **All skill names must be validated against `SKILL_NAME_RE`** (`^[a-z0-9-]+$`) before any filesystem operation. Do not construct paths from unvalidated strings.
4. **All path operations on resolved paths must use `startsWith(base + sep)`** to guard against traversal. Never use user-supplied strings in path operations without prior validation.
5. **`additionalProperties: false` must be set on every new object definition** added to `manifest.schema.json`.
6. **`ajv` must be instantiated with `{ strict: true, allErrors: true }`**. Do not loosen these settings.
