# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

Secrets can now be diagnosed, listed, and validated. This is the S3/S4 slice
of the secrets feature (`docs/concept-secrets.md`): declaring a requirement
(0.2.0) is now backed by actually mapping it to a provider and checking it
resolves. `secrets exec` (injecting a resolved secret into a child process)
was scoped as a possible future phase but is cut from the roadmap entirely —
see the concept doc's decision record (D6) — not merely absent from this
release.

### Added

- `goodboy secrets doctor` — reports configured providers and their
  availability (e.g. whether `op` is installed and signed in). Never prints
  a secret value or a full provider reference.
- `goodboy secrets list` — lists configured name → provider → masked-reference
  mappings. Config-only; never invokes a provider.
- `goodboy secrets validate [--skill <name>] [--resolve]` — checks that
  mappings are structurally valid, and with `--resolve`, that they actually
  resolve through their provider. `--skill` validates a name against an
  installed project skill's declared `requires.secrets`, not local config.
- Two secret providers: `environment` (reads `process.env`) and
  `onepassword-cli` (shells out to the real `op` CLI via `execFile`, never a
  shell string).
- Two new config files: `~/.goodboy/config.json` (user-level) and
  `<project>/goodboy.local.json` (project-level, gitignored) — `goodboy init`
  adds the gitignore entry but does not scaffold the file itself.
- Shared infrastructure backing the above: `lib/errors.ts`, `lib/process.ts`
  (the only other place besides `skill open` that spawns a subprocess, and
  the same `shell: false`-always rule applies), `lib/redact.ts` (values
  registered here are stripped from all CLI logs/errors as a literal
  substring match, never a constructed regex).

### Security

- No secret value is ever persisted, cached, or written to a committed file.
  Provider references (e.g. `op://vault/item/field`) are masked in `list`
  output. See `CONTRIBUTING.md`'s sensitive-files table for the full list of
  files this release adds to that boundary.

## [0.2.0] - 2026-07-21

Skills can now declare logical secret requirements: `manifest.json` supports
a new `requires.secrets` field (schema `1.1.0`) listing the environment-variable-style
names a skill needs at runtime. This is declared intent only — GoodBoy validates
and displays these names; it never resolves, injects, or reads them, and never
executes the skill.

Two rules are enforced to keep this reliable:

- **Feature-driven stamping**: a manifest may only use a field its declared
  `schema_version` actually introduced. A manifest using `requires` but stamped
  below `1.1.0` is rejected with a message naming the exact version to set —
  this prevents a manifest from silently validating on this CLI while a
  tolerant 0.1.1 install rejects it with a confusing generic error.
- **Permissions consistency (hard error)**: `requires.secrets` must be
  accompanied by `"env"` in `permissions`. Older, tolerant CLIs that don't
  know about `requires` at all still see `permissions` — so it must always be
  a reliable signal on its own.

Declared secrets are now shown (names only, never values) in the install/upgrade
consent prompt and in `goodboy skill validate` / `goodboy add` output. `goodboy
skill version --bump` normalizes `schema_version` to its minimum needed value
on every new version it creates — `1.1.0` if the manifest uses `requires`,
`1.0.0` otherwise — but only for a manifest that already validates strictly.
It refuses to bump (no files written) a manifest whose `schema_version` is
newer than this CLI knows: bumping such a manifest would silently strip fields
this CLI doesn't recognize and silently downgrade the stamp, with no warning
ever shown, since the bump path is the one place a validated manifest gets
written back to disk. A manifest that hand-adds `requires` without bumping
`schema_version` is not auto-corrected either — that already fails validation
with a message naming the exact version to set; it requires a manual edit,
by design.

Compatibility: manifests using `requires.secrets` need CLI ≥ 0.1.1 to install
(tolerated with a warning, field invisible) and ≥ 0.2.0 to see and validate
the declaration.

### Added

- `manifest.json`: new optional `requires.secrets` field (schema `1.1.0`) — an array of 1–32 unique, environment-variable-style logical secret names.
- `goodboy skill validate` / `goodboy add`: an info line (`✓ declares N required secrets`) when a manifest declares secrets and validates cleanly.
- Install/upgrade consent prompt: a "Required secrets" section listing declared names alongside permissions.

