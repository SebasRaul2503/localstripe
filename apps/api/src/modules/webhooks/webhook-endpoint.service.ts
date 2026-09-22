import {
  EVENT_TYPES,
  type DeletedObject,
  type List,
  type WebhookEndpoint,
} from '@localstripe/contracts';
import { type Db, json } from '../../infrastructure/database.js';
import { newId, randomToken } from '../../shared/ids.js';
import { invalidRequest, notFound } from '../../shared/errors.js';
import { paginate, type PageRequest } from '../../shared/pagination.js';
import { applyMetadata, createMetadata, type MetadataInput } from '../../shared/validation.js';
import { toUnix } from '../../shared/time.js';

export interface CreateWebhookEndpointInput {
  url: string;
  enabled_events: string[];
  description?: string | null;
  metadata?: MetadataInput;
}

export interface UpdateWebhookEndpointInput {
  url?: string;
  enabled_events?: string[];
  description?: string | null;
  disabled?: boolean;
  metadata?: MetadataInput;
}

interface WebhookEndpointRow {
  id: string;
  url: string;
  description: string | null;
  enabledEvents: string[];
  secret: string;
  status: 'enabled' | 'disabled';
  metadata: Record<string, string>;
  createdAt: Date;
}

function toResource(row: WebhookEndpointRow, includeSecret = false): WebhookEndpoint {
  return {
    id: row.id,
    object: 'webhook_endpoint',
    created: toUnix(row.createdAt),
    description: row.description,
    enabled_events: row.enabledEvents,
    livemode: false,
    metadata: row.metadata,
    ...(includeSecret && { secret: row.secret }),
    status: row.status,
    url: row.url,
  };
}

export function validateEnabledEvents(events: string[]): string[] {
  const unique = [...new Set(events)];
  if (unique.length === 0) {
    throw invalidRequest('enabled_events must contain at least one event type.', {
      param: 'enabled_events',
    });
  }
  for (const type of unique) {
    if (type !== '*' && !(EVENT_TYPES as readonly string[]).includes(type)) {
      throw invalidRequest(
        `Invalid event type '${type}'. Use '*' or one of: ${EVENT_TYPES.join(', ')}.`,
        {
          param: 'enabled_events',
        },
      );
    }
  }
  return unique;
}

export class WebhookEndpointService {
  constructor(private readonly db: Db) {}

  async create(input: CreateWebhookEndpointInput): Promise<WebhookEndpoint> {
    const row = await this.db
      .insertInto('webhookEndpoints')
      .values({
        id: newId('webhookEndpoint'),
        url: input.url,
        description: input.description ?? null,
        enabledEvents: validateEnabledEvents(input.enabled_events),
        secret: `whsec_${randomToken(32)}`,
        status: 'enabled',
        metadata: json(createMetadata(input.metadata)),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    // Like Stripe, the signing secret is only returned in the create response.
    return toResource(row, true);
  }

  private async requireRow(id: string): Promise<WebhookEndpointRow> {
    const row = await this.db
      .selectFrom('webhookEndpoints')
      .selectAll()
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!row) throw notFound('webhook_endpoint', id);
    return row;
  }

  async retrieve(id: string): Promise<WebhookEndpoint> {
    return toResource(await this.requireRow(id));
  }

  /** LocalStripe extension: developers need the secret again to configure their app. */
  async revealSecret(
    id: string,
  ): Promise<{ object: 'webhook_endpoint_secret'; id: string; secret: string }> {
    const row = await this.requireRow(id);
    return { object: 'webhook_endpoint_secret', id: row.id, secret: row.secret };
  }

  async update(id: string, input: UpdateWebhookEndpointInput): Promise<WebhookEndpoint> {
    const current = await this.requireRow(id);
    const row = await this.db
      .updateTable('webhookEndpoints')
      .set({
        ...(input.url !== undefined && { url: input.url }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.enabled_events !== undefined && {
          enabledEvents: validateEnabledEvents(input.enabled_events),
        }),
        ...(input.disabled !== undefined && { status: input.disabled ? 'disabled' : 'enabled' }),
        metadata: json(applyMetadata(current.metadata, input.metadata)),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return toResource(row);
  }

  async delete(id: string): Promise<DeletedObject> {
    const result = await this.db
      .updateTable('webhookEndpoints')
      .set({ deletedAt: new Date(), status: 'disabled' })
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw notFound('webhook_endpoint', id);
    return { id, object: 'webhook_endpoint', deleted: true };
  }

  async list(page: PageRequest): Promise<List<WebhookEndpoint>> {
    return paginate(
      '/v1/webhook_endpoints',
      page,
      ({ cursor, order, take }) => {
        let query = this.db
          .selectFrom('webhookEndpoints')
          .selectAll()
          .where('deletedAt', 'is', null);
        if (cursor) query = query.where('id', cursor.op, cursor.id);
        return query.orderBy('id', order).limit(take).execute();
      },
      (row) => toResource(row),
    );
  }
}
