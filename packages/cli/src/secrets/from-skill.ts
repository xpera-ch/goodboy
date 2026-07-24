import { join } from 'node:path';
import { readGoodBoyJson } from '../lib/goodboy-file.js';
import { readManifest, validateManifest } from '../lib/manifest.js';
import { GoodBoyError } from '../lib/errors.js';

/**
 * D5: resolves an installed *project* skill's declared requires.secrets, by
 * name, against goodboy.json. Deterministic and narrow — no registry
 * lookup, no global-scope fallback, no raw path argument. An absent
 * `requires` field (or an absent/empty `secrets` array) is not an error:
 * it just means the skill declares no secret requirements.
 */
export async function resolveInstalledSkillSecrets(cwd: string, skillName: string): Promise<string[]> {
  const goodboy = await readGoodBoyJson(cwd);
  if (!goodboy) {
    throw new GoodBoyError(`No goodboy.json found in "${cwd}". Run \`goodboy init\` first.`, {
      code: 'E_SKILL_PROJECT_NOT_FOUND',
      safeMetadata: { cwd },
    });
  }

  if (!(skillName in goodboy.skills)) {
    throw new GoodBoyError(`Skill "${skillName}" is not installed in this project.`, {
      code: 'E_SKILL_NOT_INSTALLED',
      safeMetadata: { skillName },
    });
  }

  const manifestPath = join(cwd, '.claude', 'skills', skillName, 'manifest.json');

  let manifest;
  try {
    const data = await readManifest(manifestPath);
    manifest = validateManifest(data);
  } catch (err) {
    throw new GoodBoyError(
      `Failed to read installed skill "${skillName}"'s manifest — it may be missing or corrupt.`,
      { code: 'E_SKILL_MANIFEST_UNREADABLE', cause: err, safeMetadata: { skillName } },
    );
  }

  return manifest.requires?.secrets ?? [];
}
