import type { Stats } from '@localstripe/contracts';
import type { Db } from '../../infrastructure/database.js';
import type { CustomerService } from '../customers/customer.service.js';
import type { EventService } from '../events/event.service.js';
import type { WebhookDeliveryService } from '../webhooks/webhook-delivery.service.js';

export class StatsService {
  constructor(
    private readonly db: Db,
    private readonly customers: CustomerService,
    private readonly events: EventService,
    private readonly deliveries: WebhookDeliveryService,
  ) {}

  async summary(): Promise<Stats> {
    const [byStatus, failedCharges, volume, refunded, refunds, customers, events, deliveries] =
      await Promise.all([
        this.db
          .selectFrom('paymentIntents')
          .select(['status', (eb) => eb.fn.countAll<number>().as('count')])
          .groupBy('status')
          .execute(),
        this.db
          .selectFrom('charges')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .where('status', '=', 'failed')
          .executeTakeFirstOrThrow(),
        this.db
          .selectFrom('paymentIntents')
          .select(['currency', (eb) => eb.fn.sum<number>('amountReceived').as('amount')])
          .where('status', '=', 'succeeded')
          .groupBy('currency')
          .execute(),
        this.db
          .selectFrom('refunds')
          .select(['currency', (eb) => eb.fn.sum<number>('amount').as('amount')])
          .groupBy('currency')
          .execute(),
        this.db
          .selectFrom('refunds')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .executeTakeFirstOrThrow(),
        this.customers.count(),
        this.events.count(),
        this.deliveries.countByStatus(),
      ]);

    const statuses: Record<string, number> = {};
    let total = 0;
    for (const row of byStatus) {
      statuses[row.status] = Number(row.count);
      total += Number(row.count);
    }

    const currencies = new Set([
      ...volume.map((row) => row.currency),
      ...refunded.map((row) => row.currency),
    ]);
    return {
      object: 'stats',
      payment_intents: { total, by_status: statuses, failed: Number(failedCharges.count) },
      volume: [...currencies].sort().map((currency) => ({
        currency,
        succeeded_amount: Number(volume.find((row) => row.currency === currency)?.amount ?? 0),
        refunded_amount: Number(refunded.find((row) => row.currency === currency)?.amount ?? 0),
      })),
      customers,
      refunds: Number(refunds.count),
      events,
      webhook_deliveries: deliveries,
    };
  }
}
