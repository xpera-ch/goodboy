# @goodboyjs/cli

The GoodBoy command-line interface — a personal skill manager, registry and
installer for AI agents built on the [Agent Skills](https://agentskills.io)
standard.

[![CI](https://github.com/xpera-ch/goodboy/actions/workflows/ci.yml/badge.svg)](https://github.com/xpera-ch/goodboy/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/xpera-ch/goodboy/blob/main/LICENSE)

## Why GoodBoy

Installing and pinning skills is a solved problem. The harder question is what
you actually have: an installed skill that silently no longer matches what you
meant to install — edited by hand, drifted across projects and machines — is a
skill you can't trust. `gh skill` and `npx skills` tell you when a newer
version exists; neither asks whether the copy on disk is still the one you
installed.

GoodBoy does the same basic install job as those two tools and isn't trying to
out-compete them there. What's different:

- **Local integrity verification that fails closed.** `goodboy verify`
  recomputes the content hash recorded at install time and reports any
  mismatch; `goodboy skill status` shows every tracked skill with its version
  and drift state at a glance.
- **A personal private registry with immutable versions.**
  `~/.goodboy/registry` holds every version of every skill you have published
  to it, and versions are immutable once created.
- **Registry resolution never touches the network.** The registry is a local
  directory; resolving or installing a skill never makes a network call.

## Installation

```sh
npm install -g @goodboyjs/cli
```

Requires Node.js 24 or higher.

## Quick start

```sh
goodboy init                     # initialise goodboy.json in your project
goodboy install commit-creation  # install a skill
goodboy list                     # list installed skills
goodboy verify                   # check installed skills against their hashes
```

## Common commands

| Command | Description |
| --- | --- |
| `goodboy init` | Initialise `goodboy.json` in the current directory |
| `goodboy install <name>` | Install at project level |
| `goodboy install -g <name>` | Install globally |
| `goodboy upgrade [name]` | Upgrade one skill, or all, to the latest registry version |
| `goodboy uninstall <name>` | Remove an installed skill |
| `goodboy verify [skill-name]` | Verify installed skills against their recorded integrity hash (`-g` for global) |
| `goodboy skill status` | Show every tracked skill with version and drift state |
| `goodboy skill diff <name>` | Diff the installed copy against the registry |
| `goodboy add <path>` | Add and validate a skill in the local registry |
| `goodboy search <query>` | Search by name, description, or keyword |

Full command reference, including skill authoring and registry management:
[github.com/xpera-ch/goodboy](https://github.com/xpera-ch/goodboy#commands)

## Security

> **Only install skills from sources you trust.**
>
> GoodBoy does not execute any file bundled with a skill automatically —
> installing a skill copies files, nothing more. Skills that declare
> `permissions` in their manifest are shown for confirmation before install,
> but those declarations are advisory: GoodBoy does not enforce them.

See
[SECURITY.md](https://github.com/xpera-ch/goodboy/blob/main/SECURITY.md)
for the full security model and known limitations.

## Links

- [Repository and full documentation](https://github.com/xpera-ch/goodboy)
- [Report an issue](https://github.com/xpera-ch/goodboy/issues)
- [Changelog](https://github.com/xpera-ch/goodboy/blob/main/CHANGELOG.md)
- [Contributing](https://github.com/xpera-ch/goodboy/blob/main/CONTRIBUTING.md)

## License

MIT — see
[LICENSE](https://github.com/xpera-ch/goodboy/blob/main/LICENSE).
