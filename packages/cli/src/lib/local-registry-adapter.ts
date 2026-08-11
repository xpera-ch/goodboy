import type { RegistryAdapter } from './registry-adapter.js';
import { join } from 'node:path';
import {
  getRegistryPath,
  getSkillsPath,
  resolveSkill,
  listInstalled,
  listRegistry,
} from './registry.js';
import { resolveLatestVersion, resolveVersionPath } from './registry-entry.js';
import type { RegistryEntry } from './registry-entry.js';
import { readManifest, validateManifest } from './manifest.js';
import { logger } from './logger.js';
import type { GoodBoyManifest } from '../types/index.js';

/**
 * Phase 1 implementation of RegistryAdapter.
 * Resolves skills from a local git-based registry.
 * Configured via GOODBOY_REGISTRY environment variable.
 * Replace with RemoteRegistryAdapter in Phase 3.
 */
export class LocalRegistryAdapter implements RegistryAdapter {
  resolveSkill(name: string): Promise<string> {
    return resolveSkill(name);
  }

  listInstalled(): Promise<GoodBoyManifest[]> {
    return listInstalled();
  }

  listRegistry(): Promise<RegistryEntry[]> {
    return listRegistry();
  }

  async search(query: string): Promise<GoodBoyManifest[]> {
    let entries: RegistryEntry[];
    let registryPath: string;
    try {
      entries = await listRegistry();
      registryPath = getRegistryPath();
    } catch (err) {
      // Same class as F1: returning [] here made a misconfigured
      // GOODBOY_REGISTRY (non-absolute, or containing "..") indistinguishable
      // from a registry that simply holds no match. The per-entry catch below
      // already warns; the registry-level one must too.
      logger.warn(
        `Cannot read the registry: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      return [];
    }

    if (entries.length === 0) return [];

    const queryLower = query.toLowerCase();
    const results: GoodBoyManifest[] = [];

    for (const entry of entries) {
      const latestVersion = resolveLatestVersion(entry);
      if (!latestVersion) continue;

      const skillDir = join(registryPath, entry.name);
      const versionPath = resolveVersionPath(entry, latestVersion, skillDir);
      const manifestPath = join(versionPath, 'manifest.json');

      try {
        const data = await readManifest(manifestPath);
        const manifest = validateManifest(data);
        if (this.matchesQuery(manifest, queryLower)) {
          results.push(manifest);
        }
      } catch (err) {
        logger.warn(
          `Skipping "${entry.name}": ${err instanceof Error ? err.message : 'invalid manifest'}`,
        );
      }
    }

    return results;
  }

  getRegistryLocation(): string {
    return getRegistryPath();
  }

  getSkillsLocation(): string {
    return getSkillsPath();
  }

  private matchesQuery(skill: GoodBoyManifest, queryLower: string): boolean {
    return (
      skill.name.toLowerCase().includes(queryLower) ||
      skill.description.toLowerCase().includes(queryLower) ||
      (Array.isArray(skill.keywords) &&
        skill.keywords.some((kw) => kw.toLowerCase().includes(queryLower))) ||
      (skill.category !== undefined && skill.category.toLowerCase().includes(queryLower))
    );
  }
}
