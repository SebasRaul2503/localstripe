import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import type { WebhookDelivery } from '@localstripe/contracts';
import { findEvent, http, registerSinkEndpoint, sink, stripe, waitFor } from './support.js';

describe('idempotency', () => {
  it('replays a retried request with the same key', async () => {
    const key = randomUUID();
    const params = { email: `idem-${key}@example.test` };
    const first = await stripe.customers.create(params, { idempotencyKey: key });
    const second = await stripe.customers.create(params, { idempotencyKey: key });
    expect(second.id).toBe(first.id);

    const listed = await stripe.customers.list({ email: params.email });
    expect(listed.data).toHaveLength(1);
  });

  it('rejects the same key with a different payload', async () => {
    const key = randomUUID();
    await stripe.customers.create({ name: 'first' }, { idempotencyKey: key });
    const error = await stripe.customers
      .create({ name: 'second' }, { idempotencyKey: key })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Stripe.errors.StripeIdempotencyError);
  });

  it('creates exactly one object under concurrent identical requests', async () => {
    const key = randomUUID();
    const email = `concurrent-${key}@example.test`;
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        http('POST', '/v1/customers', { body: { email }, headers: { 'idempotency-key': key } }),
      ),
    );
    const succeeded = responses.filter((response) => response.status === 200);
    expect(succeeded.length).toBeGreaterThanOrEqual(1);
    expect(new Set(succeeded.map((response) => response.body['id'])).size).toBe(1);
    for (const response of responses.filter((r) => r.status !== 200)) {
      expect(response.status).toBe(409);
    }
    expect((await stripe.customers.list({ email })).data).toHaveLength(1);
  });

  it('replays declines too, without charging twice', async () => {
    const key = randomUUID();
    const body = { amount: 1200, currency: 'usd', payment_method: 'pm_card_chargeDeclined', confirm: true };
    const first = await http('POST', '/v1/payment_intents', { body, headers: { 'idempotency-key': key } });
    const second = await http('POST', '/v1/payment_intents', { body, headers: { 'idempotency-key': key } });
    expect(first.status).toBe(402);
    expect(second.status).toBe(402);
    expect(second.headers.get('idempotent-replayed')).toBe('true');
    expect(second.body).toEqual(first.body);
  });
});

describe('webhook retries', () => {
  let endpointId: string;

  beforeAll(async () => {
    ({ id: endpointId } = await registerSinkEndpoint('retries', ['customer.created']));
  });

  async function deliveryFor(eventId: string) {
    const list = await http<{ data: WebhookDelivery[] }>(
      'GET',
      `/v1/localstripe/webhook_deliveries?event=${eventId}&webhook_endpoint=${endpointId}`,
    );
    return list.body.data[0];
  }

  it('retries automatically after a failed attempt', async () => {
    await sink.failNext('retries', 1);
    const customer = await stripe.customers.create({ name: 'retry-auto' });
    const event = await findEvent(customer.id, 'customer.created');

    const delivery = await waitFor(
      async () => {
        const current = await deliveryFor(event.id);
        return current?.status === 'succeeded' && current;
      },
      { message: 'automatic retry to succeed' },
    );
    expect(delivery.attempts).toBe(2);
    const received = (await sink.received(event.id)).filter((entry) => entry.path === '/webhooks/retries');
    expect(received.map((entry) => entry.respondedWith)).toEqual([500, 200]);
  });

  it('marks a delivery failed after the maximum attempts and supports manual retry', async () => {
    await sink.failNext('retries', 3);
    const customer = await stripe.customers.create({ name: 'retry-manual' });
    const event = await findEvent(customer.id, 'customer.created');

    const failed = await waitFor(
      async () => {
        const current = await deliveryFor(event.id);
        return current?.status === 'failed' && current;
      },
      { message: 'delivery to be marked failed', timeoutMs: 20_000 },
    );
    expect(failed.attempts).toBe(3);
    expect(failed.last_response_status).toBe(500);

    const retried = await http('POST', `/v1/localstripe/webhook_deliveries/${failed.id}/retry`);
    expect(retried.status).toBe(200);
    const succeeded = await waitFor(
      async () => {
        const current = await deliveryFor(event.id);
        return current?.status === 'succeeded' && current;
      },
      { message: 'manual retry to succeed' },
    );
    expect(succeeded.attempts).toBe(4);

    const detail = await http<{ attempt_history: { succeeded: boolean }[] }>(
      'GET',
      `/v1/localstripe/webhook_deliveries/${failed.id}`,
    );
    expect(detail.body.attempt_history.map((attempt) => attempt.succeeded)).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });
});
