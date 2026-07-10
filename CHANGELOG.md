# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
