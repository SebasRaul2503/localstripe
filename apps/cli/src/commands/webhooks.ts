import type { Command } from 'commander';
import type { WebhookDeliveryStatus } from '@localstripe/sdk';
import { choice, parseLimit } from '../arguments.js';
import { CliError, type CliContext } from '../context.js';
import { colorStatus, formatDate, renderTable } from '../format.js';

const DELIVERY_STATUSES: readonly WebhookDeliveryStatus[] = ['pending', 'succeeded', 'failed'];

export function registerWebhookCommands(program: Command, ctx: CliContext): void {
  const { colors } = ctx;
  const webhooks = program
    .command('webhooks')
    .description('Inspect webhook deliveries and endpoints, and re-send events');

  webhooks
    .command('list')
    .description('List webhook deliveries, newest first')
    .option('--status <status>', 'filter by delivery status', choice(DELIVERY_STATUSES))
    .option('--event <id>', 'only deliveries of this event')
    .option('--limit <n>', 'number of deliveries (1-100)', parseLimit, 10)
    .action(
      async (
        options: { status?: WebhookDeliveryStatus; event?: string; limit?: number },
        command: Command,
      ) => {
        const list = await ctx.client(command).localstripe.webhookDeliveries.list(options);
        ctx.printList(
          command,
          list,
          ['ID', 'EVENT TYPE', 'STATUS', 'ATTEMPTS', 'HTTP', 'LAST ATTEMPT', 'URL'],
          (delivery) => [
            delivery.id,
            delivery.event_type,
            colorStatus(delivery.status, colors),
            String(delivery.attempts),
            delivery.last_response_status === null
              ? colors.dim('-')
              : String(delivery.last_response_status),
            formatDate(delivery.last_attempt_at),
            delivery.url,
          ],
        );
      },
    );

  webhooks
    .command('endpoints')
    .description('List webhook endpoints')
    .option('--limit <n>', 'number of endpoints (1-100)', parseLimit, 100)
    .action(async (options: { limit?: number }, command: Command) => {
      const list = await ctx.client(command).webhookEndpoints.list(options);
      ctx.printList(command, list, ['ID', 'URL', 'STATUS', 'EVENTS'], (endpoint) => [
        endpoint.id,
        endpoint.url,
        colorStatus(endpoint.status, colors),
        endpoint.enabled_events.join(','),
      ]);
    });

  webhooks
    .command('retry [event-id]')
    .description('Re-send an event to its webhook endpoints, or retry a single delivery')
    .option('--delivery <id>', 'retry only this delivery (whd_...)')
    .action(
      async (eventId: string | undefined, options: { delivery?: string }, command: Command) => {
        const client = ctx.client(command);
        if (options.delivery) {
          const delivery = await client.localstripe.webhookDeliveries.retry(options.delivery);
          if (ctx.json(command)) return ctx.printJson(delivery);
          return ctx.print(
            `Retrying delivery ${delivery.id} (${delivery.event_type}) to ${delivery.url}: ${colorStatus(delivery.status, colors)}`,
          );
        }
        if (!eventId) throw new CliError('Pass an event id (evt_...) or --delivery <id>.');
        const deliveries = await client.localstripe.resendEvent(eventId);
        if (ctx.json(command)) return ctx.printJson(deliveries);
        if (deliveries.data.length === 0) {
          return ctx.print(`No enabled webhook endpoint listens to ${eventId}.`);
        }
        ctx.print(`Re-sending ${eventId} to ${deliveries.data.length} endpoint(s):`);
        ctx.print(
          renderTable(
            ['DELIVERY', 'STATUS', 'URL'],
            deliveries.data.map((d) => [d.id, colorStatus(d.status, colors), d.url]),
            colors,
          ),
        );
      },
    );
}
