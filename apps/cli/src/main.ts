import { CommanderError } from 'commander';
import { formatError } from './errors.js';
import { shouldUseColor } from './format.js';
import { createProgram } from './program.js';

const program = createProgram({
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
  color: shouldUseColor(process.env, Boolean(process.stdout.isTTY)),
});

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof CommanderError) process.exit(error.exitCode);
  console.error(formatError(error));
  process.exit(1);
}
