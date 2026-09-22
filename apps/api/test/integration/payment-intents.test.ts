import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Loose, type TestApp, createTestApp, resetDatabase } from './helpers/app.js';
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

describe('creating payment intents', () => {
  it('starts in requires_payment_method without a payment method', async () => {
    const paymentIntent = await createPaymentIntent(t, {
      amount: 1990,
      currency: 'EUR',
      description: 'Order #1',
      metadata: { order: '1' },
    });
    expect(paymentIntent).toMatchObject({
      object: 'payment_intent',
      amount: 1990,
      amount_received: 0,
      currency: 'eur',
      status: 'requires_payment_method',
      payment_method: null,
      latest_charge: null,
      last_payment_error: null,
      next_action: null,
      capture_method: 'automatic',
      livemode: false,
      description: 'Order #1',
      metadata: { order: '1' },
    });
    expect(paymentIntent.id).toMatch(/^pi_local_[0-9A-Z]{26}$/);
    expect(paymentIntent.client_secret).toMatch(new RegExp(`^${paymentIntent.id}_secret_`));
  });

  it('starts in requires_confirmation with a payment method', async () => {
    const pm = await createPaymentMethod(t);
    const paymentIntent = await createPaymentIntent(t, { payment_method: pm.id });
    expect(paymentIntent.status).toBe('requires_confirmation');
    expect(paymentIntent.payment_method).toBe(pm.id);
  });

  it('requires a payment method with confirm=true', async () => {
    const response = await t.request('POST', '/v1/payment_intents', {
      amount: 100,
      currency: 'usd',
      confirm: true,
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({
      code: 'parameter_missing',
      param: 'payment_method',
    });
  });

  it('rejects unknown payment methods and customers', async () => {
    const pm = await t.request('POST', '/v1/payment_intents', {
      amount: 100,
      currency: 'usd',
      payment_method: 'pm_local_missing',
    });
    expect(pm.status).toBe(404);
    expect(pm.body.error.param).toBe('payment_method');
    const customer = await t.request('POST', '/v1/payment_intents', {
      amount: 100,
      currency: 'usd',
      customer: 'cus_local_missing',
    });
    expect(customer.status).toBe(404);
  });

  it("rejects payment method types other than 'card'", async () => {
    const response = await t.request('POST', '/v1/payment_intents', {
      amount: 100,
      currency: 'usd',
      payment_method_types: ['sepa_debit'],
    });
    expect(response.status).toBe(400);
  });
});

describe('successful confirmation', () => {
  it('creates a charge, sets latest_charge and emits events in order', async () => {
    const customer = (await t.request('POST', '/v1/customers', {})).body;
    const response = await pay(t, CARDS.visa, { amount: 4200, customer: customer.id });
    expect(response.status).toBe(200);
    const paymentIntent = response.body;
    expect(paymentIntent).toMatchObject({
      status: 'succeeded',
      amount_received: 4200,
      last_payment_error: null,
      customer: customer.id,
    });
    expect(paymentIntent.latest_charge).toMatch(/^ch_local_/);

    const charge = await t.request('GET', `/v1/charges/${paymentIntent.latest_charge}`);
    expect(charge.body).toMatchObject({
      object: 'charge',
      amount: 4200,
      amount_captured: 4200,
      amount_refunded: 0,
      captured: true,
      paid: true,
      refunded: false,
      status: 'succeeded',
      payment_intent: paymentIntent.id,
      payment_method: paymentIntent.payment_method,
      customer: customer.id,
      payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242' } },
      outcome: { type: 'authorized' },
    });

    expect(await eventTypesFor(t, paymentIntent.id)).toEqual([
      'payment_intent.created',
      'payment_intent.succeeded',
    ]);
    const all = await t.request('GET', '/v1/events?limit=100');
    const types = (all.body.data as Loose[]).map((event) => event.type).reverse();
    expect(types.filter((type) => type !== 'customer.created')).toEqual([
      'payment_intent.created',
      'charge.succeeded',
      'payment_intent.succeeded',
    ]);
  });

  it('can confirm while creating and with a payment_method passed to confirm', async () => {
    const pm = await createPaymentMethod(t);
    const created = await t.request('POST', '/v1/payment_intents', {
      amount: 100,
      currency: 'usd',
      payment_method: pm.id,
      confirm: true,
    });
    expect(created.body.status).toBe('succeeded');

    const paymentIntent = await createPaymentIntent(t);
    const confirmed = await t.request('POST', `/v1/payment_intents/${paymentIntent.id}/confirm`, {
      payment_method: pm.id,
    });
    expect(confirmed.body).toMatchObject({ status: 'succeeded', payment_method: pm.id });
  });

  it('refuses to confirm without a payment method', async () => {
    const paymentIntent = await createPaymentIntent(t);
    const response = await t.request('POST', `/v1/payment_intents/${paymentIntent.id}/confirm`);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('payment_intent_unexpected_state');
  });

  it('refuses to confirm a succeeded payment', async () => {
    const response = await pay(t, CARDS.visa);
    const again = await t.request('POST', `/v1/payment_intents/${response.body.id}/confirm`);
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('payment_intent_unexpected_state');
    const charges = await t.request('GET', `/v1/charges?payment_intent=${response.body.id}`);
    expect(charges.body.data).toHaveLength(1);
  });
});

describe('declined confirmation', () => {
  it.each([
    [CARDS.genericDecline, 'card_declined', 'generic_decline'],
    [CARDS.insufficientFunds, 'card_declined', 'insufficient_funds'],
    [CARDS.expiredCard, 'expired_card', 'expired_card'],
  ])('%s → 402 %s/%s', async (number, code, declineCode) => {
    const pm = await createPaymentMethod(t, number);
    const created = await createPaymentIntent(t, { payment_method: pm.id });
    const response = await t.request('POST', `/v1/payment_intents/${created.id}/confirm`);

    expect(response.status).toBe(402);
    const error = response.body.error;
    expect(error).toMatchObject({ type: 'card_error', code, decline_code: declineCode });
    expect(error.message).toContain('Simulated by LocalStripe');
    expect(error.payment_intent).toMatchObject({
      id: created.id,
      status: 'requires_payment_method',
      payment_method: null,
      amount_received: 0,
      last_payment_error: {
        type: 'card_error',
        code,
        decline_code: declineCode,
        payment_method: { id: pm.id },
      },
    });

    const charge = await t.request('GET', `/v1/charges/${error.payment_intent.latest_charge}`);
    expect(charge.body).toMatchObject({
      status: 'failed',
      paid: false,
      captured: false,
      amount_captured: 0,
      failure_code: code,
      outcome: { type: 'issuer_declined', reason: declineCode },
    });

    expect(await eventTypesFor(t, created.id)).toEqual([
      'payment_intent.created',
      'payment_intent.payment_failed',
    ]);
    expect(await eventTypesFor(t, charge.body.id)).toEqual(['charge.failed']);
  });

  it('succeeds when re-confirmed with a good card', async () => {
    const declined = await pay(t, CARDS.genericDecline);
    const paymentIntentId = declined.body.error.payment_intent.id;
    const good = await createPaymentMethod(t, CARDS.visa);

    const retried = await t.request('POST', `/v1/payment_intents/${paymentIntentId}/confirm`, {
      payment_method: good.id,
    });
    expect(retried.status).toBe(200);
    expect(retried.body).toMatchObject({
      status: 'succeeded',
      payment_method: good.id,
      last_payment_error: null,
    });
    const charges = await t.request('GET', `/v1/charges?payment_intent=${paymentIntentId}`);
    expect(charges.body.data.map((charge: Loose) => charge.status)).toEqual([
      'succeeded',
      'failed',
    ]);
  });

  it('declines on create with confirm=true and still returns the PaymentIntent', async () => {
    const response = await t.request('POST', '/v1/payment_intents', {
      amount: 100,
      currency: 'usd',
      payment_method: 'pm_card_chargeDeclinedInsufficientFunds',
      confirm: true,
    });
    expect(response.status).toBe(402);
    expect(response.body.error.payment_intent.status).toBe('requires_payment_method');
  });
});

describe('updating payment intents', () => {
  it('updates amount, currency, description and metadata before confirmation', async () => {
    const paymentIntent = await createPaymentIntent(t, { metadata: { a: '1' } });
    const response = await t.request('POST', `/v1/payment_intents/${paymentIntent.id}`, {
      amount: 3000,
      currency: 'gbp',
      description: 'Updated',
      metadata: { a: '', b: '2' },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      amount: 3000,
      currency: 'gbp',
      description: 'Updated',
      metadata: { b: '2' },
      status: 'requires_payment_method',
    });
  });

  it('moves to requires_confirmation when a payment method is set', async () => {
    const paymentIntent = await createPaymentIntent(t);
    const pm = await createPaymentMethod(t);
    const response = await t.request('POST', `/v1/payment_intents/${paymentIntent.id}`, {
      payment_method: pm.id,
    });
    expect(response.body).toMatchObject({ status: 'requires_confirmation', payment_method: pm.id });
  });

  it('only allows metadata and description changes after success', async () => {
    const succeeded = (await pay(t, CARDS.visa)).body;
    const amount = await t.request('POST', `/v1/payment_intents/${succeeded.id}`, { amount: 1 });
    expect(amount.status).toBe(400);
    expect(amount.body.error.code).toBe('payment_intent_unexpected_state');

    const metadata = await t.request('POST', `/v1/payment_intents/${succeeded.id}`, {
      metadata: { note: 'shipped' },
      description: 'Done',
    });
    expect(metadata.status).toBe(200);
    expect(metadata.body).toMatchObject({
      status: 'succeeded',
      amount: 2000,
      metadata: { note: 'shipped' },
      description: 'Done',
    });
  });
});

describe('listing payment intents', () => {
  it('filters by status and customer', async () => {
    const customer = (await t.request('POST', '/v1/customers', {})).body;
    const open = await createPaymentIntent(t, { customer: customer.id });
    const succeeded = (await pay(t, CARDS.visa, { customer: customer.id })).body;
    const other = (await pay(t, CARDS.visa)).body;

    const byStatus = await t.request('GET', '/v1/payment_intents?status=succeeded');
    expect(byStatus.body.data.map((item: Loose) => item.id)).toEqual([other.id, succeeded.id]);

    const byCustomer = await t.request('GET', `/v1/payment_intents?customer=${customer.id}`);
    expect(byCustomer.body.data.map((item: Loose) => item.id)).toEqual([succeeded.id, open.id]);

    const both = await t.request(
      'GET',
      `/v1/payment_intents?customer=${customer.id}&status=requires_payment_method`,
    );
    expect(both.body.data.map((item: Loose) => item.id)).toEqual([open.id]);

    const invalid = await t.request('GET', '/v1/payment_intents?status=bogus');
    expect(invalid.status).toBe(400);
  });
});
