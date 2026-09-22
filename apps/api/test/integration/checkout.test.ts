import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Loose, type TestApp, createTestApp, resetDatabase } from './helpers/app.js';
import { CARDS, EXP_YEAR, allEventTypes, eventTypesFor } from './helpers/payments.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => resetDatabase(t));

const lineItem = (name: string, unitAmount: number, quantity: number, currency = 'usd') => ({
  price_data: { currency, unit_amount: unitAmount, product_data: { name } },
  quantity,
});

async function createSession(params: Record<string, unknown> = {}): Promise<Loose> {
  const response = await t.request('POST', '/v1/checkout/sessions', {
    success_url: 'http://shop.test/success?session={CHECKOUT_SESSION_ID}',
    cancel_url: 'http://shop.test/cancel',
    line_items: [lineItem('T-shirt', 1500, 2), lineItem('Socks', 500, 1)],
    ...params,
  });
  expect(response.status, response.text).toBe(200);
  return response.body;
}

const complete = (id: string, number: string) =>
  t.request('POST', `/v1/localstripe/checkout/sessions/${id}/complete`, {
    card: { number, exp_month: 12, exp_year: EXP_YEAR, cvc: '123' },
  });

describe('creating sessions', () => {
  it('computes totals and points url to the hosted page', async () => {
    const session = await createSession({ client_reference_id: 'order_1', metadata: { a: 'b' } });
    expect(session).toMatchObject({
      object: 'checkout.session',
      mode: 'payment',
      status: 'open',
      payment_status: 'unpaid',
      amount_subtotal: 3500,
      amount_total: 3500,
      currency: 'usd',
      payment_intent: null,
      client_reference_id: 'order_1',
      metadata: { a: 'b' },
      url: `http://localstripe.test/checkout/${session.id}`,
    });
    expect(session.id).toMatch(/^cs_local_/);
    expect(session.expires_at - session.created).toBeGreaterThanOrEqual(24 * 3600 - 5);
  });

  it('lists line items', async () => {
    const session = await createSession();
    const response = await t.request('GET', `/v1/checkout/sessions/${session.id}/line_items`);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject([
      { object: 'item', description: 'T-shirt', quantity: 2, amount_total: 3000, currency: 'usd' },
      { object: 'item', description: 'Socks', quantity: 1, amount_total: 500 },
    ]);
    expect(response.body.data[0].price).toMatchObject({ unit_amount: 1500 });
  });

  it('rejects mixed currencies, bad URLs and out-of-range expiry', async () => {
    const mixed = await t.request('POST', '/v1/checkout/sessions', {
      success_url: 'http://shop.test/ok',
      line_items: [lineItem('A', 100, 1, 'usd'), lineItem('B', 100, 1, 'eur')],
    });
    expect(mixed.status).toBe(400);

    const badUrl = await t.request('POST', '/v1/checkout/sessions', {
      success_url: 'javascript:alert(1)',
      line_items: [lineItem('A', 100, 1)],
    });
    expect(badUrl.status).toBe(400);
    expect(badUrl.body.error.param).toBe('success_url');

    const expiry = await t.request('POST', '/v1/checkout/sessions', {
      success_url: 'http://shop.test/ok',
      line_items: [lineItem('A', 100, 1)],
      expires_at: Math.floor(Date.now() / 1000) + 60,
    });
    expect(expiry.status).toBe(400);
    expect(expiry.body.error.param).toBe('expires_at');

    const empty = await t.request('POST', '/v1/checkout/sessions', {
      success_url: 'http://shop.test/ok',
      line_items: [],
    });
    expect(empty.status).toBe(400);
  });

  it('lists and filters sessions', async () => {
    const open = await createSession();
    const expired = await createSession();
    await t.request('POST', `/v1/checkout/sessions/${expired.id}/expire`);
    const list = await t.request('GET', '/v1/checkout/sessions?status=open');
    expect(list.body.data.map((item: Loose) => item.id)).toEqual([open.id]);
  });
});

