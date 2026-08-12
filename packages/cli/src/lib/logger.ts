import chalk from 'chalk';
import { homedir } from 'node:os';

/**
 * Strips C0 control characters and DEL from `msg`, keeping `\n` and `\t`.
 * Every ANSI/CSI/OSC escape sequence requires a leading ESC (\x1B) byte, so
 * removing it neutralizes the sequence into inert literal text rather than
 * attempting to parse/allowlist specific sequences.
 */
function stripControlChars(msg: string): string {
  // eslint-disable-next-line no-control-regex
  return msg.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '');
}

function clean(msg: string): string {
  return stripControlChars(msg);
}

export const logger = {
  info(msg: string): void {
    process.stdout.write(chalk.gray(clean(msg)) + '\n');
  },
  success(msg: string): void {
    process.stderr.write(chalk.green(`✓ ${clean(msg)}`) + '\n');
  },
  warn(msg: string): void {
    process.stderr.write(chalk.yellow(`⚠ ${clean(msg)}`) + '\n');
  },
  error(msg: string): void {
    process.stderr.write(chalk.red(`✗ ${clean(msg)}`) + '\n');
  },
};

function redactHomePath(message: string): string {
  return message.replace(homedir(), '~');
}

export function sanitiseError(error: unknown): string {
  if (error instanceof Error) {
    return redactHomePath(stripControlChars(error.message));
  }
  if (typeof error === 'string') {
    return redactHomePath(stripControlChars(error));
  }
  return 'An unexpected error occurred';
}
