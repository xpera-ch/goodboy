import { confirm } from '@inquirer/prompts';
import type { GoodBoyManifest } from '../types/index.js';
import { logger } from './logger.js';

type Permission = NonNullable<GoodBoyManifest['permissions']>[number];

// Exhaustiveness enforced at compile time: if the schema's permissions enum grows,
// adding the missing key here becomes required to compile. The runtime guard in
// summarizePermissions() is the backstop for when types are stale (schema changed
// but generate:types was not re-run).
const PERMISSION_LABELS: Record<Permission, string> = {
  read_files:  'Read files on disk',
  write_files: 'Write files on disk',
  network:     'Access the network',
  shell:       'Run shell commands',
  env:         'Read environment variables',
};

// Fixed output order matches schema enum declaration order, independent of object key order.
const PERMISSION_ORDER: readonly Permission[] = [
  'read_files', 'write_files', 'network', 'shell', 'env',
];

export function summarizePermissions(manifest: GoodBoyManifest): string[] {
  const perms = manifest.permissions ?? [];

  // Runtime backstop against schema/type drift: if the schema gains a new permission
  // value but generate:types has not been re-run, Ajv will accept the new value while
  // PERMISSION_LABELS has no entry for it. Throw rather than silently omit it from
  // the consent display — a missing permission in the prompt is worse than a crash.
  for (const p of perms) {
    if ((PERMISSION_LABELS as Record<string, string | undefined>)[p] === undefined) {
      throw new Error(
        `Unknown permission value in manifest: "${p}". ` +
        `This likely means the schema was updated without regenerating types — run npm run generate:types.`,
      );
    }
  }

  return PERMISSION_ORDER
    .filter((p) => perms.includes(p))
    .map((p) => PERMISSION_LABELS[p]);
}

export async function requestConsent(manifest: GoodBoyManifest): Promise<boolean> {
  const permissionLines = summarizePermissions(manifest);

  if (permissionLines.length === 0) return true;

  logger.info('');
  logger.info(`Skill "${manifest.name}" requests the following permissions:`);
  for (const line of permissionLines) {
    logger.info(`  • ${line}`);
  }
  logger.info('');

  return confirm({
    message: `Allow "${manifest.name}" to install with these permissions?`,
    default: false,
  });
}
