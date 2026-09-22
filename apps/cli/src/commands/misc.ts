import { Argument, type Command } from 'commander';
import { TRIGGERABLE_EVENTS, type TriggerableEvent } from '@localstripe/sdk';
import { choice } from '../arguments.js';
import type { CliContext } from '../context.js';

export function registerMiscCommands(program: Command, ctx: CliContext): void {
  const { colors } = ctx;

  program
    .command('health')
    .description('Check that the LocalStripe API is up (no API key needed)')
    .action(async (_options: unknown, command: Command) => {
      const health = await ctx.client(command, { requireKey: false }).health();
      if (ctx.json(command)) return ctx.printJson(health);
      ctx.print(`${colors.green(health.status)}  ${health.service} at ${ctx.apiUrl(command)}`);
    });

  program
    .command('trigger')
    .description('Trigger an event by running the flow that produces it (like `stripe trigger`)')
    .addArgument(
      new Argument('<event>', 'event to trigger (see the list below)').argParser(
        choice(TRIGGERABLE_EVENTS),
      ),
    )
    .addHelpText('after', `\nTriggerable events:\n  ${TRIGGERABLE_EVENTS.join('\n  ')}`)
    .action(async (event: TriggerableEvent, _options: unknown, command: Command) => {
      const result = await ctx.client(command).localstripe.trigger(event);
      if (ctx.json(command)) return ctx.printJson(result);
      ctx.print(`Triggered ${colors.bold(result.event)}`);
      ctx.print(`  objects: ${result.objects.join(', ') || '-'}`);
      ctx.print(`  events:  ${result.events.join(', ') || '-'}`);
    });

  program
    .command('test-cards')
    .description('List the test card catalog and what each card does')
    .action(async (_options: unknown, command: Command) => {
      const cards = await ctx.client(command).localstripe.testCards();
      ctx.printList(
        command,
        cards,
        ['NUMBER', 'BRAND', 'SCENARIO', 'DECLINE CODE', 'TOKEN', 'LABEL'],
        (card) => [
          card.number,
          card.brand,
          card.scenario,
          card.decline_code ?? colors.dim('-'),
          card.payment_method_token ?? colors.dim('-'),
          card.label,
        ],
      );
    });
}
