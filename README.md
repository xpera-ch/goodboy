# GoodBoy

A personal skill registry and intelligent dispatcher for Claude Code.

GoodBoy lets you package reusable Claude Code skills into versioned, shareable units — each described by a `manifest.json` — and install them from a central registry with a single command.

## Packages

| Package | Description |
|---|---|
| [`@goodboy/cli`](packages/cli) | Command-line interface (`goodboy` binary) |
| [`@goodboy/schema`](packages/schema) | Canonical manifest schema and TypeScript types |
| [`@goodboy/registry-client`](packages/registry-client) | HTTP client for the public registry (Phase 3) |

## Quick start

```sh
npm install -g @goodboy/cli
goodboy init                    # create goodboy.json in the current directory
goodboy skill create            # scaffold a new skill (manifest.json + SKILL.md)
goodboy install <skill-name>
goodboy list
goodboy search <query>
```

## Commands

### Project setup

| Command | Description |
|---|---|
| `goodboy init` | Initialise a project (creates `goodboy.json`) |
| `goodboy init --registry <url>` | Initialise with a custom registry URL |

### Skill management

| Command | Description |
|---|---|
| `goodboy skill create` | Scaffold a new skill (`manifest.json`, `SKILL.md`, `scripts/`, `references/`, `assets/`) |
| `goodboy add <path>` | Add a local skill directory to the registry |
| `goodboy install <name>` | Install a skill from the registry |
| `goodboy install` | Restore all skills from `goodboy.json` |
| `goodboy install -g <name>` | Install a skill globally |
| `goodboy upgrade [name]` | Upgrade one or all installed skills |
| `goodboy uninstall <name>` | Remove an installed skill |

### Discovery

| Command | Description |
|---|---|
| `goodboy search <query>` | Search the registry |
| `goodboy list` | List project skills |
| `goodboy list -g` | List global skills |

### Registry

| Command | Description |
|---|---|
| `goodboy registry list` | Show registry contents |
| `goodboy registry info <name>` | Show skill details |
| `goodboy registry validate <name>` | Validate skill integrity |
| `goodboy registry remove <name>` | Remove a skill from the registry |

## Security notice

> **Only install skills from sources you trust.**
>
> Skill lifecycle hooks (`preinstall`, `postinstall`) run as your operating-system user with full filesystem and network access. There is no sandboxing in Phase 1. A malicious skill can read, write, or delete any file you own and make outbound network requests.
>
> See [SECURITY.md](SECURITY.md) for the full list of Phase 1 known limitations.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
