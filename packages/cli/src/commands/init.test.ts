import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GoodBoyManifest } from '../types/index.js';

vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    text: '',
  })),
}));
vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  select: vi.fn(),
}));
vi.mock('../lib/manifest.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/manifest.js')>();
  return {
    ...actual,
    writeManifest: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { input, select } from '@inquirer/prompts';
import { validateManifest, writeManifest } from '../lib/manifest.js';
import { initCommand } from './init.js';

const mockInput = vi.mocked(input);
const mockSelect = vi.mocked(select);
const mockWriteManifest = vi.mocked(writeManifest);

describe('init command — scaffolded manifest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called unexpectedly');
    });
    mockWriteManifest.mockResolvedValue(undefined);
  });

  it('scaffolds a manifest that passes validateManifest, has kind executable, and omits email when blank', async () => {
    // Exact call order from init.ts: name, description, authorName, authorEmail, category, license, language
    mockInput
      .mockResolvedValueOnce('my-skill')
      .mockResolvedValueOnce('A test skill')
      .mockResolvedValueOnce('Test Author')
      .mockResolvedValueOnce('')    // blank email → key omitted from author object
      .mockResolvedValueOnce('MIT'); // license
    mockSelect
      .mockResolvedValueOnce('code')
      .mockResolvedValueOnce('typescript');

    await initCommand.parseAsync([], { from: 'user' });

    expect(mockWriteManifest).toHaveBeenCalledOnce();
    const captured = mockWriteManifest.mock.calls[0]![1] as GoodBoyManifest;
    expect(() => validateManifest(captured)).not.toThrow();
    expect(captured.kind).toBe('executable');
    expect(captured.author).not.toHaveProperty('email');
  });
});
