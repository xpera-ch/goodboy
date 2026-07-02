import { confirm } from '@inquirer/prompts';
import type { GoodBoyManifest, ExecutableSkillManifest } from '../types/index.js';
import { logger } from './logger.js';

type Permission = NonNullable<ExecutableSkillManifest['permissions']>[number];

// Exhaustiveness enforced at compile time: if the schema's permissions enum grows,
// adding the missing key here becomes required to compile. Silent fallback (showing
// the raw enum string) would be worse than a compile error in a live consent prompt.
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
  if (manifest.kind === 'passive') return [];
  const perms = manifest.permissions ?? [];
  return PERMISSION_ORDER
    .filter((p) => perms.includes(p))
    .map((p) => PERMISSION_LABELS[p]);
}

export async function requestConsent(manifest: GoodBoyManifest): Promise<boolean> {
  const lines = summarizePermissions(manifest);
  if (lines.length === 0) return true;

  logger.info('');
  logger.info(`Skill "${manifest.name}" requests the following permissions:`);
  for (const line of lines) {
    logger.info(`  • ${line}`);
  }
  logger.info('');

  return confirm({
    message: `Allow "${manifest.name}" to install with these permissions?`,
    default: false,
  });
}
