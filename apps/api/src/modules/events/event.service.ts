import {
  API_VERSION,
  type EventType,
  type List,
  type LocalStripeEvent,
} from '@localstripe/contracts';
import { type Db, type Executor, type Tx, json } from '../../infrastructure/database.js';
import { newId } from '../../shared/ids.js';
import { notFound } from '../../shared/errors.js';
import type { Origin } from '../../shared/context.js';
import { paginate, type PageRequest } from '../../shared/pagination.js';
import { toUnix } from '../../shared/time.js';
import { subscribedEndpointIds } from '../webhooks/endpoint-matching.js';

export interface EmitInput {
  type: EventType;
  object: { id: string } & Record<string, unknown>;
  previousAttributes?: Record<string, unknown>;
}

export interface EventFilters {
  type?: string;
  types?: string[];
  objectId?: string;
  requestId?: string;
  createdGte?: Date;
  createdLte?: Date;
}

interface EventRow {
  id: string;
  type: string;
  data: { object: Record<string, unknown>; previous_attributes?: Record<string, unknown> };
  requestId: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
  pendingWebhooks: number;
}

export class EventService {
  constructor(private readonly db: Db) {}

  /**
   * Records an event and fans it out to every matching webhook endpoint. Must run inside the same
   * transaction as the state change it describes, so events are never lost or emitted for rolled
   * back changes.
   */
  async emit(tx: Tx, input: EmitInput, origin: Origin): Promise<string> {
    const id = newId('event');
    await tx
      .insertInto('events')
      .values({
        id,
        type: input.type,
        objectId: input.object.id,
        data: json({
          object: input.object,
          ...(input.previousAttributes && { previous_attributes: input.previousAttributes }),
        }),
        requestId: origin.requestId,
        idempotencyKey: origin.idempotencyKey,
      })
      .execute();

    const endpoints = await subscribedEndpointIds(tx, input.type);

    if (endpoints.length > 0) {
      const now = new Date();
      await tx
        .insertInto('webhookDeliveries')
        .values(
          endpoints.map((endpointId) => ({
            id: newId('webhookDelivery'),
            eventId: id,
            webhookEndpointId: endpointId,
            status: 'pending' as const,
            nextAttemptAt: now,
          })),
        )
        .execute();
    }
    return id;
  }

  private baseQuery(executor: Executor) {
    return executor
      .selectFrom('events')
      .select([
        'events.id',
        'events.type',
        'events.data',
        'events.requestId',
        'events.idempotencyKey',
        'events.createdAt',
      ])
      .select((eb) =>
        eb
          .selectFrom('webhookDeliveries')
          .select((inner) => inner.fn.countAll<number>().as('count'))
          .whereRef('webhookDeliveries.eventId', '=', 'events.id')
          .where('webhookDeliveries.status', '=', 'pending')
          .as('pendingWebhooks'),
      );
  }

  async retrieve(id: string): Promise<LocalStripeEvent> {
    const row = await this.baseQuery(this.db).where('events.id', '=', id).executeTakeFirst();
    if (!row) throw notFound('event', id);
    return toEventResource(row);
  }

  async list(filters: EventFilters, page: PageRequest): Promise<List<LocalStripeEvent>> {
    return paginate(
      '/v1/events',
      page,
      ({ cursor, order, take }) => {
        let query = this.baseQuery(this.db);
        if (filters.type) query = query.where('events.type', '=', filters.type);
        if (filters.types?.length) query = query.where('events.type', 'in', filters.types);
        if (filters.objectId) query = query.where('events.objectId', '=', filters.objectId);
        if (filters.requestId) query = query.where('events.requestId', '=', filters.requestId);
        if (filters.createdGte) query = query.where('events.createdAt', '>=', filters.createdGte);
        if (filters.createdLte) query = query.where('events.createdAt', '<=', filters.createdLte);
        if (cursor) query = query.where('events.id', cursor.op, cursor.id);
        return query.orderBy('events.id', order).limit(take).execute();
      },
      toEventResource,
    );
  }

  async count(): Promise<number> {
    const row = await this.db
      .selectFrom('events')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }
}

export function toEventResource(
  row: Omit<EventRow, 'pendingWebhooks'> & { pendingWebhooks: number | string | null },
): LocalStripeEvent {
  return {
    id: row.id,
    object: 'event',
    api_version: API_VERSION,
    created: toUnix(row.createdAt),
    data: row.data,
    livemode: false,
    pending_webhooks: Number(row.pendingWebhooks ?? 0),
    request: { id: row.requestId, idempotency_key: row.idempotencyKey },
    type: row.type,
  };
}
