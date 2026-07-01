import chalk from 'chalk';

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