### Changed

- `@goodboyjs/schema` → `1.1.0`.
- `manifest.ts`: `KNOWN_SCHEMA_VERSION` → `1.1.0`; new feature-stamping and permissions-consistency checks run after schema validation, on every validation path (strict and tolerant).
- `goodboy skill version --bump` normalizes `schema_version` on a strictly-valid manifest it writes: `1.1.0` if `requires` is present, `1.0.0` otherwise. Refuses to bump (no write) a manifest with unresolved tolerance warnings, to avoid silently discarding fields or downgrading the stamp.

## [0.1.1] - 2026-07-20

Forward-compatibility patch: `manifest.json` validation now tolerates a manifest
declaring a newer **minor** schema version than this CLI knows, stripping any
unknown top-level fields and printing a warning instead of hard-rejecting the
skill. A manifest declaring a newer **major** schema version is still rejected,
with a message pointing at upgrading GoodBoy. This is preparatory work: it
shrinks the population of strict-only installs before a future schema `1.1.0`
(CLI `0.2.0`) introduces the `requires.secrets` manifest field.

### Changed

- `@goodboyjs/schema`: `schema_version` is now validated as `^1\.\d+\.\d+$` (semver-shaped, v1.x only) instead of a fixed `"1.0.0"` constant.
- `@goodboyjs/cli`: `goodboy install`, `goodboy upgrade`, `goodboy add`, and `goodboy registry validate` print a warning for a tolerated newer-minor manifest instead of silently accepting or hard-rejecting it.

## [0.1.0] - 2026-07-10

Initial public release.

### Added

- `goodboy init` — initialise a project (`goodboy.json`), with `--registry <url>` for a custom registry.
- `goodboy skill create` — interactive wizard that scaffolds a new skill (`manifest.json`, `SKILL.md`, `scripts/`, `references/`, `assets/`).
- `goodboy skill version` / `goodboy skill version --bump patch|minor|major` — show a skill's version history in the registry, or create a new immutable version from the current latest.
- `goodboy skill open` — open a registry skill version in `$EDITOR` for editing (never the installed copy).
- `goodboy skill diff` / `goodboy skill status` — detect drift between an installed skill and the registry, across project and global scope.
- `goodboy install` / `goodboy install -g` — install a skill at project (`.claude/skills/`) or global (`~/.goodboy/skills/`, symlinked into supported agents) scope; restore all skills from `goodboy.json` when run with no arguments.
- `goodboy upgrade` — upgrade one or all installed skills to the latest registry version.
- `goodboy uninstall` — remove an installed skill.
- `goodboy list` / `goodboy list -g` / `goodboy list --all` — list installed skills, correctly refusing to guess when run outside a GoodBoy project.
- `goodboy search` — search the registry by name, description, or keyword.
- `goodboy add` — add and validate a local skill directory into the registry, with `--force` to replace an existing version.
- `goodboy registry list` / `info` / `validate` / `remove` — inspect and manage the local registry directly.
- A local, git-friendly skill registry with immutable versions (`registry-entry.json` per skill, one directory per version).
- A consent flow (`goodboy install`) that surfaces a skill's declared `permissions` (`read_files`, `write_files`, `network`, `shell`, `env`) for explicit confirmation before install.
- Defense-in-depth path safety: skill name validation (`^[a-z0-9-]+$`), path-traversal guards on every filesystem operation that resolves a name into a path, and symlink-escape detection on every skill copied into the registry, project scope, or global store.
- `@goodboyjs/schema` — the canonical `manifest.json` JSON Schema (draft-07) and generated TypeScript types.
- `@goodboyjs/registry-client` — a Phase 3 stub for the future hosted registry HTTP client; not yet implemented.

### Security

- No sandboxing, chroot, or execution isolation exists in this release. GoodBoy never executes skill content automatically; the only subprocess it spawns is the user's own `$EDITOR` in `goodboy skill open`. See [SECURITY.md](SECURITY.md) for the full model and known limitations.
