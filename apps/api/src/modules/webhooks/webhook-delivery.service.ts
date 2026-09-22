import type {
  List,
  WebhookDelivery,
  WebhookDeliveryAttempt,
  WebhookDeliveryStatus,
} from '@localstripe/contracts';
import type { Db, Executor } from '../../infrastructure/database.js';
import { newId } from '../../shared/ids.js';
import { notFound } from '../../shared/errors.js';
import { paginate, type PageRequest } from '../../shared/pagination.js';
import { toUnix, toUnixOrNull } from '../../shared/time.js';
import { subscribedEndpointIds } from './endpoint-matching.js';

export interface DeliveryFilters {
  webhookEndpoint?: string;
  event?: string;
  status?: WebhookDeliveryStatus;
}

interface DeliveryRow {
  id: string;
  eventId: string;
  webhookEndpointId: string;
  status: 'pending' | 'succeeded' | 'failed';
  attempts: number;
  nextAttemptAt: Date | null;
  lastAttemptAt: Date | null;
  lastResponseStatus: number | null;
  lastError: string | null;
  createdAt: Date;
  eventType: string;
  url: string;
}

export function toDeliveryResource(row: DeliveryRow): WebhookDelivery {
  return {
    id: row.id,
    object: 'webhook_delivery',
    attempts: row.attempts,
    created: toUnix(row.createdAt),
    event: row.eventId,
    event_type: row.eventType,
    last_attempt_at: toUnixOrNull(row.lastAttemptAt),
    last_error: row.lastError,
    last_response_status: row.lastResponseStatus,
    next_attempt_at: row.status === 'pending' ? toUnixOrNull(row.nextAttemptAt) : null,
    status: row.status,
    url: row.url,
    webhook_endpoint: row.webhookEndpointId,
  };
}

export class WebhookDeliveryService {
  constructor(private readonly db: Db) {}

  private query(executor: Executor) {
    return executor
      .selectFrom('webhookDeliveries')
      .innerJoin('events', 'events.id', 'webhookDeliveries.eventId')
      .innerJoin('webhookEndpoints', 'webhookEndpoints.id', 'webhookDeliveries.webhookEndpointId')
      .select([
        'webhookDeliveries.id',
        'webhookDeliveries.eventId',
        'webhookDeliveries.webhookEndpointId',
        'webhookDeliveries.status',
        'webhookDeliveries.attempts',
        'webhookDeliveries.nextAttemptAt',
        'webhookDeliveries.lastAttemptAt',
        'webhookDeliveries.lastResponseStatus',
        'webhookDeliveries.lastError',
        'webhookDeliveries.createdAt',
        'events.type as eventType',
        'webhookEndpoints.url',
      ]);
  }

  async retrieve(
    id: string,
  ): Promise<WebhookDelivery & { attempt_history: WebhookDeliveryAttempt[] }> {
    const row = await this.query(this.db).where('webhookDeliveries.id', '=', id).executeTakeFirst();
    if (!row) throw notFound('webhook_delivery', id);
    const attempts = await this.db
      .selectFrom('webhookDeliveryAttempts')
      .selectAll()
      .where('webhookDeliveryId', '=', id)
      .orderBy('attempt', 'asc')
      .execute();
    return {
      ...toDeliveryResource(row),
      attempt_history: attempts.map((attempt) => ({
        id: attempt.id,
        object: 'webhook_delivery_attempt',
        attempt: attempt.attempt,
        created: toUnix(attempt.createdAt),
        duration_ms: attempt.durationMs,
        error: attempt.error,
        response_body: attempt.responseBody,
        response_status: attempt.responseStatus,
        succeeded: attempt.succeeded,
      })),
    };
  }

  async list(filters: DeliveryFilters, page: PageRequest): Promise<List<WebhookDelivery>> {
    return paginate(
      '/v1/localstripe/webhook_deliveries',
      page,
      ({ cursor, order, take }) => {
        let query = this.query(this.db);
        if (filters.webhookEndpoint) {
          query = query.where('webhookDeliveries.webhookEndpointId', '=', filters.webhookEndpoint);
        }
        if (filters.event) query = query.where('webhookDeliveries.eventId', '=', filters.event);
        if (filters.status) query = query.where('webhookDeliveries.status', '=', filters.status);
        if (cursor) query = query.where('webhookDeliveries.id', cursor.op, cursor.id);
        return query.orderBy('webhookDeliveries.id', order).limit(take).execute();
      },
      toDeliveryResource,
    );
  }

  /** Schedules an immediate new attempt, regardless of the current status. */
  async retry(id: string): Promise<WebhookDelivery> {
    const result = await this.db
      .updateTable('webhookDeliveries')
      .set({ status: 'pending', nextAttemptAt: new Date(), lockedUntil: null })
      .where('id', '=', id)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw notFound('webhook_delivery', id);
    const row = await this.query(this.db)
      .where('webhookDeliveries.id', '=', id)
      .executeTakeFirstOrThrow();
    return toDeliveryResource(row);
  }

  /**
   * Re-sends an event to every endpoint it was delivered to, plus any enabled endpoint that
   * subscribes to it now (for example one created after the event happened).
   */
  async resendEvent(eventId: string): Promise<List<WebhookDelivery>> {
    const event = await this.db
      .selectFrom('events')
      .select(['id', 'type'])
      .where('id', '=', eventId)
      .executeTakeFirst();
    if (!event) throw notFound('event', eventId);
    await this.db.transaction().execute(async (tx) => {
      const endpoints = await subscribedEndpointIds(tx, event.type);
      if (endpoints.length > 0) {
        await tx
          .insertInto('webhookDeliveries')
          .values(
            endpoints.map((endpointId) => ({
              id: newId('webhookDelivery'),
              eventId,
              webhookEndpointId: endpointId,
              status: 'pending' as const,
              nextAttemptAt: new Date(),
            })),
          )
          .onConflict((oc) => oc.columns(['eventId', 'webhookEndpointId']).doNothing())
          .execute();
      }
      await tx
        .updateTable('webhookDeliveries')
        .set({ status: 'pending', nextAttemptAt: new Date(), lockedUntil: null })
        .where('eventId', '=', eventId)
        .execute();
    });
    return this.list({ event: eventId }, { limit: 100 });
  }

  async countByStatus(): Promise<Record<WebhookDeliveryStatus, number>> {
    const rows = await this.db
      .selectFrom('webhookDeliveries')
      .select(['status', (eb) => eb.fn.countAll<number>().as('count')])
      .groupBy('status')
      .execute();
    const counts: Record<WebhookDeliveryStatus, number> = { pending: 0, succeeded: 0, failed: 0 };
    for (const row of rows) counts[row.status] = Number(row.count);
    return counts;
  }
}
