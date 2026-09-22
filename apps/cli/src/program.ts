import { Command } from 'commander';
import { registerListenCommand } from './commands/listen.js';
import { registerMiscCommands } from './commands/misc.js';
import { registerResourceCommands } from './commands/resources.js';
import { registerWebhookCommands } from './commands/webhooks.js';
import { DEFAULT_API_URL } from './config.js';
import { CliContext, type CliIo } from './context.js';

export const CLI_VERSION = '0.1.0';

export function createProgram(io: CliIo): Command {
  const ctx = new CliContext(io);
  const program = new Command('localstripe')
    .description(
      'Command line interface for LocalStripe, the local Stripe-like payment mock. It never processes real payments.',
    )
    .version(CLI_VERSION)
    .option('--api-url <url>', `API base URL (env LOCALSTRIPE_API_URL, default ${DEFAULT_API_URL})`)
    .option(
      '--api-key <key>',
      'secret API key (env LOCALSTRIPE_API_KEY, or read from the shared credentials.json)',
    )
    .option('--json', 'print raw JSON responses')
    .showHelpAfterError()
    // Throw CommanderError instead of exiting, so main.ts owns the exit code and tests can assert.
    .exitOverride()
    .configureOutput({
      writeOut: io.stdout,
      writeErr: io.stderr,
      outputError: (text, write) => write(ctx.colors.red(text)),
    });

  registerMiscCommands(program, ctx);
  registerResourceCommands(program, ctx);
  registerWebhookCommands(program, ctx);
  registerListenCommand(program, ctx);
  return program;
}
