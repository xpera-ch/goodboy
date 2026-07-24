import { Command } from 'commander';
import Table from 'cli-table3';
import chalk from 'chalk';
import { loadUserConfig, loadProjectConfig, mergeConfig } from '../../secrets/config.js';
import { createProviderRegistry } from '../../secrets/provider-registry.js';
import { logger, sanitiseError } from '../../lib/logger.js';

interface DoctorRow {
  name: string;
  type: string;
  available: boolean;
  detail?: string;
}

async function run(): Promise<void> {
  const user = await loadUserConfig();
  const project = await loadProjectConfig(process.cwd());
  const config = mergeConfig(user, project);

  const providers = config.secrets?.providers;
  if (!providers || Object.keys(providers).length === 0) {
    logger.info(
      'No secret providers configured. Add one to ~/.goodboy/config.json or goodboy.local.json.',
    );
    return;
  }

  const registry = createProviderRegistry(providers);
  const rows: DoctorRow[] = [];

  for (const [name, providerConfig] of Object.entries(providers)) {
    const provider = registry.getProvider(name);
    const status = await provider.checkAvailability({});
    rows.push({ name, type: providerConfig.type, available: status.available, detail: status.detail });
  }

  const table = new Table({
    head: ['Instance', 'Type', 'Available', 'Detail'].map((h) => chalk.bold(h)),
    style: { head: [], border: [] },
  });

  for (const row of rows) {
    table.push([
      row.name,
      row.type,
      row.available ? chalk.green('yes') : chalk.red('no'),
      row.detail ?? '—',
    ]);
  }

  process.stdout.write(table.toString() + '\n');
}

/**
 * Informational only — mirrors skill-status.ts's convention, not
 * verify.ts's fail-closed one. Always exits 0 regardless of how many
 * configured providers report unavailable: this is a diagnostic report
 * for a human to read, not a gate.
 */
export function registerSecretsDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Check configured secret providers for availability')
    .action(async () => {
      try {
        await run();
      } catch (err) {
        logger.error(sanitiseError(err));
        process.exit(1);
      }
    });
}
