import { sql } from 'kysely';
import type { Logger } from 'pino';
import { buildSignatureHeader } from '@localstripe/contracts/signature';
import type { Db } from '../../infrastructure/database.js';
import type { Metrics } from '../../infrastructure/metrics.js';
import type { EventService } from '../events/event.service.js';
import { newId } from '../../shared/ids.js';
import { isSuccessfulResponse, nextRetryAt, type RetryPolicy } from './retry-policy.js';

const MAX_STORED_RESPONSE_BYTES = 2048;
export const USER_AGENT = 'LocalStripe/1.0 (+https://github.com/SebasRaul2503/localstripe)';

interface ClaimedDelivery {
  id: string;
  eventId: string;
  webhookEndpointId: string;
  attempts: number;
}

interface AttemptResult {
  succeeded: boolean;
  status: number | null;
  body: string | null;
  error: string | null;
  durationMs: number;
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8');
}

/** Sends due webhook deliveries, signs them, records every attempt and schedules retries. */
export class WebhookDispatcher {
  constructor(
    private readonly db: Db,
    private readonly events: EventService,
    private readonly logger: Logger,
    private readonly metrics: Metrics,
    private readonly settings: RetryPolicy & { timeoutMs: number },
  ) {}

  /** Claims up to `limit` due deliveries with a lease and delivers them concurrently. */
  async dispatchDue(limit = 20): Promise<number> {
    const leaseMs = this.settings.timeoutMs + 30_000;
    const claimed = await sql<ClaimedDelivery>`
      UPDATE webhook_deliveries
      SET locked_until = now() + ${`${leaseMs} milliseconds`}::interval
      WHERE id IN (
        SELECT id FROM webhook_deliveries
        WHERE status = 'pending' AND next_attempt_at <= now()
          AND (locked_until IS NULL OR locked_until < now())
        ORDER BY next_attempt_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, event_id, webhook_endpoint_id, attempts
    `.execute(this.db);
    await Promise.all(claimed.rows.map((delivery) => this.deliver(delivery)));
    return claimed.rows.length;
  }

  private async deliver(delivery: ClaimedDelivery): Promise<void> {
    const endpoint = await this.db
      .selectFrom('webhookEndpoints')
      .select(['url', 'secret', 'status', 'deletedAt'])
      .where('id', '=', delivery.webhookEndpointId)
      .executeTakeFirstOrThrow();
    const attempt = delivery.attempts + 1;

    let result: AttemptResult;
    if (endpoint.status !== 'enabled' || endpoint.deletedAt) {
      result = {
        succeeded: false,
        status: null,
        body: null,
        error: 'Webhook endpoint is disabled or deleted.',
        durationMs: 0,
      };
    } else {
      const event = await this.events.retrieve(delivery.eventId);
      result = await this.send(
        endpoint.url,
        endpoint.secret,
        JSON.stringify(event, null, 2),
        delivery,
      );
    }

    const retryAt = result.succeeded ? null : nextRetryAt(attempt, this.settings);
    const status = result.succeeded ? 'succeeded' : retryAt ? 'pending' : 'failed';

    await this.db.transaction().execute(async (tx) => {
      await tx
        .insertInto('webhookDeliveryAttempts')
        .values({
          id: newId('webhookDeliveryAttempt'),
          webhookDeliveryId: delivery.id,
          attempt,
          responseStatus: result.status,
          responseBody: result.body,
          error: result.error,
          durationMs: result.durationMs,
          succeeded: result.succeeded,
        })
        .execute();
      await tx
        .updateTable('webhookDeliveries')
        .set({
          status,
          attempts: attempt,
          lastAttemptAt: new Date(),
          lastResponseStatus: result.status,
          lastError: result.error,
          nextAttemptAt: retryAt,
          lockedUntil: null,
        })
        .where('id', '=', delivery.id)
        .execute();
    });

    this.metrics.webhookAttempts.inc({ result: result.succeeded ? 'succeeded' : 'failed' });
    this.logger.info(
      {
        webhookDeliveryId: delivery.id,
        eventId: delivery.eventId,
        webhookEndpointId: delivery.webhookEndpointId,
        attempt,
        status,
        responseStatus: result.status,
        durationMs: result.durationMs,
        ...(result.error && { error: result.error }),
      },
      'webhook delivery attempt',
    );
  }

  private async send(
    url: string,
    secret: string,
    payload: string,
    delivery: ClaimedDelivery,
  ): Promise<AttemptResult> {
    const signature = buildSignatureHeader(payload, secret, Math.floor(Date.now() / 1000));
    const started = performance.now();
    try {
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(this.settings.timeoutMs),
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'user-agent': USER_AGENT,
          'localstripe-signature': signature,
          // Same scheme and header name as Stripe, so `stripe.webhooks.constructEvent` works too.
          'stripe-signature': signature,
          'localstripe-event-id': delivery.eventId,
          'localstripe-delivery-id': delivery.id,
        },
        body: payload,
      });
      const body = await readCapped(response, MAX_STORED_RESPONSE_BYTES).catch(() => '');
      const succeeded = isSuccessfulResponse(response.status);
      return {
        succeeded,
        status: response.status,
        body,
        error: succeeded ? null : `Endpoint responded with HTTP ${response.status}.`,
        durationMs: Math.round(performance.now() - started),
      };
    } catch (error) {
      const cause = (error as { cause?: { code?: string; message?: string } }).cause;
      const message =
        (error as Error).name === 'TimeoutError'
          ? `Timed out after ${this.settings.timeoutMs} ms.`
          : `Request failed: ${cause?.code ?? cause?.message ?? (error as Error).message}`;
      return {
        succeeded: false,
        status: null,
        body: null,
        error: message,
        durationMs: Math.round(performance.now() - started),
      };
    }
  }
}
