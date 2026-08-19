import { Command } from 'commander';
import { readGoodBoyJson, writeGoodBoyJson, type GoodBoyJson } from '../lib/goodboy-file.js';
import { logger, sanitiseError } from '../lib/logger.js';

export const initCommand = new Command('init')
  .description('Initialise GoodBoy in the current directory (creates goodboy.json)')
  .action(async () => {
    const cwd = process.cwd();
    const existing = await readGoodBoyJson(cwd);

    if (existing) {
      logger.warn('goodboy.json already exists in this directory.');
      logger.info("Run 'goodboy install <skill-name>' to add a skill.");
      process.exit(0);
      return;
    }

    const data: GoodBoyJson = {
      schema: '1.0.0',
      skills: {},
    };

    try {
      await writeGoodBoyJson(cwd, data);
    } catch (err) {
      logger.error(sanitiseError(err));
      process.exit(1);
      return;
    }

    logger.success(`Initialised goodboy.json in ${cwd}`);
    logger.info("Run 'goodboy install <skill-name>' to add a skill.");
    logger.info("Run 'goodboy skill create' to scaffold a new skill.");
  });
