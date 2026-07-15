# GoodBoy

A personal skill registry and package manager for Claude Code and the Agent Skills ecosystem.

[![CI](https://github.com/xpera-ch/goodboy/actions/workflows/ci.yml/badge.svg)](https://github.com/xpera-ch/goodboy/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](package.json)

## What is GoodBoy

A skill for Claude Code — or any agent that supports the Agent Skills standard — is just a folder with a `SKILL.md` file. That's deliberately minimal, but it leaves a gap: there's no standard way to install one, keep it up to date, roll it back, or share it with a team. Skills tend to accumulate as copy-pasted folders with no version history and no way to tell whether the copy sitting in `.claude/skills/` still matches the one you meant to install. GoodBoy fills that gap.

Agent Skills is an open standard for portable agent capabilities, published by Anthropic and adopted across the ecosystem — Claude Code, Codex CLI, Gemini CLI, Cursor, and others all read the same `SKILL.md` format (see [agentskills.io](https://agentskills.io)). GoodBoy doesn't define its own skill format or compete with that standard; it manages skills that already conform to it. A skill you install with GoodBoy is a plain, standard skill — nothing GoodBoy-specific leaks into `SKILL.md` itself.

The rest of the model will be familiar if you've used npm, cargo, or any other package manager: a local registry holds every version of every skill you've published to it, versions are immutable once created, and `goodboy install` / `goodboy upgrade` move skills between that registry and the places an agent actually looks for them.

## How it works

Every skill GoodBoy manages is described by two separate files, each with a different owner:

- **`SKILL.md`** — what the agent reads. Frontmatter (`name`, `description`) plus instructions in Markdown. This is the open-standard part; it's identical whether or not GoodBoy is involved.
- **`manifest.json`** — what GoodBoy reads. Registry metadata: version, author, license, declared permissions, category. This is GoodBoy's concern, not the agent's.

GoodBoy installs skills into one of two scopes:

- **Project** — `.claude/skills/` inside the current directory, tracked alongside your project (not gitignored by default; pass `--no-commit` if you'd rather exclude the installed files and rely on `goodboy.json` to restore them).
- **Global** — `~/.goodboy/skills/`, symlinked into whichever agents you tell it to (`~/.claude/skills/`, `~/.codex/skills/`, `~/.gemini/skills/`, or all of them with `--all-agents`).

## Installation

```bash
npm install -g @goodboyjs/cli
```

Requires Node.js 20.12 or higher.

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
| `goodboy init --registry <url>` | Initialise with a custom registry URL |

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
| `goodboy registry list` | Show registry contents |
| `goodboy registry info <name>` | Show skill details |
| `goodboy registry validate <name>` | Validate skill integrity |
| `goodboy registry remove <name>` | Remove a skill from the registry |

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

Registry versions are immutable — `--bump` always creates a new version rather than modifying an existing one. If you're not sure whether an installed skill still matches the registry (someone edited it directly, or you're not sure what you last installed), `goodboy skill diff <name>` shows the difference and `goodboy skill status` gives you an at-a-glance table across every skill you're tracking.

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
