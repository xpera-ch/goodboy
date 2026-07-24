import { Command } from 'commander';
import Table from 'cli-table3';
import chalk from 'chalk';
import { loadUserConfig, loadProjectConfig, mergeConfig } from '../../secrets/config.js';
import { maskReference } from '../../secrets/reference-masking.js';
import { logger, sanitiseError } from '../../lib/logger.js';

const NO_PROVIDER_MARKER = 'no provider';

async function run(): Promise<void> {
  const user = await loadUserConfig();
  const project = await loadProjectConfig(process.cwd());
  const config = mergeConfig(user, project);

  const mappings = config.secrets?.mappings;
  if (!mappings || Object.keys(mappings).length === 0) {
    logger.info('No secrets configured. Add a mapping to ~/.goodboy/config.json or goodboy.local.json.');
    return;
  }

  const providers = config.secrets?.providers ?? {};

  const table = new Table({
    head: ['Name', 'Provider', 'Reference'].map((h) => chalk.bold(h)),
    style: { head: [], border: [] },
  });

  for (const [name, mapping] of Object.entries(mappings)) {
    const providerName = mapping.provider ?? config.secrets?.defaultProvider;
    const providerType = providerName !== undefined ? providers[providerName]?.type : undefined;

    table.push([
      name,
      providerName ?? chalk.red(NO_PROVIDER_MARKER),
      maskReference(mapping.reference, providerType),
    ]);
  }

  process.stdout.write(table.toString() + '\n');
}

/**
 * Read-only display: NAME / PROVIDER / masked REFERENCE. Never constructs a
 * ProviderRegistry, never calls getProvider/checkAvailability/resolve —
 * this command touches config only, never provider code.
 */
export function registerSecretsList(program: Command): void {
  program
    .command('list')
    .description('List configured secret mappings (references are masked, values are never shown)')
    .action(async () => {
      try {
        await run();
      } catch (err) {
        logger.error(sanitiseError(err));
        process.exit(1);
      }
    });
}
