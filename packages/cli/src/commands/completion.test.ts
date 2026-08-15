import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lib/completion.js', () => ({
  complete: vi.fn(),
}));
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
  sanitiseError: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

import { complete } from '../lib/completion.js';
import { logger } from '../lib/logger.js';
import {
  completionCommand,
  completeCommand,
  attachProgram,
  BASH_TEMPLATE,
  ZSH_TEMPLATE,
  FISH_TEMPLATE,
} from './completion.js';
import { createCompletionProgram } from '../__fixtures__/completion-program.js';
import { resetCommandOptions } from '../__fixtures__/index.js';

const mockComplete = vi.mocked(complete);
const mockLogger = vi.mocked(logger);

function run(command: typeof completionCommand, argv: string[]) {
  // `{ from: 'user' }` — without it commander slices argv.slice(2),
  // treating argv as [node, script, ...args], and the words never reach
  // the action (add.test.ts uses the same convention).
  return command.parseAsync(argv, { from: 'user' }).catch(() => {});
}

describe('completion command — templates', () => {
  beforeEach(() => {
    resetCommandOptions(completionCommand);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints the exact bash template for an explicit bash argument', async () => {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    await run(completionCommand, ['bash']);
    expect(chunks.join('')).toBe(BASH_TEMPLATE);
  });

  it('prints the exact zsh template for an explicit zsh argument', async () => {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    await run(completionCommand, ['zsh']);
    expect(chunks.join('')).toBe(ZSH_TEMPLATE);
  });

  it('prints the exact fish template for an explicit fish argument', async () => {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    await run(completionCommand, ['fish']);
    expect(chunks.join('')).toBe(FISH_TEMPLATE);
  });

  it('detects zsh from $SHELL', async () => {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    process.env.SHELL = '/bin/zsh';
    await run(completionCommand, []);
    expect(chunks.join('')).toBe(ZSH_TEMPLATE);
  });

  it('detects fish from $SHELL', async () => {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    process.env.SHELL = '/usr/bin/fish';
    await run(completionCommand, []);
    expect(chunks.join('')).toBe(FISH_TEMPLATE);
  });

  it('defaults to bash for a bare $SHELL', async () => {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    process.env.SHELL = 'bash';
    await run(completionCommand, []);
    expect(chunks.join('')).toBe(BASH_TEMPLATE);
  });

  it('defaults to bash when $SHELL is absent', async () => {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    delete process.env.SHELL;
    await run(completionCommand, []);
    expect(chunks.join('')).toBe(BASH_TEMPLATE);
  });

  it('defaults to bash for an unrecognised $SHELL', async () => {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    process.env.SHELL = '/usr/bin/tcsh';
    await run(completionCommand, []);
    expect(chunks.join('')).toBe(BASH_TEMPLATE);
  });

  it('errors on an unknown explicit shell, exit 1', async () => {
    const stderrChunks: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    });
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    await run(completionCommand, ['tcsh']);
    expect(process.exit).toHaveBeenCalledTimes(1);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(stderrChunks.join('')).toContain('Unknown shell: "tcsh"');
  });

  it('every template calls back into __complete, bash/zsh keep file fallback, none carries a banned domain', () => {
    for (const template of [BASH_TEMPLATE, ZSH_TEMPLATE, FISH_TEMPLATE]) {
      expect(template).toContain('goodboy __complete');
    }
    expect(BASH_TEMPLATE).toContain('-o default');
    expect(ZSH_TEMPLATE).toContain('-o default');
    // Built from parts rather than written literally: the repo-wide domain
    // guard sweeps this file too, so the banned strings must not appear as
    // text here — the runtime concatenation still fails if a template ever
    // carries either domain.
    for (const template of [BASH_TEMPLATE, ZSH_TEMPLATE, FISH_TEMPLATE]) {
      expect(template).not.toContain('goodboyjs' + '.io');
      expect(template).not.toContain('goodboy' + '.dev');
    }
  });

  it('registers a single stdout EPIPE guard, even across repeated runs', async () => {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    await run(completionCommand, ['bash']);
    await run(completionCommand, ['bash']);
    expect(process.stdout.listenerCount('error')).toBe(1);
    // An EPIPE on stdout must be swallowed — never an unhandled crash.
    expect(() => process.stdout.emit('error', new Error('EPIPE'))).not.toThrow();
  });
});

describe('__complete command — protocol', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCommandOptions(completeCommand);
    process.exitCode = undefined;
    attachProgram(createCompletionProgram());
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('writes exactly the candidate lines to stdout, nothing else', async () => {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    mockComplete.mockResolvedValue(['skill-a', 'skill-b']);
    await run(completeCommand, ['--', 'install', 'de']);
    expect(chunks.join('')).toBe('skill-a\nskill-b\n');
    expect(process.exitCode).toBeUndefined();
  });

  it('passes option-shaped words through the -- separator verbatim', async () => {
    const program = createCompletionProgram();
    attachProgram(program);
    mockComplete.mockResolvedValue([]);
    await run(completeCommand, ['--', 'install', '-g', '--c']);
    expect(mockComplete).toHaveBeenCalledWith(program, ['install', '-g', '--c']);
  });

  it('writes nothing on an empty candidate list', async () => {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    mockComplete.mockResolvedValue([]);
    await run(completeCommand, ['--', 'install', 'zzz']);
    expect(chunks.join('')).toBe('');
  });

  it('swallows an engine failure and writes nothing', async () => {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    mockComplete.mockRejectedValue(new Error('engine exploded'));
    await run(completeCommand, ['--', 'install', '']);
    expect(chunks.join('')).toBe('');
    expect(process.exitCode).toBeUndefined();
  });

  it('writes nothing when no program is attached and never calls the engine', async () => {
    attachProgram(null);
    const chunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    await run(completeCommand, ['--', 'install', '']);
    expect(chunks.join('')).toBe('');
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('never touches the logger', async () => {
    mockComplete.mockResolvedValue(['skill-a']);
    await run(completeCommand, ['--', 'install', '']);
    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.info).not.toHaveBeenCalled();
    expect(mockLogger.success).not.toHaveBeenCalled();
  });

  it('registers a single stdout EPIPE guard, even across repeated runs', async () => {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    mockComplete.mockResolvedValue(['skill-a']);
    await run(completeCommand, ['--', 'install', '']);
    await run(completeCommand, ['--', 'install', '']);
    expect(process.stdout.listenerCount('error')).toBe(1);
    // An EPIPE on stdout must be swallowed — never an unhandled crash.
    expect(() => process.stdout.emit('error', new Error('EPIPE'))).not.toThrow();
  });
});
