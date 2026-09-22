import type { Command } from 'commander';
import type { PaymentIntentStatus } from '@localstripe/sdk';
import { choice, parseLimit } from '../arguments.js';
import type { CliContext } from '../context.js';
import { colorStatus, formatAmount, formatDate } from '../format.js';

const PAYMENT_INTENT_STATUSES: readonly PaymentIntentStatus[] = [
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'processing',
  'succeeded',
  'canceled',
];

interface ListOptions {
  limit?: number;
}

export function registerResourceCommands(program: Command, ctx: CliContext): void {
  const { colors } = ctx;
  const dash = (value: string | null | undefined) => value || colors.dim('-');

  const customers = program.command('customers').description('Inspect customers');
  customers
    .command('list')
    .description('List customers, newest first')
    .option('--limit <n>', 'number of customers (1-100)', parseLimit, 10)
    .option('--email <email>', 'only customers with this email')
    .action(async (options: ListOptions & { email?: string }, command: Command) => {
      const list = await ctx.client(command).customers.list(options);
      ctx.printList(command, list, ['ID', 'EMAIL', 'NAME', 'CREATED'], (customer) => [
        customer.id,
        dash(customer.email),
        dash(customer.name),
        formatDate(customer.created),
      ]);
    });
  customers
    .command('retrieve <id>')
    .description('Show a customer')
    .action(async (id: string, _options: unknown, command: Command) => {
      ctx.printObject(command, await ctx.client(command).customers.retrieve(id));
    });

  const payments = program.command('payments').description('Inspect payment intents');
  payments
    .command('list')
    .description('List payment intents, newest first')
    .option('--status <status>', 'filter by status', choice(PAYMENT_INTENT_STATUSES))
    .option('--customer <id>', 'filter by customer id')
    .option('--limit <n>', 'number of payments (1-100)', parseLimit, 10)
    .action(
      async (
        options: ListOptions & { status?: PaymentIntentStatus; customer?: string },
        command: Command,
      ) => {
        const list = await ctx.client(command).paymentIntents.list(options);
        ctx.printList(
          command,
          list,
          ['ID', 'AMOUNT', 'STATUS', 'CUSTOMER', 'CREATED'],
          (paymentIntent) => [
            paymentIntent.id,
            formatAmount(paymentIntent.amount, paymentIntent.currency),
            colorStatus(paymentIntent.status, colors),
            dash(paymentIntent.customer),
            formatDate(paymentIntent.created),
          ],
        );
      },
    );
  payments
    .command('retrieve <id>')
    .description('Show a payment intent')
    .action(async (id: string, _options: unknown, command: Command) => {
      ctx.printObject(command, await ctx.client(command).paymentIntents.retrieve(id));
    });

  program
    .command('refunds')
    .description('Inspect refunds')
    .command('list')
    .description('List refunds, newest first')
    .option('--payment-intent <id>', 'filter by payment intent id')
    .option('--limit <n>', 'number of refunds (1-100)', parseLimit, 10)
    .action(async (options: ListOptions & { paymentIntent?: string }, command: Command) => {
      const list = await ctx
        .client(command)
        .refunds.list({ limit: options.limit, payment_intent: options.paymentIntent });
      ctx.printList(
        command,
        list,
        ['ID', 'AMOUNT', 'STATUS', 'PAYMENT INTENT', 'REASON', 'CREATED'],
        (refund) => [
          refund.id,
          formatAmount(refund.amount, refund.currency),
          colorStatus(refund.status, colors),
          refund.payment_intent,
          dash(refund.reason),
          formatDate(refund.created),
        ],
      );
    });

  const events = program.command('events').description('Inspect events');
  events
    .command('list')
    .description('List events, newest first')
    .option('--type <type>', 'filter by event type (e.g. payment_intent.succeeded)')
    .option('--limit <n>', 'number of events (1-100)', parseLimit, 10)
    .action(async (options: ListOptions & { type?: string }, command: Command) => {
      const list = await ctx.client(command).events.list(options);
      ctx.printList(command, list, ['ID', 'TYPE', 'OBJECT', 'CREATED'], (event) => [
        event.id,
        event.type,
        String(event.data.object['id'] ?? '-'),
        formatDate(event.created),
      ]);
    });
  events
    .command('retrieve <id>')
    .description('Show an event (always as JSON)')
    .action(async (id: string, _options: unknown, command: Command) => {
      ctx.printJson(await ctx.client(command).events.retrieve(id));
    });
}
