# @goodboy/cli

The GoodBoy command-line interface.

## Installation

```sh
npm install -g @goodboy/cli
```

## Commands

| Command | Description |
|---|---|
| `goodboy init` | Initialise GoodBoy in the current directory (creates `goodboy.json`) |
| `goodboy skill create` | Create a new skill (`manifest.json`, `SKILL.md`, scaffold dirs) |
| `goodboy install <name>` | Install a skill from the registry |
| `goodboy list` | List installed skills |
| `goodboy search <query>` | Search the public registry |

## Development

```sh
npm run build   # compile TypeScript → dist/
npm run dev     # run from source with ts-node
```
