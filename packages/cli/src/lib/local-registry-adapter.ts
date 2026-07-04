import type { RegistryAdapter } from './registry-adapter.js';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  getRegistryPath,
  getSkillsPath,
  resolveSkill,
  listInstalled,
} from './registry.js';
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

  async search(query: string): Promise<GoodBoyManifest[]> {
    let registryPath: string;
    try {
      registryPath = getRegistryPath();
    } catch {
      return [];
    }

    if (!existsSync(registryPath)) return [];

    const queryLower = query.toLowerCase();
    const entries = readdirSync(registryPath, { withFileTypes: true });
    const results: GoodBoyManifest[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(registryPath, entry.name, 'manifest.json');
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
      (Array.isArray(skill.tags) &&
        skill.tags.some((t) => t.toLowerCase().includes(queryLower))) ||
      (skill.category !== undefined && skill.category.toLowerCase().includes(queryLower))
    );
  }
}
