import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Worker } from '../../src/worker/worker.js';
import { type TestApp, createTestApp, resetDatabase } from './helpers/app.js';
import {
  CARDS,
  createPaymentIntent,
  createPaymentMethod,
  eventTypesFor,
  pay,
} from './helpers/payments.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => resetDatabase(t));

describe('3D Secure', () => {
  async function requiresAction(returnUrl?: string) {
    const response = await pay(t, CARDS.threeDS, returnUrl ? { return_url: returnUrl } : {});
    expect(response.status).toBe(200);
    return response.body;
  }

  it('moves to requires_action with a hosted redirect URL', async () => {
    const paymentIntent = await requiresAction('http://shop.test/return');
    expect(paymentIntent.status).toBe('requires_action');
    expect(paymentIntent.next_action).toEqual({
      type: 'redirect_to_url',
      redirect_to_url: { return_url: 'http://shop.test/return', url: expect.any(String) },
    });
    const url = new URL(paymentIntent.next_action.redirect_to_url.url);
    expect(url.origin).toBe('http://localstripe.test');
    expect(url.pathname).toBe(`/3ds/${paymentIntent.id}`);
    expect(url.searchParams.get('client_secret')).toBe(paymentIntent.client_secret);
    expect(await eventTypesFor(t, paymentIntent.id)).toEqual([
      'payment_intent.created',
      'payment_intent.requires_action',
    ]);
  });

  it('succeeds after a successful challenge', async () => {
    const paymentIntent = await requiresAction();
    const response = await t.request(
      'POST',
      `/v1/localstripe/payment_intents/${paymentIntent.id}/authenticate`,
      { outcome: 'succeed' },
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'succeeded',
      next_action: null,
      amount_received: 2000,
    });
    expect(response.body.latest_charge).toMatch(/^ch_local_/);
    expect(await eventTypesFor(t, paymentIntent.id)).toEqual([
      'payment_intent.created',
      'payment_intent.requires_action',
      'payment_intent.succeeded',
    ]);
  });

  it('declines after a failed challenge', async () => {
    const paymentIntent = await requiresAction();
    const response = await t.request(
      'POST',
      `/v1/localstripe/payment_intents/${paymentIntent.id}/authenticate`,
      { outcome: 'fail' },
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'requires_payment_method',
      payment_method: null,
      next_action: null,
      latest_charge: null,
      last_payment_error: {
        type: 'invalid_request_error',
        code: 'payment_intent_authentication_failure',
        payment_method: { id: paymentIntent.payment_method },
      },
    });
    expect(await eventTypesFor(t, paymentIntent.id)).toContain('payment_intent.payment_failed');
  });

  it('cannot authenticate twice or without requires_action', async () => {
    const paymentIntent = await requiresAction();
    const path = `/v1/localstripe/payment_intents/${paymentIntent.id}/authenticate`;
    expect((await t.request('POST', path, {})).status).toBe(200);
    const again = await t.request('POST', path, {});
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('payment_intent_unexpected_state');
  });

  it('requires the client_secret with a publishable key', async () => {
    const paymentIntent = await requiresAction();
    const path = `/v1/localstripe/payment_intents/${paymentIntent.id}/authenticate`;
    const headers = { authorization: `Bearer ${t.publishableKey}` };
    expect((await t.request('POST', path, { outcome: 'succeed' }, headers)).status).toBe(403);
    const ok = await t.request(
      'POST',
      path,
      { outcome: 'succeed', client_secret: paymentIntent.client_secret },
      headers,
    );
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('succeeded');
  });
});

describe('processing payments', () => {
  it('settles to succeeded in the worker', async () => {
    const response = await pay(t, CARDS.processing);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'processing', latest_charge: null });

    await t.worker.tick();
    const settled = await t.request('GET', `/v1/payment_intents/${response.body.id}`);
    expect(settled.body).toMatchObject({ status: 'succeeded', amount_received: 2000 });
    expect(settled.body.latest_charge).toMatch(/^ch_local_/);
    expect(await eventTypesFor(t, response.body.id)).toEqual([
      'payment_intent.created',
      'payment_intent.processing',
      'payment_intent.succeeded',
    ]);
    const settleEvent = await t.request(
      'GET',
      `/v1/events?type=payment_intent.succeeded&object_id=${response.body.id}`,
    );
    expect(settleEvent.body.data[0].request).toEqual({ id: null, idempotency_key: null });

    await t.worker.tick();
    const charges = await t.request('GET', `/v1/charges?payment_intent=${response.body.id}`);
    expect(charges.body.data).toHaveLength(1);
  });

  it('settles to a failure for 4242424242420007', async () => {
    const response = await pay(t, CARDS.processingDeclined);
    expect(response.body.status).toBe('processing');

    await t.worker.tick();
    const settled = await t.request('GET', `/v1/payment_intents/${response.body.id}`);
    expect(settled.body).toMatchObject({
      status: 'requires_payment_method',
      payment_method: null,
      last_payment_error: {
        type: 'card_error',
        code: 'card_declined',
        decline_code: 'generic_decline',
      },
    });
    const charge = await t.request('GET', `/v1/charges/${settled.body.latest_charge}`);
    expect(charge.body.status).toBe('failed');
    expect(await eventTypesFor(t, response.body.id)).toEqual([
      'payment_intent.created',
      'payment_intent.processing',
      'payment_intent.payment_failed',
    ]);
  });

  it('settles each payment once when several workers run concurrently', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) ids.push((await pay(t, CARDS.processing)).body.id);
    const other = new Worker(t.services, t.config, pino({ level: 'silent' }));
    await Promise.all([t.worker.tick(), other.tick(), t.worker.tick(), other.tick()]);
    for (const id of ids) {
      const paymentIntent = await t.request('GET', `/v1/payment_intents/${id}`);
      expect(paymentIntent.body.status).toBe('succeeded');
      expect(await eventTypesFor(t, id)).toEqual([
        'payment_intent.created',
        'payment_intent.processing',
        'payment_intent.succeeded',
      ]);
    }
    expect((await t.request('GET', '/v1/charges?limit=100')).body.data).toHaveLength(5);
    expect(await t.services.jobs.pendingCount()).toBe(0);
  });

  it('does not settle before the processing delay has passed', async () => {
    const slow = await createTestApp({ PAYMENT_SCENARIO_DELAYS: 'processing=60000' });
    try {
      const response = await pay(slow, CARDS.processing);
      await slow.worker.tick();
      const current = await slow.request('GET', `/v1/payment_intents/${response.body.id}`);
      expect(current.body.status).toBe('processing');
    } finally {
      await slow.close();
    }
  });
});

