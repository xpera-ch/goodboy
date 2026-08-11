# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Removed

- **The secrets resolution layer is removed.** GoodBoy does not handle
  secrets. Decision D6 cut `secrets exec` because GoodBoy does not wrap a
  skill's script execution — and that reasoning removes the *consumer* of
  the resolution layer, not just the injection command. If nothing runs
  skill scripts through GoodBoy, nothing consumes secrets through GoodBoy;
  the credential is needed by your agent or your own shell, and GoodBoy is
  on neither path. What was built resolved a mapping only to tell you it
  resolved, after which you still had to read the value yourself.

  None of this ever shipped to npm — it existed only on `main`. Removed:
  the `goodboy secrets` commands (`doctor`, `list`, `validate`), the
  `environment` and `onepassword-cli` providers, the resolver and provider
  registry, `~/.goodboy/config.json` / `<project>/goodboy.local.json` and
  their schema, and the supporting `lib/errors.ts` and `lib/process.ts`.
  `goodboy init` no longer adds a `goodboy.local.json` gitignore entry.

  `docs/concept-secrets.md` is retained, marked WITHDRAWN, with the
  condition that would reopen it.

- **BREAKING — manifest schema 2.0.0 removes nine fields.** `@goodboyjs/schema`
  goes to `2.0.0` and manifests must now declare `"schema_version": "2.x.y"`.
  Because the schema sets `additionalProperties: false`, a manifest still
  carrying any removed field now **fails validation outright** rather than
  being ignored.

  Removed, with the reason each existed:

  | Field | Why it was there | Reads in the CLI |
  |---|---|---|
  | `publisher` | set by a registry on publish | 0 |
  | `visibility` | private until published | 0 |
  | `homepage` | registry display | 0 |
  | `repository` | registry display | 0 |
  | `changelog` | registry display | 0 |
  | `engines` | advisory runtime constraints | 0 |
  | `os` | advisory OS constraints | 0 |
  | `tags` | controlled vocabulary for faceted search | searched, but identically to `keywords` |
  | `requires` | declared secret names | 1 — a disclosure line, now gone with the secrets feature |

  Seven of these had **zero** readers anywhere in the CLI. They were added
  for a hosted public registry that does not exist and whose existence is
  not yet decided. `tags` went because it and `keywords` were searched by the
  same code path with no differentiated behaviour, while authors were warned
  to fill in both — faceted search is a registry-UI concern and belongs with
  the registry decision.

  Removing an optional field is a major bump; adding one back is a minor. So
  this costs one major now and any future re-add is cheap, whereas keeping
  them until there are users would cost a major *with* users.

  **To migrate:** delete any of the above from your `manifest.json` and set
  `"schema_version": "2.0.0"`. A CLI older than this release will reject a
  2.x manifest with `manifest declares schema 2.0.0; this version of GoodBoy
  supports 1.x manifests. Upgrade GoodBoy to use this skill.`

- The manifest schema `$id` moves from `https://goodboy.dev/schemas/manifest/1.0.0`
  to `https://goodboyjs.com/schemas/manifest/2.0.0`. `goodboy.dev` is not a
  domain this project controls. Ajv never fetches `$id`, so GoodBoy itself was
  unaffected, but editors and third-party validators may resolve it. The frozen
  `versions/v1/` copy deliberately keeps the old identifier so it stays an
  accurate record of what shipped — see `packages/schema/versions/README.md`.

### Added

- `goodboy add` / `goodboy skill validate` now emit a **warning** when
  `SKILL.md`'s `description` differs from `manifest.json`'s. A warning rather
  than an error, unlike the existing `name` and `license` cross-checks:
  `description` is prose, exact equality is brittle, and the two legitimately
  serve different readers — SKILL.md's drives agent triggering, the manifest's
  drives registry search.

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
