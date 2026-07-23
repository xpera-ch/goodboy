import chalk from 'chalk';
import { homedir } from 'node:os';
import { redact } from './redact.js';

export const logger = {
  info(msg: string): void {
    process.stdout.write(chalk.gray(redact(msg)) + '\n');
  },
  success(msg: string): void {
    process.stderr.write(chalk.green(`✓ ${redact(msg)}`) + '\n');
  },
  warn(msg: string): void {
    process.stderr.write(chalk.yellow(`⚠ ${redact(msg)}`) + '\n');
  },
  error(msg: string): void {
    process.stderr.write(chalk.red(`✗ ${redact(msg)}`) + '\n');
  },
};

function redactHomePath(message: string): string {
  return message.replace(homedir(), '~');
}

export function sanitiseError(error: unknown): string {
  if (error instanceof Error) {
    return redact(redactHomePath(error.message));
  }
  if (typeof error === 'string') {
    return redact(redactHomePath(error));
  }
  return 'An unexpected error occurred';
}