describe('canceling', () => {
  it.each([
    ['requires_payment_method', null],
    ['requires_confirmation', CARDS.visa],
  ])('cancels from %s', async (status, card) => {
    const pm = card ? await createPaymentMethod(t, card) : null;
    const paymentIntent = await createPaymentIntent(t, pm ? { payment_method: pm.id } : {});
    expect(paymentIntent.status).toBe(status);
    const response = await t.request('POST', `/v1/payment_intents/${paymentIntent.id}/cancel`, {
      cancellation_reason: 'requested_by_customer',
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'canceled',
      cancellation_reason: 'requested_by_customer',
    });
    expect(typeof response.body.canceled_at).toBe('number');
    expect(await eventTypesFor(t, paymentIntent.id)).toEqual([
      'payment_intent.created',
      'payment_intent.canceled',
    ]);
  });

  it('cancels from requires_action and clears next_action', async () => {
    const paymentIntent = (await pay(t, CARDS.threeDS)).body;
    const response = await t.request('POST', `/v1/payment_intents/${paymentIntent.id}/cancel`);
    expect(response.body).toMatchObject({
      status: 'canceled',
      next_action: null,
      cancellation_reason: null,
    });
  });

  it.each([
    ['succeeded', CARDS.visa],
    ['processing', CARDS.processing],
  ])('refuses to cancel a %s payment', async (status, card) => {
    const paymentIntent = (await pay(t, card)).body;
    expect(paymentIntent.status).toBe(status);
    const response = await t.request('POST', `/v1/payment_intents/${paymentIntent.id}/cancel`);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('payment_intent_unexpected_state');
  });

  it('refuses to confirm, update or cancel a canceled payment', async () => {
    const paymentIntent = await createPaymentIntent(t);
    await t.request('POST', `/v1/payment_intents/${paymentIntent.id}/cancel`);
    for (const [path, body] of [
      [`/v1/payment_intents/${paymentIntent.id}/confirm`, { payment_method: 'pm_card_visa' }],
      [`/v1/payment_intents/${paymentIntent.id}/cancel`, {}],
      [`/v1/payment_intents/${paymentIntent.id}`, { amount: 5 }],
    ] as const) {
      const response = await t.request('POST', path, body);
      expect(response.status, path).toBe(400);
      expect(response.body.error.code).toBe('payment_intent_unexpected_state');
    }
  });

  it('rejects an unknown cancellation_reason', async () => {
    const paymentIntent = await createPaymentIntent(t);
    const response = await t.request('POST', `/v1/payment_intents/${paymentIntent.id}/cancel`, {
      cancellation_reason: 'bored',
    });
    expect(response.status).toBe(400);
  });
});

describe('concurrency', () => {
  it('lets exactly one of two simultaneous confirmations succeed', async () => {
    const pm = await createPaymentMethod(t);
    const paymentIntent = await createPaymentIntent(t, { payment_method: pm.id });
    const path = `/v1/payment_intents/${paymentIntent.id}/confirm`;
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        t.request('POST', path, {}, { 'localstripe-delay-ms': '50' }),
      ),
    );
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 400, 400, 400, 400]);
    for (const response of responses.filter((r) => r.status === 400)) {
      expect(response.body.error.code).toBe('payment_intent_unexpected_state');
    }
    const charges = await t.request('GET', `/v1/charges?payment_intent=${paymentIntent.id}`);
    expect(charges.body.data).toHaveLength(1);
    expect(await eventTypesFor(t, paymentIntent.id)).toEqual([
      'payment_intent.created',
      'payment_intent.succeeded',
    ]);
  });

  it('lets exactly one simultaneous 3DS authentication win', async () => {
    const paymentIntent = (await pay(t, CARDS.threeDS)).body;
    const path = `/v1/localstripe/payment_intents/${paymentIntent.id}/authenticate`;
    const responses = await Promise.all([
      t.request('POST', path, { outcome: 'succeed' }),
      t.request('POST', path, { outcome: 'fail' }),
      t.request('POST', path, { outcome: 'succeed' }),
    ]);
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
  });
});
