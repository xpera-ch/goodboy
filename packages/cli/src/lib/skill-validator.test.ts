import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { logger } from './logger.js';
import { validateSkillDirectory, formatValidationResult } from './skill-validator.js';
import type { ValidationResult } from './skill-validator.js';

const mockLogger = vi.mocked(logger);

const VALID_MANIFEST = JSON.stringify({
  name: 'test-skill',
  version: '1.0.0',
  description: 'A well-described skill for testing purposes',
  author: { name: 'Test Author' },
  license: 'MIT',
  schema_version: '1.0.0',
  status: 'experimental',
  keywords: ['test', 'example'],
  category: 'testing',
  tags: ['testing'],
}, null, 2);

const VALID_SKILL_MD = `---
name: test-skill
description: A well-described skill for testing purposes
---

This skill demonstrates how to use the testing framework effectively.
It covers all the basic patterns and provides a solid foundation for
building your own test suites and validating your work.
`;

let tmpDir: string;

function writeTmp(filename: string, content: string): void {
  writeFileSync(join(tmpDir, filename), content, 'utf-8');
}

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = mkdtempSync(join(tmpdir(), 'goodboy-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('validateSkillDirectory() — valid skill', () => {
  it('returns valid=true with no errors for a well-formed skill', async () => {
    writeTmp('manifest.json', VALID_MANIFEST);
    writeTmp('SKILL.md', VALID_SKILL_MD);
    const result = await validateSkillDirectory(tmpDir);
    const errors = result.issues.filter((i) => i.severity === 'error');
    expect(errors).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  it('returns no warnings when all optional manifest fields are populated', async () => {
    writeTmp('manifest.json', VALID_MANIFEST);
    writeTmp('SKILL.md', VALID_SKILL_MD);
    const result = await validateSkillDirectory(tmpDir);
    const warnings = result.issues.filter((i) => i.severity === 'warning');
    expect(warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Hard errors — manifest.json
// ---------------------------------------------------------------------------

describe('validateSkillDirectory() — manifest.json errors', () => {
  it('reports error when manifest.json is missing', async () => {
    writeTmp('SKILL.md', VALID_SKILL_MD);
    const result = await validateSkillDirectory(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: 'error', message: expect.stringContaining('manifest.json not found') }),
    );
  });

  it('reports error when manifest.json contains invalid JSON', async () => {
    writeTmp('manifest.json', '{ not valid json }');
    writeTmp('SKILL.md', VALID_SKILL_MD);
    const result = await validateSkillDirectory(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: 'error', message: expect.stringContaining('not valid JSON') }),
    );
  });

  it('reports error when manifest.json fails schema validation', async () => {
    writeTmp('manifest.json', JSON.stringify({ name: 'test-skill' })); // missing required fields
    writeTmp('SKILL.md', VALID_SKILL_MD);
    const result = await validateSkillDirectory(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: 'error', message: expect.stringContaining('schema validation') }),
    );
  });
});

// ---------------------------------------------------------------------------
// Hard errors — SKILL.md
// ---------------------------------------------------------------------------

describe('validateSkillDirectory() — SKILL.md errors', () => {
  it('reports error when SKILL.md is missing', async () => {
    writeTmp('manifest.json', VALID_MANIFEST);
    const result = await validateSkillDirectory(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: 'error', message: expect.stringContaining('SKILL.md not found') }),
    );
  });

  it('reports error when SKILL.md has no frontmatter opening delimiter', async () => {
    writeTmp('manifest.json', VALID_MANIFEST);
    writeTmp('SKILL.md', 'name: test-skill\ndescription: something\n\nBody here.');
    const result = await validateSkillDirectory(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: 'error', message: expect.stringContaining('no frontmatter') }),
    );
  });

  it('reports error when SKILL.md frontmatter has no closing delimiter', async () => {
    writeTmp('manifest.json', VALID_MANIFEST);
    writeTmp('SKILL.md', '---\nname: test-skill\ndescription: something\nno closing delimiter');
    const result = await validateSkillDirectory(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: 'error', message: expect.stringContaining('not closed') }),
    );
  });

  it('reports error when SKILL.md frontmatter is missing the name field', async () => {
    writeTmp('manifest.json', VALID_MANIFEST);
    writeTmp('SKILL.md', '---\ndescription: A description\n---\n\nBody content here.');
    const result = await validateSkillDirectory(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: 'error', message: expect.stringContaining('missing the name field') }),
    );
  });

  it('reports error when SKILL.md frontmatter is missing the description field', async () => {
    writeTmp('manifest.json', VALID_MANIFEST);
    writeTmp('SKILL.md', '---\nname: test-skill\n---\n\nBody content here.');
    const result = await validateSkillDirectory(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: 'error', message: expect.stringContaining('missing the description field') }),
    );
  });

  it('ignores blank lines and comment-like lines in frontmatter without colon', async () => {
    writeTmp('manifest.json', VALID_MANIFEST);
    writeTmp('SKILL.md', '---\n\nname: test-skill\ndescription: A well-described skill for testing purposes\n---\n\nBody content here that is longer than fifty characters for sure.');
    const result = await validateSkillDirectory(tmpDir);
    const errors = result.issues.filter((i) => i.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('reports error when SKILL.md frontmatter name does not match manifest name', async () => {
    writeTmp('manifest.json', VALID_MANIFEST);
    writeTmp('SKILL.md', '---\nname: different-skill\ndescription: Something\n---\n\nBody content here.');
    const result = await validateSkillDirectory(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('does not match manifest.json name'),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

describe('validateSkillDirectory() — warnings', () => {
  const BASE_MANIFEST = JSON.stringify({
    name: 'test-skill',
    version: '1.0.0',
    description: 'A well-described skill for testing purposes',
    author: { name: 'Test Author' },
    license: 'MIT',
    schema_version: '1.0.0',
    status: 'experimental',
  }, null, 2);

  it('warns when manifest description is fewer than 20 characters', async () => {
    const m = JSON.parse(BASE_MANIFEST);
    m.description = 'Short desc';
    writeTmp('manifest.json', JSON.stringify(m));
    writeTmp('SKILL.md', VALID_SKILL_MD);
    const result = await validateSkillDirectory(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', message: expect.stringContaining('description is very short') }),
    );
  });

  it('warns when manifest has no keywords', async () => {
    writeTmp('manifest.json', BASE_MANIFEST);
    writeTmp('SKILL.md', VALID_SKILL_MD);
    const result = await validateSkillDirectory(tmpDir);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', message: expect.stringContaining('no keywords') }),
    );
  });

  it('warns when manifest has no category', async () => {
    writeTmp('manifest.json', BASE_MANIFEST);
    writeTmp('SKILL.md', VALID_SKILL_MD);
    const result = await validateSkillDirectory(tmpDir);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', message: expect.stringContaining('no category') }),
    );
  });

  it('warns when manifest has no tags', async () => {
    writeTmp('manifest.json', BASE_MANIFEST);
    writeTmp('SKILL.md', VALID_SKILL_MD);
    const result = await validateSkillDirectory(tmpDir);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', message: expect.stringContaining('no tags') }),
    );
  });

  it('warns when SKILL.md body is empty', async () => {
    writeTmp('manifest.json', VALID_MANIFEST);
    writeTmp('SKILL.md', '---\nname: test-skill\ndescription: A well-described skill for testing\n---\n\n');
    const result = await validateSkillDirectory(tmpDir);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', message: expect.stringContaining('body is empty or very short') }),
    );
  });

  it('warns when manifest has empty keywords array', async () => {
    const m = JSON.parse(VALID_MANIFEST);
    m.keywords = [];
    writeTmp('manifest.json', JSON.stringify(m));
    writeTmp('SKILL.md', VALID_SKILL_MD);
    const result = await validateSkillDirectory(tmpDir);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', message: expect.stringContaining('no keywords') }),
    );
  });

  it('warns when manifest has empty tags array', async () => {
    const m = JSON.parse(VALID_MANIFEST);
    m.tags = [];
    writeTmp('manifest.json', JSON.stringify(m));
    writeTmp('SKILL.md', VALID_SKILL_MD);
    const result = await validateSkillDirectory(tmpDir);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', message: expect.stringContaining('no tags') }),
    );
  });

  it('reports valid=true even when only warnings are present', async () => {
    writeTmp('manifest.json', BASE_MANIFEST);
    writeTmp('SKILL.md', VALID_SKILL_MD);
    const result = await validateSkillDirectory(tmpDir);
    expect(result.valid).toBe(true);
    const errors = result.issues.filter((i) => i.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('warns (not errors) when the manifest uses a tolerated newer-minor schema version', async () => {
    const m = JSON.parse(BASE_MANIFEST);
    m.schema_version = '1.5.0';
    m.future_field = 'unused';
    writeTmp('manifest.json', JSON.stringify(m));
    writeTmp('SKILL.md', VALID_SKILL_MD);
    const result = await validateSkillDirectory(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', message: expect.stringContaining('schema 1.5.0') }),
    );
  });
});

// ---------------------------------------------------------------------------
// formatValidationResult()
// ---------------------------------------------------------------------------

describe('formatValidationResult()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls logger.error for each error issue', () => {
    const result: ValidationResult = {
      valid: false,
      issues: [
        { severity: 'error', message: 'manifest.json not found' },
        { severity: 'error', message: 'SKILL.md not found' },
      ],
    };
    formatValidationResult(result, 'test-skill');
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('test-skill'));
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('manifest.json not found'));
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('SKILL.md not found'));
  });

  it('calls logger.warn for each warning issue', () => {
    const result: ValidationResult = {
      valid: true,
      issues: [{ severity: 'warning', message: 'manifest has no keywords' }],
    };
    formatValidationResult(result, 'test-skill');
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('manifest has no keywords'));
  });

  it('does not call logger when there are no issues', () => {
    const result: ValidationResult = { valid: true, issues: [] };
    formatValidationResult(result, 'test-skill');
    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});
