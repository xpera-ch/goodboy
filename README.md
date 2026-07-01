# GoodBoy

A personal skill registry and intelligent dispatcher for Claude Code.

GoodBoy lets you package reusable Claude Code skills into versioned, shareable units — each described by a `goodboy.json` manifest — and install them from a central registry with a single command.

## Packages

| Package | Description |
|---|---|
| [`@goodboy/cli`](packages/cli) | Command-line interface (`goodboy` binary) |
| [`@goodboy/schema`](packages/schema) | Canonical manifest schema and TypeScript types |
| [`@goodboy/registry-client`](packages/registry-client) | HTTP client for the public registry (Phase 3) |

## Quick start

```sh
npm install -g @goodboy/cli
goodboy init
goodboy install <skill-name>
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
