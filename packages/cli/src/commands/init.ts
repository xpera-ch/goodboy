import { Command } from 'commander';
import { readGoodBoyJson, writeGoodBoyJson, type GoodBoyJson } from '../lib/goodboy-file.js';
import { ensureGitignoreEntry } from '../lib/gitignore.js';
import { logger, sanitiseError } from '../lib/logger.js';

interface InitOptions {
  registry?: string;
}

export const initCommand = new Command('init')
  .description('Initialise GoodBoy in the current directory (creates goodboy.json)')
  .option('--registry <url>', 'Set a custom registry URL in goodboy.json')
  .action(async (options: InitOptions) => {
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
      ...(options.registry ? { registry: options.registry } : {}),
      skills: {},
    };

    try {
      await writeGoodBoyJson(cwd, data);
      // §7.3: init adds only the gitignore entry — it never scaffolds
      // goodboy.local.json itself. That happens later, the first time a
      // `goodboy secrets` command needs config and finds none.
      await ensureGitignoreEntry(cwd, 'goodboy.local.json');
    } catch (err) {
      logger.error(sanitiseError(err));
      process.exit(1);
      return;
    }

    logger.success(`Initialised goodboy.json in ${cwd}`);
    logger.info("Run 'goodboy install <skill-name>' to add a skill.");
    logger.info("Run 'goodboy skill create' to scaffold a new skill.");
  });
