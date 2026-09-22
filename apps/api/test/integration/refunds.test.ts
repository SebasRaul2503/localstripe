import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Loose, type TestApp, createTestApp, resetDatabase } from './helpers/app.js';
import { CARDS, createPaymentIntent, pay, succeededPayment } from './helpers/payments.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => resetDatabase(t));

const refund = (params: Record<string, unknown>) => t.request('POST', '/v1/refunds', params);
const chargeOf = async (paymentIntent: Loose) =>
  (await t.request('GET', `/v1/charges/${paymentIntent.latest_charge}`)).body;

describe('refunds', () => {
  it('refunds partially, then the remaining amount by default', async () => {
    const paymentIntent = await succeededPayment(t, 1000);

    const partial = await refund({
      payment_intent: paymentIntent.id,
      amount: 300,
      reason: 'requested_by_customer',
      metadata: { ticket: '7' },
    });
    expect(partial.status).toBe(200);
    expect(partial.body).toMatchObject({
      object: 'refund',
      amount: 300,
      currency: 'usd',
      status: 'succeeded',
      reason: 'requested_by_customer',
      charge: paymentIntent.latest_charge,
      payment_intent: paymentIntent.id,
      metadata: { ticket: '7' },
    });
    expect(await chargeOf(paymentIntent)).toMatchObject({ amount_refunded: 300, refunded: false });

    const rest = await refund({ payment_intent: paymentIntent.id });
    expect(rest.status).toBe(200);
    expect(rest.body.amount).toBe(700);
    expect(await chargeOf(paymentIntent)).toMatchObject({ amount_refunded: 1000, refunded: true });

    const again = await refund({ payment_intent: paymentIntent.id });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('charge_already_refunded');
  });

  it('refunds exactly the remaining amount', async () => {
    const paymentIntent = await succeededPayment(t, 1000);
    await refund({ payment_intent: paymentIntent.id, amount: 400 });
    const exact = await refund({ payment_intent: paymentIntent.id, amount: 600 });
    expect(exact.status).toBe(200);
  });

  it('rejects refunding more than the remaining amount', async () => {
    const paymentIntent = await succeededPayment(t, 1000);
    await refund({ payment_intent: paymentIntent.id, amount: 600 });
    const response = await refund({ payment_intent: paymentIntent.id, amount: 401 });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: 'amount_too_large', param: 'amount' });
    expect((await chargeOf(paymentIntent)).amount_refunded).toBe(600);
  });

  it('rejects refunds of payments that did not succeed', async () => {
    const open = await createPaymentIntent(t);
    const response = await refund({ payment_intent: open.id });
    expect(response.status).toBe(400);
    expect(response.body.error.param).toBe('payment_intent');

    const declined = await pay(t, CARDS.genericDecline);
    const failedCharge = declined.body.error.payment_intent.latest_charge;
    const byCharge = await refund({ charge: failedCharge });
    expect(byCharge.status).toBe(400);
    expect(byCharge.body.error.param).toBe('charge');
  });

  it('requires a payment_intent or charge and validates both', async () => {
    const missing = await refund({ amount: 100 });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('parameter_missing');

    const unknown = await refund({ charge: 'ch_local_missing' });
    expect(unknown.status).toBe(404);

    const first = await succeededPayment(t);
    const second = await succeededPayment(t);
    const mismatch = await refund({ payment_intent: first.id, charge: second.latest_charge });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.param).toBe('charge');
  });

  it('refunds by charge id', async () => {
    const paymentIntent = await succeededPayment(t, 1500);
    const response = await refund({ charge: paymentIntent.latest_charge, amount: 500 });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ payment_intent: paymentIntent.id, amount: 500 });
  });

  it('emits refund.created and charge.refunded', async () => {
    const paymentIntent = await succeededPayment(t, 1000);
    const created = (await refund({ payment_intent: paymentIntent.id, amount: 250 })).body;

    const refundEvents = await t.request('GET', `/v1/events?object_id=${created.id}`);
    expect(refundEvents.body.data.map((event: Loose) => event.type)).toEqual(['refund.created']);
    expect(refundEvents.body.data[0].data.object).toMatchObject({ id: created.id, amount: 250 });

    const chargeEvents = await t.request('GET', '/v1/events?type=charge.refunded');
    expect(chargeEvents.body.data).toHaveLength(1);
    expect(chargeEvents.body.data[0].data).toMatchObject({
      object: { id: paymentIntent.latest_charge, amount_refunded: 250, refunded: false },
      previous_attributes: { amount_refunded: 0 },
    });
  });

  it('retrieves, updates and lists refunds', async () => {
    const paymentIntent = await succeededPayment(t, 1000);
    const a = (await refund({ payment_intent: paymentIntent.id, amount: 100 })).body;
    const b = (await refund({ payment_intent: paymentIntent.id, amount: 100 })).body;
    await refund({ payment_intent: (await succeededPayment(t)).id });

    expect((await t.request('GET', `/v1/refunds/${a.id}`)).body).toEqual(a);
    const updated = await t.request('POST', `/v1/refunds/${a.id}`, { metadata: { k: 'v' } });
    expect(updated.body.metadata).toEqual({ k: 'v' });

    const list = await t.request('GET', `/v1/refunds?payment_intent=${paymentIntent.id}`);
    expect(list.body.data.map((item: Loose) => item.id)).toEqual([b.id, a.id]);
    const all = await t.request('GET', '/v1/refunds');
    expect(all.body.data).toHaveLength(3);
  });
});

describe('refund concurrency', () => {
  it('never refunds more than the charge amount', async () => {
    const paymentIntent = await succeededPayment(t, 100);
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => refund({ payment_intent: paymentIntent.id, amount: 30 })),
    );
    const succeeded = responses.filter((response) => response.status === 200);
    const failed = responses.filter((response) => response.status !== 200);
    expect(succeeded).toHaveLength(3);
    for (const response of failed) {
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('amount_too_large');
    }
    const charge = await chargeOf(paymentIntent);
    expect(charge.amount_refunded).toBe(90);

    const list = await t.request('GET', `/v1/refunds?payment_intent=${paymentIntent.id}`);
    const total = list.body.data.reduce((sum: number, item: Loose) => sum + item.amount, 0);
    expect(total).toBe(90);
    expect(total).toBeLessThanOrEqual(100);
  });

  it('serializes concurrent full refunds', async () => {
    const paymentIntent = await succeededPayment(t, 500);
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => refund({ payment_intent: paymentIntent.id })),
    );
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect((await chargeOf(paymentIntent)).amount_refunded).toBe(500);
  });
});