describe('completing sessions', () => {
  it('pays the session and emits checkout.session.completed', async () => {
    const session = await createSession();
    const response = await complete(session.id, CARDS.visa);
    expect(response.status).toBe(200);
    expect(response.body.object).toBe('checkout_completion');
    expect(response.body.checkout_session).toMatchObject({
      status: 'complete',
      payment_status: 'paid',
      url: null,
    });
    expect(response.body.payment_intent).toMatchObject({ status: 'succeeded', amount: 3500 });
    expect(response.body.checkout_session.payment_intent).toBe(response.body.payment_intent.id);

    const events = await eventTypesFor(t, session.id);
    expect(events).toEqual(['checkout.session.completed']);
    const event = await t.request('GET', `/v1/events?type=checkout.session.completed`);
    expect(event.body.data[0].data.object).toMatchObject({
      status: 'complete',
      payment_status: 'paid',
    });

    const again = await complete(session.id, CARDS.visa);
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('checkout_session_unexpected_state');
  });

  it('keeps the session open on decline and reuses the PaymentIntent on retry', async () => {
    const session = await createSession();
    const declined = await complete(session.id, CARDS.genericDecline);
    expect(declined.status).toBe(402);
    expect(declined.body.error).toMatchObject({
      type: 'card_error',
      decline_code: 'generic_decline',
    });
    const paymentIntentId = declined.body.error.payment_intent.id;

    const afterDecline = await t.request('GET', `/v1/checkout/sessions/${session.id}`);
    expect(afterDecline.body).toMatchObject({
      status: 'open',
      payment_status: 'unpaid',
      payment_intent: paymentIntentId,
    });

    const retried = await complete(session.id, CARDS.visa);
    expect(retried.status).toBe(200);
    expect(retried.body.payment_intent.id).toBe(paymentIntentId);
    expect(retried.body.checkout_session.status).toBe('complete');
    const list = await t.request('GET', '/v1/payment_intents');
    expect(list.body.data).toHaveLength(1);
  });

  it('completes after the 3DS challenge', async () => {
    const session = await createSession();
    const response = await complete(session.id, CARDS.threeDS);
    expect(response.status).toBe(200);
    expect(response.body.checkout_session.status).toBe('open');
    const paymentIntent = response.body.payment_intent;
    expect(paymentIntent.status).toBe('requires_action');
    expect(paymentIntent.next_action.redirect_to_url.return_url).toBe(
      `http://localstripe.test/checkout/${session.id}`,
    );

    const authenticated = await t.request(
      'POST',
      `/v1/localstripe/payment_intents/${paymentIntent.id}/authenticate`,
      { outcome: 'succeed' },
    );
    expect(authenticated.body.status).toBe('succeeded');
    const after = await t.request('GET', `/v1/checkout/sessions/${session.id}`);
    expect(after.body).toMatchObject({ status: 'complete', payment_status: 'paid' });
  });

  it('completes unpaid with a processing card and becomes paid after settlement', async () => {
    const session = await createSession();
    const response = await complete(session.id, CARDS.processing);
    expect(response.status).toBe(200);
    expect(response.body.checkout_session).toMatchObject({
      status: 'complete',
      payment_status: 'unpaid',
    });
    expect(response.body.payment_intent.status).toBe('processing');

    await t.worker.tick();
    const after = await t.request('GET', `/v1/checkout/sessions/${session.id}`);
    expect(after.body).toMatchObject({ status: 'complete', payment_status: 'paid' });
    expect(await eventTypesFor(t, session.id)).toEqual([
      'checkout.session.completed',
      'checkout.session.async_payment_succeeded',
    ]);
  });

  it('reports async_payment_failed when a processing payment fails', async () => {
    const session = await createSession();
    await complete(session.id, CARDS.processingDeclined);
    await t.worker.tick();
    const after = await t.request('GET', `/v1/checkout/sessions/${session.id}`);
    expect(after.body).toMatchObject({ status: 'complete', payment_status: 'unpaid' });
    expect(await eventTypesFor(t, session.id)).toEqual([
      'checkout.session.completed',
      'checkout.session.async_payment_failed',
    ]);
  });

  it('accepts an existing payment method', async () => {
    const session = await createSession();
    const response = await t.request(
      'POST',
      `/v1/localstripe/checkout/sessions/${session.id}/complete`,
      { payment_method: 'pm_card_visa' },
    );
    expect(response.status).toBe(200);
    expect(response.body.checkout_session.payment_status).toBe('paid');

    const other = await createSession();
    const none = await t.request(
      'POST',
      `/v1/localstripe/checkout/sessions/${other.id}/complete`,
      {},
    );
    expect(none.status).toBe(400);
  });
});

