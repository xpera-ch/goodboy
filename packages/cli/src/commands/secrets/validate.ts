import { Command } from 'commander';
import Table from 'cli-table3';
import chalk from 'chalk';
import { loadUserConfig, loadProjectConfig, mergeConfig } from '../../secrets/config.js';
import { createProviderRegistry } from '../../secrets/provider-registry.js';
import { resolveSecrets } from '../../secrets/resolver.js';
import { resolveInstalledSkillSecrets } from '../../secrets/from-skill.js';
import { GoodBoyError } from '../../lib/errors.js';
import { logger, sanitiseError } from '../../lib/logger.js';
import type { GoodBoyConfig } from '../../secrets/config.js';

interface ValidateOptions {
  skill?: string;
  resolve?: boolean;
}

type RowStatus = 'ok' | 'resolved' | 'structural-failure' | 'resolve-failure';

interface ReportRow {
  name: string;
  status: RowStatus;
  detail?: string;
}

type StructuralCheck = { ok: true; providerName: string } | { ok: false; reason: string };

function checkStructural(name: string, config: GoodBoyConfig): StructuralCheck {
  const mapping = config.secrets?.mappings?.[name];
  if (!mapping) {
    return { ok: false, reason: 'no mapping configured' };
  }

  const providerName = mapping.provider ?? config.secrets?.defaultProvider;
  if (!providerName) {
    return { ok: false, reason: 'no provider set on the mapping, and no defaultProvider configured' };
  }

  const providers = config.secrets?.providers ?? {};
  if (!(providerName in providers)) {
    return { ok: false, reason: `provider "${providerName}" is not configured` };
  }

  return { ok: true, providerName };
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function statusLabel(status: RowStatus): string {
  switch (status) {
    case 'ok':
      return chalk.green('ok');
    case 'resolved':
      return chalk.green('resolved');
    case 'structural-failure':
      return chalk.red('invalid');
    case 'resolve-failure':
      return chalk.red('resolve failed');
  }
}

async function run(options: ValidateOptions): Promise<void> {
  const user = await loadUserConfig();
  const project = await loadProjectConfig(process.cwd());
  const config = mergeConfig(user, project);

  let names: string[];
  if (options.skill !== undefined) {
    names = await resolveInstalledSkillSecrets(process.cwd(), options.skill);
    if (names.length === 0) {
      logger.info(`Skill "${options.skill}" declares no secrets.`);
      return;
    }
  } else {
    names = Object.keys(config.secrets?.mappings ?? {});
    if (names.length === 0) {
      logger.info('Nothing configured to validate.');
      return;
    }
  }

  const rows: ReportRow[] = [];
  const structurallyValid: string[] = [];

  for (const name of names) {
    const check = checkStructural(name, config);
    if (check.ok) {
      structurallyValid.push(name);
      rows.push({ name, status: 'ok' });
    } else {
      rows.push({ name, status: 'structural-failure', detail: check.reason });
    }
  }

  if (options.resolve && structurallyValid.length > 0) {
    // Non-null: at least one name passed checkStructural, which only ever
    // returns ok:true after confirming config.secrets.providers has a
    // matching entry — both are therefore guaranteed defined here.
    const registry = createProviderRegistry(config.secrets!.providers!);
    try {
      await resolveSecrets(structurallyValid, config, registry, {});
      for (const row of rows) {
        if (row.status === 'ok') row.status = 'resolved';
      }
    } catch (err) {
      // Non-null: resolveSecrets always populates safeMetadata.failures on
      // E_SECRETS_RESOLUTION_FAILED — see resolver.ts's own contract.
      const failures = (err as GoodBoyError).safeMetadata['failures'] as { name: string; cause: unknown }[];
      const failureByName = new Map(failures.map((f) => [f.name, describeCause(f.cause)]));

      for (const row of rows) {
        if (row.status !== 'ok') continue;
        const detail = failureByName.get(row.name);
        if (detail !== undefined) {
          row.status = 'resolve-failure';
          row.detail = detail;
        } else {
          row.status = 'resolved';
        }
      }
    }
  }

  const table = new Table({
    head: ['Name', 'Status', 'Detail'].map((h) => chalk.bold(h)),
    style: { head: [], border: [] },
  });

  for (const row of rows) {
    table.push([row.name, statusLabel(row.status), row.detail ?? '—']);
  }

  process.stdout.write(table.toString() + '\n');

  const anyFailed = rows.some((r) => r.status === 'structural-failure' || r.status === 'resolve-failure');
  if (anyFailed) {
    process.exitCode = 1;
  }
}

/**
 * Fail-closed — mirrors verify.ts's convention, in deliberate contrast to
 * doctor.ts's informational one: non-zero exit if any checked name has a
 * structural problem, or (with --resolve) failed to actually resolve.
 * Never calls .reveal() or otherwise prints a resolved value; only
 * success/failure per name is ever reported.
 */
export function registerSecretsValidate(program: Command): void {
  program
    .command('validate')
    .description('Validate configured secret mappings (add --resolve to actually attempt resolution)')
    .option('--skill <name>', "Validate only an installed project skill's declared secrets")
    .option('--resolve', 'Attempt to resolve each structurally-valid secret (never prints resolved values)')
    .action(async (options: ValidateOptions) => {
      try {
        await run(options);
      } catch (err) {
        logger.error(sanitiseError(err));
        process.exit(1);
      }
    });
}
