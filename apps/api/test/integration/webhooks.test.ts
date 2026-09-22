import { verifySignature } from '@localstripe/contracts/signature';
import pino from 'pino';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Worker } from '../../src/worker/worker.js';
import { type Loose, type TestApp, createTestApp, resetDatabase } from './helpers/app.js';
import { type WebhookReceiver, startWebhookReceiver } from './helpers/webhook-receiver.js';

let t: TestApp;
let receiver: WebhookReceiver;
beforeAll(async () => {
  t = await createTestApp({ WEBHOOK_MAX_ATTEMPTS: '3' });
});
afterAll(() => t.close());
beforeEach(async () => {
  await resetDatabase(t);
  receiver = await startWebhookReceiver();
});
afterEach(() => receiver.close());

async function createEndpoint(app: TestApp, params: Record<string, unknown> = {}): Promise<Loose> {
  const response = await app.request('POST', '/v1/webhook_endpoints', {
    url: receiver.url,
    enabled_events: ['*'],
    ...params,
  });
  expect(response.status, response.text).toBe(200);
  return response.body;
}

const createCustomer = (app: TestApp, name = 'Ada') =>
  app.request('POST', '/v1/customers', { name }).then((response) => response.body);

async function deliveriesOf(app: TestApp, query = ''): Promise<Loose[]> {
  const response = await app.request('GET', `/v1/localstripe/webhook_deliveries?${query}`);
  expect(response.status).toBe(200);
  return response.body.data;
}

describe('webhook endpoints', () => {
  it('returns the whsec_ secret only on creation and via the reveal endpoint', async () => {
    const endpoint = await createEndpoint(t, { description: 'Local app', metadata: { a: '1' } });
    expect(endpoint).toMatchObject({
      object: 'webhook_endpoint',
      url: receiver.url,
      enabled_events: ['*'],
      status: 'enabled',
      description: 'Local app',
      metadata: { a: '1' },
    });
    expect(endpoint.secret).toMatch(/^whsec_[A-Za-z0-9]{32}$/);

    const retrieved = await t.request('GET', `/v1/webhook_endpoints/${endpoint.id}`);
    expect(retrieved.body).not.toHaveProperty('secret');
    const listed = await t.request('GET', '/v1/webhook_endpoints');
    expect(listed.body.data[0]).not.toHaveProperty('secret');
    const updated = await t.request('POST', `/v1/webhook_endpoints/${endpoint.id}`, {
      description: 'x',
    });
    expect(updated.body).not.toHaveProperty('secret');

    const revealed = await t.request(
      'GET',
      `/v1/localstripe/webhook_endpoints/${endpoint.id}/secret`,
    );
    expect(revealed.body).toEqual({
      object: 'webhook_endpoint_secret',
      id: endpoint.id,
      secret: endpoint.secret,
    });
  });

  it('validates the url and event types', async () => {
    const badUrl = await t.request('POST', '/v1/webhook_endpoints', {
      url: 'ftp://example.test',
      enabled_events: ['*'],
    });
    expect(badUrl.status).toBe(400);
    const badEvent = await t.request('POST', '/v1/webhook_endpoints', {
      url: receiver.url,
      enabled_events: ['customer.exploded'],
    });
    expect(badEvent.status).toBe(400);
    expect(badEvent.body.error.param).toBe('enabled_events');
    const empty = await t.request('POST', '/v1/webhook_endpoints', {
      url: receiver.url,
      enabled_events: [],
    });
    expect(empty.status).toBe(400);
  });

  it('deletes endpoints', async () => {
    const endpoint = await createEndpoint(t);
    const deleted = await t.request('DELETE', `/v1/webhook_endpoints/${endpoint.id}`);
    expect(deleted.body).toEqual({ id: endpoint.id, object: 'webhook_endpoint', deleted: true });
    expect((await t.request('GET', `/v1/webhook_endpoints/${endpoint.id}`)).status).toBe(404);
    expect((await t.request('GET', '/v1/webhook_endpoints')).body.data).toHaveLength(0);
  });
});

