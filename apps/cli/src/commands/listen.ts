import type { Command } from 'commander';
import { LocalStripeError } from '@localstripe/sdk';
import { parseEventList, parseHttpUrl, parseWebhookSecret } from '../arguments.js';
import type { CliContext } from '../context.js';
import { EventForwarder, generateWebhookSecret, type ForwardResult } from '../listen/forwarder.js';

interface ListenOptions {
  forwardTo: string;
  events?: string[];
  secret?: string;
  interval: number;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });

export function registerListenCommand(program: Command, ctx: CliContext): void {
  const { colors } = ctx;

  program
    .command('listen')
    .description(
      'Forward new events to a local URL as signed webhooks (like `stripe listen`). Ctrl+C to stop.',
    )
    .requiredOption('--forward-to <url>', 'URL that receives the events', parseHttpUrl)
    .option(
      '--events <types>',
      'comma-separated event types to forward (default: all)',
      parseEventList,
    )
    .option(
      '--secret <whsec>',
      'signing secret to use (default: a new random whsec_)',
      parseWebhookSecret,
    )
    .option(
      '--interval <ms>',
      'polling interval in milliseconds',
      (v) => Math.max(200, Number(v) || 1000),
      1000,
    )
    .action(async (options: ListenOptions, command: Command) => {
      const client = ctx.client(command);
      const secret = options.secret ?? generateWebhookSecret();
      const forwarder = new EventForwarder({
        events: client.events,
        forwardTo: options.forwardTo,
        secret,
        eventTypes: options.events,
      });

      const controller = new AbortController();
      const stop = () => controller.abort();
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);

      try {
        await forwarder.start();
        ctx.io.stderr(
          `Ready! Forwarding ${options.events?.join(', ') ?? 'all events'} to ${options.forwardTo}\n` +
            `Your webhook signing secret is ${colors.bold(secret)} (^C to quit)\n`,
        );
        const print = (result: ForwardResult) => ctx.print(formatResult(result, ctx));
        let failures = 0;
        while (!controller.signal.aborted) {
          try {
            await forwarder.poll(print, controller.signal);
            failures = 0;
          } catch (error) {
            if (!(error instanceof LocalStripeError)) throw error;
            failures++;
            ctx.io.stderr(colors.yellow(`Polling failed: ${error.message}\n`));
          }
          await sleep(options.interval * Math.min(2 ** failures, 10), controller.signal);
        }
      } finally {
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
      }
      ctx.io.stderr('Stopped listening.\n');
    });
}

function formatResult(result: ForwardResult, ctx: CliContext): string {
  const { colors } = ctx;
  const time = new Date().toISOString().slice(11, 19);
  const head = `${colors.dim(time)}  ${result.event.type.padEnd(34)} ${result.event.id}`;
  if (result.status === undefined) {
    return `${head}  ${colors.red(`--> error: ${result.error ?? 'request failed'}`)}`;
  }
  const ok = result.status >= 200 && result.status < 300;
  const status = `[${result.status}]`;
  return `${head}  --> ${ok ? colors.green(status) : colors.red(status)} ${colors.dim(`${result.durationMs}ms`)}`;
}
