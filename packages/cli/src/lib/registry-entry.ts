/**
 * Internal module — registry-entry.json read/write and version resolution.
 * @internal
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface RegistryVersionEntry {
  path: string;
  addedAt: string;
  yanked: boolean;
}

export interface RegistryEntry {
  name: string;
  latest: string;
  versions: Record<string, RegistryVersionEntry>;
}

const ENTRY_FILE = 'registry-entry.json';

export async function readRegistryEntry(skillDir: string): Promise<RegistryEntry | null> {
  const entryPath = join(skillDir, ENTRY_FILE);
  try {
    const raw = await readFile(entryPath, 'utf-8');
    return JSON.parse(raw) as RegistryEntry;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeRegistryEntry(skillDir: string, entry: RegistryEntry): Promise<void> {
  const entryPath = join(skillDir, ENTRY_FILE);
  await writeFile(entryPath, JSON.stringify(entry, null, 2) + '\n', 'utf-8');
}

export function createRegistryEntry(
  skillName: string,
  version: string,
  versionPath: string,
): RegistryEntry {
  return {
    name: skillName,
    latest: version,
    versions: {
      [version]: {
        path: versionPath,
        addedAt: new Date().toISOString(),
        yanked: false,
      },
    },
  };
}

export function addVersionToEntry(
  entry: RegistryEntry,
  version: string,
  versionPath: string,
): RegistryEntry {
  return {
    ...entry,
    latest: version,
    versions: {
      ...entry.versions,
      [version]: {
        path: versionPath,
        addedAt: new Date().toISOString(),
        yanked: false,
      },
    },
  };
}

export function resolveLatestVersion(entry: RegistryEntry): string | null {
  const versions = Object.keys(entry.versions).sort((a, b) => {
    const [aMaj = 0, aMin = 0, aPat = 0] = a.split('.').map(Number);
    const [bMaj = 0, bMin = 0, bPat = 0] = b.split('.').map(Number);
    /* c8 ignore next — equal versions are unreachable (Record keys are unique) */
    return (bMaj - aMaj) || (bMin - aMin) || (bPat - aPat);
  });

  for (const ver of versions) {
    if (!entry.versions[ver]!.yanked) return ver;
  }
  return null;
}

export function resolveVersionPath(
  entry: RegistryEntry,
  version: string,
  registrySkillDir: string,
): string {
  const versionEntry = entry.versions[version];
  if (!versionEntry) {
    throw new Error(
      `Version "${version}" not found in registry entry for "${entry.name}"`,
    );
  }
  const { path: vp } = versionEntry;
  if (vp.startsWith('https://') || vp.startsWith('http://')) {
    return vp;
  }
  return join(registrySkillDir, vp);
}
