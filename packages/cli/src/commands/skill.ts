import { Command } from 'commander';
import { registerSkillCreate } from './skill-create.js';
import { registerSkillVersion } from './skill-version.js';
import { registerSkillOpen } from './skill-open.js';
import { registerSkillDiff } from './skill-diff.js';
import { registerSkillStatus } from './skill-status.js';

export function registerSkillCommand(program: Command): void {
  const skill = program.command('skill').description('Manage skill creation and scaffolding');

  registerSkillCreate(skill);
  registerSkillVersion(skill);
  registerSkillOpen(skill);
  registerSkillDiff(skill);
  registerSkillStatus(skill);
}