describe('webhook delivery', () => {
  it('delivers signed events with identical LocalStripe and Stripe signatures', async () => {
    const endpoint = await createEndpoint(t);
    const customer = await createCustomer(t);
    const [event] = (await t.request('GET', '/v1/events')).body.data;
    expect(event.pending_webhooks).toBe(1);

    await t.worker.tick();
    expect(receiver.received).toHaveLength(1);
    const [webhook] = receiver.received;
    const signature = webhook!.headers['localstripe-signature'] as string;
    expect(signature).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(webhook!.headers['stripe-signature']).toBe(signature);
    expect(webhook!.headers['content-type']).toContain('application/json');
    expect(webhook!.headers['localstripe-event-id']).toBe(event.id);
    expect(verifySignature(webhook!.body, signature, endpoint.secret)).toMatchObject({ ok: true });
    expect(verifySignature(webhook!.body, signature, 'whsec_wrong')).toMatchObject({ ok: false });

    const payload = JSON.parse(webhook!.body);
    expect(payload).toMatchObject({
      id: event.id,
      object: 'event',
      type: 'customer.created',
      data: { object: { id: customer.id, name: 'Ada' } },
    });

    const [delivery] = await deliveriesOf(t);
    expect(delivery).toMatchObject({
      object: 'webhook_delivery',
      status: 'succeeded',
      attempts: 1,
      event: event.id,
      event_type: 'customer.created',
      webhook_endpoint: endpoint.id,
      last_response_status: 200,
      next_attempt_at: null,
    });
    expect((await t.request('GET', `/v1/events/${event.id}`)).body.pending_webhooks).toBe(0);

    await t.worker.tick();
    expect(receiver.received).toHaveLength(1);
  });

  it('drains a backlog larger than one dispatch batch in a single tick', async () => {
    await createEndpoint(t, { enabled_events: ['customer.created'] });
    for (let index = 0; index < 25; index += 1) await createCustomer(t, `C${index}`);
    await t.worker.tick();
    expect(receiver.received).toHaveLength(25);
    expect(await deliveriesOf(t, 'status=pending')).toHaveLength(0);
  });

  it('delivers each event exactly once when several workers run concurrently', async () => {
    await createEndpoint(t);
    for (let index = 0; index < 10; index += 1) await createCustomer(t, `C${index}`);
    const workers = [t.worker, new Worker(t.services, t.config, pino({ level: 'silent' }))];
    await Promise.all([...workers, ...workers].map((worker) => worker.tick()));
    const ids = receiver.received.map((webhook) => JSON.parse(webhook.body).id);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
    const attempts = await t.db.selectFrom('webhookDeliveryAttempts').select('id').execute();
    expect(attempts).toHaveLength(10);
  });

  it('only delivers subscribed event types', async () => {
    await createEndpoint(t, { enabled_events: ['customer.updated'] });
    const customer = await createCustomer(t);
    await t.request('POST', `/v1/customers/${customer.id}`, { name: 'Changed' });
    await t.request('DELETE', `/v1/customers/${customer.id}`);
    await t.worker.tick();
    expect(receiver.received.map((webhook) => JSON.parse(webhook.body).type)).toEqual([
      'customer.updated',
    ]);
  });

  it('fans out to every subscribed endpoint', async () => {
    const other = await startWebhookReceiver();
    try {
      await createEndpoint(t);
      await createEndpoint(t, { url: other.url, enabled_events: ['customer.created'] });
      await createCustomer(t);
      await t.worker.tick();
      expect(receiver.received).toHaveLength(1);
      expect(other.received).toHaveLength(1);
    } finally {
      await other.close();
    }
  });

  it('does not create deliveries for disabled or deleted endpoints', async () => {
    const disabled = await createEndpoint(t);
    const deleted = await createEndpoint(t);
    await t.request('POST', `/v1/webhook_endpoints/${disabled.id}`, { disabled: true });
    await t.request('DELETE', `/v1/webhook_endpoints/${deleted.id}`);
    await createCustomer(t);
    await t.worker.tick();
    expect(await deliveriesOf(t)).toHaveLength(0);
    expect(receiver.received).toHaveLength(0);

    const enabled = await t.request('POST', `/v1/webhook_endpoints/${disabled.id}`, {
      disabled: false,
    });
    expect(enabled.body.status).toBe('enabled');
    await createCustomer(t);
    await t.worker.tick();
    expect(receiver.received).toHaveLength(1);
  });

  it('records the error for unreachable endpoints until attempts are exhausted', async () => {
    await createEndpoint(t, { url: 'http://127.0.0.1:1/unreachable' });
    await createCustomer(t);
    await t.worker.tick();
    const [delivery] = await deliveriesOf(t);
    expect(delivery).toMatchObject({ status: 'failed', attempts: 3, last_response_status: null });
    expect(delivery.last_error).toMatch(/^Request failed: /);
    const detail = await t.request('GET', `/v1/localstripe/webhook_deliveries/${delivery.id}`);
    expect(detail.body.attempt_history).toHaveLength(3);
    expect(detail.body.attempt_history[0]).toMatchObject({
      attempt: 1,
      succeeded: false,
      response_status: null,
      error: expect.stringMatching(/^Request failed/),
    });
  });
});

