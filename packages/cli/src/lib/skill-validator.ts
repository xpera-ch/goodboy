import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readManifest, validateManifestDetailed } from './manifest.js';
import type { ManifestValidationResult } from './manifest.js';
import { logger } from './logger.js';

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  severity: ValidationSeverity;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export function parseFrontmatter(content: string): {
  name?: string;
  description?: string;
  license?: string;
  hasDelimiters: boolean;
  hasClosingDelimiter: boolean;
  body: string;
} {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { hasDelimiters: false, hasClosingDelimiter: false, body: content };
  }

  const closeIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (closeIdx === -1) {
    return { hasDelimiters: true, hasClosingDelimiter: false, body: '' };
  }

  const frontmatterLines = lines.slice(1, closeIdx);
  const body = lines.slice(closeIdx + 1).join('\n').trim();

  const result: { name?: string; description?: string; license?: string } = {};
  for (const line of frontmatterLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key === 'name') result.name = value;
    if (key === 'description') result.description = value;
    if (key === 'license') result.license = value;
  }

  return { ...result, hasDelimiters: true, hasClosingDelimiter: true, body };
}

export async function validateSkillDirectory(skillPath: string): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];

  // --- manifest.json checks ---
  const manifestPath = join(skillPath, 'manifest.json');
  let manifest: ManifestValidationResult['manifest'] | null = null;

  if (!existsSync(manifestPath)) {
    issues.push({ severity: 'error', message: 'manifest.json not found' });
  } else {
    try {
      const raw = await readManifest(manifestPath);
      try {
        const detailed = validateManifestDetailed(raw);
        manifest = detailed.manifest;
        for (const warning of detailed.warnings) {
          issues.push({ severity: 'warning', message: warning });
        }
      } catch (err) {
        /* c8 ignore next */
        const msg = err instanceof Error ? err.message : String(err);
        issues.push({ severity: 'error', message: `manifest.json fails schema validation: ${msg}` });
      }
    } catch (err) {
      /* c8 ignore next */
      const msg = err instanceof Error ? err.message : String(err);
      issues.push({ severity: 'error', message: `manifest.json is not valid JSON: ${msg}` });
    }
  }

  // manifest field warnings (only if manifest was valid)
  if (manifest) {
    if (manifest.description.length < 20) {
      issues.push({ severity: 'warning', message: 'manifest description is very short (< 20 characters)' });
    }
    if (!manifest.keywords || manifest.keywords.length === 0) {
      issues.push({ severity: 'warning', message: 'manifest has no keywords' });
    }
    if (!manifest.category) {
      issues.push({ severity: 'warning', message: 'manifest has no category' });
    }
    if (!manifest.tags || manifest.tags.length === 0) {
      issues.push({ severity: 'warning', message: 'manifest has no tags' });
    }
    const secretCount = manifest.requires?.secrets.length ?? 0;
    if (secretCount > 0) {
      issues.push({
        severity: 'info',
        message: `declares ${secretCount} required secret${secretCount === 1 ? '' : 's'}`,
      });
    }
  }

  // --- SKILL.md checks ---
  const skillMdPath = join(skillPath, 'SKILL.md');

  if (!existsSync(skillMdPath)) {
    issues.push({ severity: 'error', message: 'SKILL.md not found' });
  } else {
    const content = await readFile(skillMdPath, 'utf-8');
    const fm = parseFrontmatter(content);

    if (!fm.hasDelimiters) {
      issues.push({ severity: 'error', message: 'SKILL.md has no frontmatter (missing opening --- delimiter)' });
    } else if (!fm.hasClosingDelimiter) {
      issues.push({ severity: 'error', message: 'SKILL.md frontmatter is not closed (missing closing --- delimiter)' });
    } else {
      if (!fm.name) {
        issues.push({ severity: 'error', message: 'SKILL.md frontmatter is missing the name field' });
      }
      if (!fm.description) {
        issues.push({ severity: 'error', message: 'SKILL.md frontmatter is missing the description field' });
      }
      if (manifest && fm.name && fm.name !== manifest.name) {
        issues.push({
          severity: 'error',
          message: `SKILL.md frontmatter name "${fm.name}" does not match manifest.json name "${manifest.name}"`,
        });
      }
      if (manifest && fm.license && fm.license !== manifest.license) {
        issues.push({
          severity: 'error',
          message: `SKILL.md frontmatter license "${fm.license}" does not match manifest.json license "${manifest.license}"`,
        });
      }
      if (fm.body.length < 50) {
        issues.push({ severity: 'warning', message: 'SKILL.md body is empty or very short (< 50 characters)' });
      }
    }
  }

  const valid = issues.every((i) => i.severity !== 'error');
  return { valid, issues };
}

export function formatValidationResult(result: ValidationResult, skillName: string): void {
  const errors = result.issues.filter((i) => i.severity === 'error');
  const warnings = result.issues.filter((i) => i.severity === 'warning');
  const infos = result.issues.filter((i) => i.severity === 'info');

  if (errors.length > 0) {
    logger.error(`Validation errors for "${skillName}":`);
    for (const issue of errors) {
      logger.error(`  • ${issue.message}`);
    }
  }
  if (warnings.length > 0) {
    logger.warn(`Validation warnings for "${skillName}":`);
    for (const issue of warnings) {
      logger.warn(`  • ${issue.message}`);
    }
  }
  for (const issue of infos) {
    logger.success(issue.message);
  }
}
