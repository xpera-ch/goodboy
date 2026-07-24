import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { registerSecretsCommand } from './index.js';

describe('registerSecretsCommand()', () => {
  it('registers a "secrets" command with "doctor", "list", and "validate" subcommands', () => {
    const program = new Command();
    registerSecretsCommand(program);

    const secrets = program.commands.find((c) => c.name() === 'secrets');
    expect(secrets).toBeDefined();

    const subcommandNames = secrets!.commands.map((c) => c.name());
    expect(subcommandNames).toContain('doctor');
    expect(subcommandNames).toContain('list');
    expect(subcommandNames).toContain('validate');
  });
});