describe('webhook retries', () => {
  let slow: TestApp;
  beforeAll(async () => {
    slow = await createTestApp({ WEBHOOK_MAX_ATTEMPTS: '3', WEBHOOK_RETRY_BASE_DELAY_MS: '60000' });
  });
  afterAll(() => slow.close());

  const makeDue = () =>
    slow.db
      .updateTable('webhookDeliveries')
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .execute();

  it('keeps failing deliveries pending with backoff until WEBHOOK_MAX_ATTEMPTS, then fails', async () => {
    receiver.respondWith(500);
    await createEndpoint(slow);
    await createCustomer(slow);

    await slow.worker.tick();
    let [delivery] = await deliveriesOf(slow);
    expect(delivery).toMatchObject({
      status: 'pending',
      attempts: 1,
      last_response_status: 500,
      last_error: 'Endpoint responded with HTTP 500.',
    });
    const now = Math.floor(Date.now() / 1000);
    expect(delivery.next_attempt_at).toBeGreaterThanOrEqual(now + 55);
    expect(delivery.next_attempt_at).toBeLessThanOrEqual(now + 65);

    await slow.worker.tick();
    expect(receiver.received).toHaveLength(1);

    await makeDue();
    await slow.worker.tick();
    [delivery] = await deliveriesOf(slow);
    expect(delivery).toMatchObject({ status: 'pending', attempts: 2 });
    expect(delivery.next_attempt_at).toBeGreaterThanOrEqual(now + 175);

    await makeDue();
    await slow.worker.tick();
    [delivery] = await deliveriesOf(slow);
    expect(delivery).toMatchObject({ status: 'failed', attempts: 3, next_attempt_at: null });
    expect(receiver.received).toHaveLength(3);

    const detail = await slow.request('GET', `/v1/localstripe/webhook_deliveries/${delivery.id}`);
    expect(detail.body.attempt_history.map((attempt: Loose) => attempt.attempt)).toEqual([1, 2, 3]);
    expect(detail.body.attempt_history[0]).toMatchObject({
      succeeded: false,
      response_status: 500,
      response_body: 'status 500',
    });
    expect((await deliveriesOf(slow, 'status=failed')).map((item) => item.id)).toEqual([
      delivery.id,
    ]);

    receiver.respondWith(200);
    const retried = await slow.request(
      'POST',
      `/v1/localstripe/webhook_deliveries/${delivery.id}/retry`,
    );
    expect(retried.status).toBe(200);
    expect(retried.body.status).toBe('pending');
    await slow.worker.tick();
    [delivery] = await deliveriesOf(slow);
    expect(delivery).toMatchObject({ status: 'succeeded', attempts: 4, last_response_status: 200 });
    expect(receiver.received).toHaveLength(4);
  });

  it('succeeds on a later attempt once the endpoint recovers', async () => {
    receiver.respondWith(503);
    await createEndpoint(slow);
    await createCustomer(slow);
    await slow.worker.tick();
    receiver.respondWith(204);
    await makeDue();
    await slow.worker.tick();
    const [delivery] = await deliveriesOf(slow);
    expect(delivery).toMatchObject({ status: 'succeeded', attempts: 2, last_error: null });
  });

  it('marks deliveries to endpoints disabled after the event as failed attempts', async () => {
    receiver.respondWith(500);
    const endpoint = await createEndpoint(slow);
    await createCustomer(slow);
    await slow.worker.tick();
    await slow.request('POST', `/v1/webhook_endpoints/${endpoint.id}`, { disabled: true });
    await makeDue();
    await slow.worker.tick();
    const [delivery] = await deliveriesOf(slow);
    expect(delivery.last_error).toBe('Webhook endpoint is disabled or deleted.');
    expect(receiver.received).toHaveLength(1);
  });

  it('returns 404 when retrying an unknown delivery', async () => {
    const response = await slow.request(
      'POST',
      '/v1/localstripe/webhook_deliveries/wd_local_x/retry',
    );
    expect(response.status).toBe(404);
  });
});

describe('resending events', () => {
  it('re-sends to existing endpoints and to endpoints created after the event', async () => {
    const first = await createEndpoint(t, { enabled_events: ['customer.created'] });
    await createCustomer(t);
    await t.worker.tick();
    expect(receiver.received).toHaveLength(1);
    const [event] = (await t.request('GET', '/v1/events')).body.data;

    const other = await startWebhookReceiver();
    try {
      const second = await createEndpoint(t, { url: other.url });
      await createEndpoint(t, { url: other.url, enabled_events: ['customer.deleted'] });
      const response = await t.request('POST', `/v1/localstripe/events/${event.id}/resend`);
      expect(response.status).toBe(200);
      expect(response.body.data.map((item: Loose) => item.webhook_endpoint).sort()).toEqual(
        [first.id, second.id].sort(),
      );
      expect(response.body.data.every((item: Loose) => item.status === 'pending')).toBe(true);

      await t.worker.tick();
      expect(receiver.received).toHaveLength(2);
      expect(other.received).toHaveLength(1);
      expect(JSON.parse(other.received[0]!.body).id).toBe(event.id);
      const secret = (
        await t.request('GET', `/v1/localstripe/webhook_endpoints/${second.id}/secret`)
      ).body.secret;
      const webhook = other.received[0]!;
      expect(
        verifySignature(webhook.body, webhook.headers['stripe-signature'] as string, secret).ok,
      ).toBe(true);
    } finally {
      await other.close();
    }
  });

  it('returns 404 for unknown events', async () => {
    const response = await t.request('POST', '/v1/localstripe/events/evt_local_missing/resend');
    expect(response.status).toBe(404);
  });
});