describe('concurrent completion', () => {
  it('charges a session at most once when it is paid several times at once', async () => {
    const session = await createSession();
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => complete(session.id, CARDS.visa)),
    );
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    for (const response of responses.filter((r) => r.status !== 200)) {
      expect(response.status).toBe(400);
    }
    const paymentIntents = await t.request('GET', '/v1/payment_intents');
    const succeeded = paymentIntents.body.data.filter((pi: Loose) => pi.status === 'succeeded');
    expect(succeeded).toHaveLength(1);
    expect((await t.request('GET', '/v1/charges')).body.data).toHaveLength(1);

    const after = await t.request('GET', `/v1/checkout/sessions/${session.id}`);
    expect(after.body).toMatchObject({
      status: 'complete',
      payment_status: 'paid',
      payment_intent: succeeded[0].id,
    });
    expect(await eventTypesFor(t, session.id)).toEqual(['checkout.session.completed']);
  });
});

describe('expiring sessions', () => {
  it('expires a session that is paid after expires_at', async () => {
    const session = await createSession();
    await t.db
      .updateTable('checkoutSessions')
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where('id', '=', session.id)
      .execute();
    const response = await complete(session.id, CARDS.visa);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('checkout_session_unexpected_state');
    const after = await t.request('GET', `/v1/checkout/sessions/${session.id}`);
    expect(after.body.status).toBe('expired');
    expect(await eventTypesFor(t, session.id)).toEqual(['checkout.session.expired']);
    expect((await t.request('GET', '/v1/payment_intents')).body.data).toHaveLength(0);
  });

  it('expires an open session and emits checkout.session.expired', async () => {
    const session = await createSession();
    const response = await t.request('POST', `/v1/checkout/sessions/${session.id}/expire`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'expired', url: null });
    expect(await eventTypesFor(t, session.id)).toEqual(['checkout.session.expired']);

    const again = await t.request('POST', `/v1/checkout/sessions/${session.id}/expire`);
    expect(again.status).toBe(400);
    const pay = await complete(session.id, CARDS.visa);
    expect(pay.status).toBe(400);
    expect(pay.body.error.code).toBe('checkout_session_unexpected_state');
  });

  it('cancels the abandoned PaymentIntent of an expired session', async () => {
    const session = await createSession();
    const declined = await complete(session.id, CARDS.genericDecline);
    const paymentIntentId = declined.body.error.payment_intent.id;
    await t.request('POST', `/v1/checkout/sessions/${session.id}/expire`);
    const paymentIntent = await t.request('GET', `/v1/payment_intents/${paymentIntentId}`);
    expect(paymentIntent.body).toMatchObject({
      status: 'canceled',
      cancellation_reason: 'abandoned',
    });
  });

  it('refuses to expire a completed session', async () => {
    const session = await createSession();
    await complete(session.id, CARDS.visa);
    const response = await t.request('POST', `/v1/checkout/sessions/${session.id}/expire`);
    expect(response.status).toBe(400);
  });

  it('expires sessions past expires_at in worker maintenance', async () => {
    const session = await createSession();
    await t.db
      .updateTable('checkoutSessions')
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where('id', '=', session.id)
      .execute();
    await t.worker.maintenance();
    const after = await t.request('GET', `/v1/checkout/sessions/${session.id}`);
    expect(after.body.status).toBe('expired');
    expect(await allEventTypes(t)).toEqual(['checkout.session.expired']);
  });
});
