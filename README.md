# GoodBoy

A personal skill manager — registry and installer — for AI agents built on the Agent Skills standard.

[![CI](https://github.com/xpera-ch/goodboy/actions/workflows/ci.yml/badge.svg)](https://github.com/xpera-ch/goodboy/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@goodboyjs/cli.svg)](https://www.npmjs.com/package/@goodboyjs/cli)

## What is GoodBoy

Installing and pinning skills is a solved problem. The harder question is what you actually have: an installed skill that silently no longer matches what you meant to install — edited by hand, drifted across projects and machines — is a skill you can't trust. `gh skill` and `npx skills` tell you when a newer version exists; neither asks whether the copy on disk is still the one you installed, or whether it has been tampered with or drifted since.

GoodBoy does the same basic install job as those two tools — install, upgrade, uninstall — and isn't trying to out-compete them there. What's different:

- **Local integrity verification that fails closed.** `goodboy verify` and `goodboy skill status` answer a question neither `gh skill` nor `npx skills` asks: *has my installed copy been silently modified since I installed it?* `goodboy verify` recomputes the content hash recorded at install time and reports any mismatch; `goodboy skill status` shows every tracked skill with its version and drift state at a glance.
- **A personal private registry with immutable versions.** `~/.goodboy/registry` is the centre of gravity: a skill is developed in its own source directory and published to the registry when it's ready to install somewhere; versions are immutable once created, and `goodboy upgrade` replaces installed copies from it deliberately.
- **Registry resolution never touches the network.** The registry is a local directory; resolving or installing a skill never makes a network call. It works anywhere `gh skill` and `npx skills` can't: no GitHub access, or no network at all.

## Agent Skills

Agent Skills is an open standard for portable agent capabilities (agentskills.io): a skill is a folder with a `SKILL.md` file, read the same way by every compliant agent. GoodBoy doesn't define its own skill format or compete with that standard — it manages skills that already conform to it, and nothing GoodBoy-specific leaks into `SKILL.md` itself. The rest of the model is familiar from npm or cargo: a local registry holds every version of every skill you've published to it, versions are immutable once created, and `goodboy install` / `goodboy upgrade` move skills between that registry and the places an agent actually looks for them.

## How it works

Every skill GoodBoy manages is described by two separate files, each with a different owner:

- **`SKILL.md`** — what the agent reads. Frontmatter (`name`, `description`) plus instructions in Markdown. This is the open-standard part; it's identical whether or not GoodBoy is involved.
- **`manifest.json`** — what GoodBoy reads. Registry metadata: version, author, license, declared permissions, category. This is GoodBoy's concern, not the agent's.

GoodBoy installs skills into one of two scopes:

- **Project** — `.claude/skills/` inside the current directory, tracked alongside your project (not gitignored by default; pass `--no-commit` if you'd rather exclude the installed files and rely on `goodboy.json` to restore them).
- **Global** — `~/.goodboy/skills/`, symlinked into whichever agents you tell it to (`~/.claude/skills/`, `~/.codex/skills/` — Codex's own skills dir — `~/.agents/skills/` — the shared cross-agent convention — `~/.gemini/skills/`, or all of them with `--all-agents`).

## Installation

```bash
npm install -g @goodboyjs/cli
```

Requires Node.js 24 or higher.

## Quick start

```bash
# Initialise GoodBoy in your project
goodboy init

# Install a skill
goodboy install commit-creation

# List installed skills
goodboy list

# Search available skills
goodboy search git
```

## Commands

### Project setup

| Command | Description |
| --- | --- |
| `goodboy init` | Initialise `goodboy.json` in the current directory |

### Installing skills

| Command | Description |
| --- | --- |
| `goodboy install <name>` | Install at project level |
| `goodboy install <name> --no-commit` | Install, gitignore the skill files |
| `goodboy install -g <name>` | Install globally |
| `goodboy install -g <name> --all-agents` | Install globally and link into all supported agents |
| `goodboy install` | Restore all skills listed in `goodboy.json` |
| `goodboy upgrade [name]` | Upgrade one skill, or all, to the latest registry version |
| `goodboy uninstall <name>` | Remove an installed skill |

### Skill creation

| Command | Description |
| --- | --- |
| `goodboy skill create` | Scaffold a new skill (interactive) |
| `goodboy skill version <name>` | Show version history |
| `goodboy skill version <name> --bump patch\|minor\|major` | Create a new version from the current latest |
| `goodboy skill open <name>` | Open the registry version in `$EDITOR` |
| `goodboy skill diff <name>` | Diff the installed copy against the registry |
| `goodboy skill status` | Show every tracked skill with version and drift state |
| `goodboy verify [skill-name]` | Verify installed skills against their recorded integrity hash (`-g` for global) |

### Discovery

| Command | Description |
| --- | --- |
| `goodboy search <query>` | Search by name, description, or keyword |
| `goodboy list` | List project skills |
| `goodboy list -g` | List global skills |
| `goodboy list --all` | List project and global skills together |

### Registry

| Command | Description |
| --- | --- |
| `goodboy add <path>` | Add and validate a skill |
| `goodboy add <path> --force` | Replace an existing version |
| `goodboy adopt <path>` | Onboard an existing `SKILL.md`-only skill (no `manifest.json`) directly into the local registry |
| `goodboy registry list` | Show registry contents |
| `goodboy registry info <name>` | Show skill details |
| `goodboy registry validate <name>` | Validate skill integrity |
| `goodboy registry remove <name>` | Remove a skill from the registry |

`add` and `adopt` take local filesystem paths only — remote URLs are not
supported; clone or download the skill first, then point either command at
the local directory.

## Shell completion

Tab completion covers subcommands, options, and skill names. Print the
template for your shell and source it — add the line to your rc file to
persist it:

```bash
# bash — the file-based route, which also works on macOS's stock bash 3.2
# (process substitution there can misbehave in interactive sessions)
goodboy completion bash > ~/.goodboy-completion && source ~/.goodboy-completion

# zsh
source <(goodboy completion zsh)

# fish
goodboy completion fish | source
```

With no argument, `goodboy completion` picks the shell from `$SHELL`
(bash is the fallback).

## Skill lifecycle

Treat `.claude/skills/` (and `~/.goodboy/skills/`) the way you'd treat `node_modules/`: GoodBoy owns it, and `goodboy upgrade` will silently overwrite anything you edit there. If you want to change a skill, edit the registry copy, not the installed one.

```bash
# 1. Create a new version in the registry, copied from the current latest
goodboy skill version commit-creation --bump patch

# 2. Open that new version in your editor
goodboy skill open commit-creation

# 3. Make your changes, save, close the editor

# 4. Install the new version
goodboy upgrade commit-creation
```

Registry versions are immutable — `--bump` always creates a new version rather than modifying an existing one. If you're not sure whether an installed copy still matches the registry, `goodboy skill diff <name>` shows the difference and `goodboy skill status` gives you an at-a-glance table across every skill you're tracking.

## Security notice

> **Only install skills from sources you trust.**
>
> GoodBoy does not execute any file bundled with a skill automatically — installing a skill copies files, nothing more. The one place GoodBoy spawns a subprocess is `goodboy skill open`, which launches your own `$EDITOR` on a file you asked to edit. Skills that declare `permissions` in their manifest (`read_files`, `write_files`, `network`, `shell`, `env`) are shown to you for confirmation before install, but those declarations are advisory — GoodBoy does not enforce them.
>
> See [SECURITY.md](SECURITY.md) for the full security model and known limitations.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
