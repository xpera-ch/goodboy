import { Command } from 'commander';
import { registerSkillCreate } from './skill-create.js';

export function registerSkillCommand(program: Command): void {
  const skill = program.command('skill').description('Manage skill creation and scaffolding');

  registerSkillCreate(skill);
}
