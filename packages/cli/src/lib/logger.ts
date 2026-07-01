import chalk from 'chalk';
import { homedir } from 'node:os';

export const logger = {
  info(msg: string): void {
    process.stdout.write(chalk.gray(msg) + '\n');
  },
  success(msg: string): void {
    process.stderr.write(chalk.green(`✓ ${msg}`) + '\n');
  },
  warn(msg: string): void {
    process.stderr.write(chalk.yellow(`⚠ ${msg}`) + '\n');
  },
  error(msg: string): void {
    process.stderr.write(chalk.red(`✗ ${msg}`) + '\n');
  },
};

function redactHomePath(message: string): string {
  return message.replace(homedir(), '~');
}

export function sanitiseError(error: unknown): string {
  if (error instanceof Error) {
    return redactHomePath(error.message);
  }
  if (typeof error === 'string') {
    return redactHomePath(error);
  }
  return 'An unexpected error occurred';
}
