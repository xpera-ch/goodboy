import { Command } from 'commander';
import { registerSecretsDoctor } from './doctor.js';
import { registerSecretsList } from './list.js';
import { registerSecretsValidate } from './validate.js';

export function registerSecretsCommand(program: Command): void {
  const secrets = program.command('secrets').description('Manage secret provider configuration');

  registerSecretsDoctor(secrets);
  registerSecretsList(secrets);
  registerSecretsValidate(secrets);
}
