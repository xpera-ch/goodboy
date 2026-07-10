import type { GoodBoyManifest } from '../types/index.js';
import type { RegistryEntry } from './registry-entry.js';
import { LocalRegistryAdapter } from './local-registry-adapter.js';

/**
 * RegistryAdapter defines the contract between GoodBoy commands
 * and any registry implementation.
 *
 * Phase 1: implemented by LocalRegistryAdapter (git-based)
 * Phase 3: implemented by RemoteRegistryAdapter (@goodboyjs/registry-client)
 *
 * Commands must only import this interface — never a concrete adapter.
 * This ensures the Phase 3 swap requires zero changes to command code.
 */
export interface RegistryAdapter {
  /**
   * Resolve a skill by name and return its filesystem path.
   * Throws if the skill is not found or name is invalid.
   */
  resolveSkill(name: string): Promise<string>;

  /**
   * Return manifests for all installed skills.
   * Skips silently any skill with a missing or invalid manifest.
   */
  listInstalled(): Promise<GoodBoyManifest[]>;

  /**
   * Search available skills by query string.
   * Matches against name, description, and keywords.
   * Case insensitive.
   */
  search(query: string): Promise<GoodBoyManifest[]>;

  /**
   * Return the resolved registry path or remote base URL.
   * Used for display and diagnostic purposes only.
   * May throw if GOODBOY_REGISTRY is set but invalid.
   */
  getRegistryLocation(): string;

  /**
   * Return the resolved skills installation path.
   * Used for display and diagnostic purposes only.
   */
  getSkillsLocation(): string;

  /**
   * Return all entries in the local registry.
   * Returns [] if the registry does not exist or cannot be read.
   */
  listRegistry(): Promise<RegistryEntry[]>;
}

/**
 * Returns the appropriate RegistryAdapter for the current phase.
 *
 * Phase 1: always returns LocalRegistryAdapter.
 * Phase 3: will inspect config or environment to decide between
 * LocalRegistryAdapter and RemoteRegistryAdapter.
 *
 * Commands must use this factory — never instantiate adapters directly.
 */
export function createRegistryAdapter(): RegistryAdapter {
  // Phase 1: local registry only
  // Phase 3: return RemoteRegistryAdapter when GOODBOY_REGISTRY_URL is set
  return new LocalRegistryAdapter();
}
