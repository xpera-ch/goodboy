import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GoodBoyJson } from '../lib/goodboy-file.js';

vi.mock('../lib/goodboy-file.js', () => ({
  readGoodBoyJson: vi.fn(),
  writeGoodBoyJson: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
  sanitiseError: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

import { readGoodBoyJson, writeGoodBoyJson } from '../lib/goodboy-file.js';
import { logger } from '../lib/logger.js';
import { initCommand } from './init.js';

const mockReadGoodBoyJson = vi.mocked(readGoodBoyJson);
const mockWriteGoodBoyJson = vi.mocked(writeGoodBoyJson);
const mockLogger = vi.mocked(logger);

const CWD = process.cwd();

describe('goodboy init', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    mockReadGoodBoyJson.mockResolvedValue(null);
    mockWriteGoodBoyJson.mockResolvedValue(undefined);
  });

  it('creates goodboy.json in the current directory', async () => {
    await initCommand.parseAsync([], { from: 'user' });
    expect(mockWriteGoodBoyJson).toHaveBeenCalledOnce();
    expect(mockWriteGoodBoyJson.mock.calls[0]![0]).toBe(CWD);
  });

  it('writes goodboy.json with schema "1.0.0"', async () => {
    await initCommand.parseAsync([], { from: 'user' });
    const written = mockWriteGoodBoyJson.mock.calls[0]![1] as GoodBoyJson;
    expect(written.schema).toBe('1.0.0');
  });

  it('writes goodboy.json with an empty skills object', async () => {
    await initCommand.parseAsync([], { from: 'user' });
    const written = mockWriteGoodBoyJson.mock.calls[0]![1] as GoodBoyJson;
    expect(written.skills).toEqual({});
  });

  it('does not set a registry field when --registry is not passed', async () => {
    await initCommand.parseAsync([], { from: 'user' });
    const written = mockWriteGoodBoyJson.mock.calls[0]![1] as GoodBoyJson;
    expect(written).not.toHaveProperty('registry');
  });

  it('sets the registry field when --registry is passed', async () => {
    await initCommand.parseAsync(['--registry', 'https://example.com'], { from: 'user' });
    const written = mockWriteGoodBoyJson.mock.calls[0]![1] as GoodBoyJson;
    expect(written.registry).toBe('https://example.com');
  });

  it('exits cleanly with code 0 when goodboy.json already exists', async () => {
    mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: {} });
    await expect(initCommand.parseAsync([], { from: 'user' })).rejects.toThrow(
      'process.exit called',
    );
    expect(process.exit).toHaveBeenCalledWith(0);
    expect(mockWriteGoodBoyJson).not.toHaveBeenCalled();
  });

  it('shows a warning when goodboy.json already exists', async () => {
    mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: {} });
    await expect(initCommand.parseAsync([], { from: 'user' })).rejects.toThrow();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('already exists'),
    );
  });

  it('shows the correct success message', async () => {
    await initCommand.parseAsync([], { from: 'user' });
    expect(mockLogger.success).toHaveBeenCalledWith(
      expect.stringContaining(CWD),
    );
  });

  it('hints to run goodboy install', async () => {
    await initCommand.parseAsync([], { from: 'user' });
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('goodboy install'),
    );
  });

  it('hints to run goodboy skill create', async () => {
    await initCommand.parseAsync([], { from: 'user' });
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('goodboy skill create'),
    );
  });
});
