import { Command } from 'commander';
import { complete } from '../lib/completion.js';

/**
 * Hidden `completion` and `__complete` commands powering shell
 * tab-completion. `completion` prints a fixed template for the shell it is
 * sourced from; `__complete` is the protocol those templates call back into
 * (docs/decisions.md, 2026-08-15). Both register with `{ hidden: true }` in
 * index.ts — callable, invisible in --help.
 */

// The `--` before the words is deliberate: without it, commander would treat
// option-shaped words (`install -g`, `--c`) as unknown options of the
// `__complete` command and exit 1 on every such completion — which breaks
// the shell. `--` is commander's end-of-options marker; everything after it
// reaches the variadic argument verbatim.

export const BASH_TEMPLATE = `_goodboy_complete() {
  COMPREPLY=($(goodboy __complete -- "\${COMP_WORDS[@]:1:$COMP_CWORD}"))
}
complete -o default -F _goodboy_complete goodboy
`;

export const ZSH_TEMPLATE = `#compdef goodboy
autoload -U bashcompinit && bashcompinit

_goodboy_complete() {
  COMPREPLY=($(goodboy __complete -- "\${COMP_WORDS[@]:1:$COMP_CWORD}"))
}
complete -o default -F _goodboy_complete goodboy
`;

export const FISH_TEMPLATE = `function __goodboy_complete
  goodboy __complete -- (commandline -opc)
end
complete -c goodboy -f -a "(__goodboy_complete)"
`;

const TEMPLATES: Readonly<Record<string, string>> = {
  bash: BASH_TEMPLATE,
  zsh: ZSH_TEMPLATE,
  fish: FISH_TEMPLATE,
};

/** A shell closing the stdout pipe early (e.g. bash 3.2's process
 * substitution closing the read end mid-write — observed while dogfooding)
 * makes node emit an unhandled 'error' on process.stdout — a crash dump
 * right on the user's terminal, mid-completion. Completion must never do
 * that; EPIPE on a completion write is "nothing to complete", not a
 * failure. The noop listener stops node from crashing on it. The listener
 * is registered at most once — repeated action invocations in one process
 * (as in the test suite) would otherwise stack listeners and trip
 * MaxListenersExceededWarning. */
function guardStdout(): void {
  if (process.stdout.listenerCount('error') === 0) {
    process.stdout.on('error', () => {});
  }
}

/** The typed words including the partial current word, from the shell. */
export const completionCommand = new Command('completion')
  .description('Print a shell completion script (bash, zsh, or fish)')
  .argument('[shell]', 'Shell to generate a completion script for (default: from $SHELL)')
  .action((shell?: string) => {
    guardStdout();
    const name = shell ?? detectShell(process.env.SHELL);
    const template = TEMPLATES[name];
    if (template === undefined) {
      process.stderr.write(
        `Unknown shell: "${name}". Supported shells: bash, zsh, fish.\n`,
      );
      process.exit(1);
    }
    process.stdout.write(template);
  });

export const completeCommand = new Command('__complete')
  .argument('[words...]', 'Typed words including the partial current word')
  .action(async (words: string[]) => {
    guardStdout();
    try {
      const candidates = programRef ? await complete(programRef, words) : [];
      if (candidates.length > 0) {
        process.stdout.write(`${candidates.join('\n')}\n`);
      }
    } catch {
      // Completion must never crash the shell — degrade to no output.
    }
  });

/** Match on the trailing shell name; anything unrecognised → bash. */
function detectShell(shellEnv: string | undefined): string {
  const base = shellEnv?.split('/').pop() ?? '';
  if (base === 'zsh') return 'zsh';
  if (base === 'fish') return 'fish';
  return 'bash';
}

let programRef: Command | null = null;

/** index.ts hands the assembled program to the protocol command — it cannot
 * import index.ts's instance, and the command file must stay thin. Passing
 * null detaches (used by tests). */
export function attachProgram(program: Command | null): void {
  programRef = program;
}
