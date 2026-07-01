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
goodboy init        # create manifest.json in the current directory
goodboy install <skill-name>
goodboy list
goodboy search <query>
```

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
