import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestApp, countRows, createTestApp, resetDatabase } from './helpers/app.js';
import { CARDS, EXP_YEAR, createPaymentMethod, eventTypesFor } from './helpers/payments.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => resetDatabase(t));

const TABLES = [
  'api_keys',
  'customers',
  'payment_methods',
  'payment_intents',
  'charges',
  'refunds',
  'checkout_sessions',
  'events',
  'webhook_endpoints',
  'webhook_deliveries',
  'webhook_delivery_attempts',
  'idempotency_keys',
  'jobs',
];

/** Every row of every table, serialized, so card data can be searched for anywhere. */
async function dumpDatabase(): Promise<string> {
  const parts: string[] = [];
  for (const table of TABLES) {
    const result = await sql<{
      row: unknown;
    }>`SELECT row_to_json(t) AS row FROM ${sql.table(table)} t`.execute(t.db);
    parts.push(...result.rows.map((row) => JSON.stringify(row.row)));
  }
  return parts.join('\n');
}

describe('creating payment methods', () => {
  it('returns card details without the number or CVC', async () => {
    const response = await t.request('POST', '/v1/payment_methods', {
      type: 'card',
      card: { number: '4242 4242 4242 4242', exp_month: 7, exp_year: EXP_YEAR, cvc: '123' },
      billing_details: { name: 'Ada', email: 'ada@example.test' },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      object: 'payment_method',
      type: 'card',
      customer: null,
      card: { brand: 'visa', last4: '4242', exp_month: 7, exp_year: EXP_YEAR, funding: 'credit' },
      billing_details: { name: 'Ada', email: 'ada@example.test', phone: null, address: null },
    });
    expect(response.body.id).toMatch(/^pm_local_/);
    expect(response.text).not.toContain('4242424242424242');
    expect(response.body.card).not.toHaveProperty('number');
    expect(response.body.card).not.toHaveProperty('cvc');
  });

  it('gives the same card the same fingerprint', async () => {
    const a = await createPaymentMethod(t, CARDS.visa);
    const b = await createPaymentMethod(t, CARDS.visa);
    const c = await createPaymentMethod(t, CARDS.mastercard);
    expect(a.card.fingerprint).toBe(b.card.fingerprint);
    expect(a.card.fingerprint).not.toBe(c.card.fingerprint);
  });

  it('normalizes two-digit expiry years', async () => {
    const response = await t.request('POST', '/v1/payment_methods', {
      type: 'card',
      card: { number: CARDS.visa, exp_month: 12, exp_year: EXP_YEAR % 100 },
    });
    expect(response.body.card.exp_year).toBe(EXP_YEAR);
  });

  it('rejects numbers outside the catalog with 402 incorrect_number and stores nothing', async () => {
    const response = await t.request(
      'POST',
      '/v1/payment_methods',
      {
        type: 'card',
        card: { number: '4111111111111111', exp_month: 12, exp_year: EXP_YEAR, cvc: '123' },
      },
      { 'idempotency-key': 'unknown-card' },
    );
    expect(response.status).toBe(402);
    expect(response.body.error).toMatchObject({
      type: 'card_error',
      code: 'incorrect_number',
      param: 'card[number]',
    });
    expect(response.text).not.toContain('4111111111111111');
    expect(await countRows(t.db, 'payment_methods')).toBe(0);
    expect(await dumpDatabase()).not.toContain('4111111111111111');
  });

  it.each([
    [{ exp_month: 13 }, 400, 'card[exp_month]'],
    [{ exp_year: 2001 }, 402, 'card[exp_year]'],
    [{ cvc: '12' }, 402, 'card[cvc]'],
    [{ number: 'abcd' }, 400, 'card[number]'],
  ])('rejects invalid card data %j', async (override, status, param) => {
    const response = await t.request('POST', '/v1/payment_methods', {
      type: 'card',
      card: { number: CARDS.visa, exp_month: 12, exp_year: EXP_YEAR, cvc: '123', ...override },
    });
    expect(response.status).toBe(status);
    expect(response.body.error.param).toBe(param);
  });

  it('rejects types other than card', async () => {
    const response = await t.request('POST', '/v1/payment_methods', {
      type: 'sepa_debit',
      card: { number: CARDS.visa, exp_month: 12, exp_year: EXP_YEAR },
    });
    expect(response.status).toBe(400);
    expect(response.body.error.param).toBe('type');
  });
});

describe('card data is never persisted', () => {
  it('does not store the PAN or CVC in any table, event or idempotent response', async () => {
    const number = CARDS.amex;
    const cvc = '7391';
    const customer = await t.request('POST', '/v1/customers', { name: 'Ada' });
    const pm = await t.request(
      'POST',
      '/v1/payment_methods',
      { type: 'card', card: { number, exp_month: 12, exp_year: EXP_YEAR, cvc } },
      { 'idempotency-key': 'pm-create' },
    );
    expect(pm.status).toBe(200);
    await t.request('POST', `/v1/payment_methods/${pm.body.id}/attach`, {
      customer: customer.body.id,
    });
    const pi = await t.request(
      'POST',
      '/v1/payment_intents',
      {
        amount: 500,
        currency: 'usd',
        customer: customer.body.id,
        payment_method: pm.body.id,
        confirm: true,
      },
      { 'idempotency-key': 'pi-create' },
    );
    expect(pi.status).toBe(200);

    const session = await t.request('POST', '/v1/checkout/sessions', {
      success_url: 'http://shop.test/ok',
      line_items: [
        {
          quantity: 1,
          price_data: { currency: 'usd', unit_amount: 100, product_data: { name: 'A' } },
        },
      ],
    });
    const completed = await t.request(
      'POST',
      `/v1/localstripe/checkout/sessions/${session.body.id}/complete`,
      { card: { number, exp_month: 12, exp_year: EXP_YEAR, cvc } },
      { 'idempotency-key': 'checkout-complete' },
    );
    expect(completed.status, completed.text).toBe(200);

    const dump = await dumpDatabase();
    expect(dump).toContain(pm.body.id);
    expect(await countRows(t.db, 'idempotency_keys')).toBe(3);
    expect(dump).not.toContain(number);
    expect(dump).not.toContain('3782 822463 10005');
    expect(dump.toLowerCase()).not.toContain('"cvc"');
    expect(dump).not.toMatch(new RegExp(`[":]${cvc}["},]`));
  });
});

describe('attach and detach', () => {
  it('attaches, lists, sets as default and detaches with events', async () => {
    const customer = (await t.request('POST', '/v1/customers', { name: 'Ada' })).body;
    const pm = await createPaymentMethod(t);

    const attached = await t.request('POST', `/v1/payment_methods/${pm.id}/attach`, {
      customer: customer.id,
    });
    expect(attached.status).toBe(200);
    expect(attached.body.customer).toBe(customer.id);

    const again = await t.request('POST', `/v1/payment_methods/${pm.id}/attach`, {
      customer: customer.id,
    });
    expect(again.status).toBe(200);

    const listed = await t.request('GET', `/v1/customers/${customer.id}/payment_methods`);
    expect(listed.body.data.map((item: { id: string }) => item.id)).toEqual([pm.id]);

    const withDefault = await t.request('POST', `/v1/customers/${customer.id}`, {
      invoice_settings: { default_payment_method: pm.id },
    });
    expect(withDefault.body.invoice_settings.default_payment_method).toBe(pm.id);

    const detached = await t.request('POST', `/v1/payment_methods/${pm.id}/detach`);
    expect(detached.status).toBe(200);
    expect(detached.body.customer).toBeNull();

    const customerAfter = await t.request('GET', `/v1/customers/${customer.id}`);
    expect(customerAfter.body.invoice_settings.default_payment_method).toBeNull();

    expect(await eventTypesFor(t, pm.id)).toEqual([
      'payment_method.attached',
      'payment_method.detached',
    ]);
  });

  it('refuses to attach to a second customer or detach an unattached method', async () => {
    const first = (await t.request('POST', '/v1/customers', {})).body;
    const second = (await t.request('POST', '/v1/customers', {})).body;
    const pm = await createPaymentMethod(t);
    await t.request('POST', `/v1/payment_methods/${pm.id}/attach`, { customer: first.id });

    const conflict = await t.request('POST', `/v1/payment_methods/${pm.id}/attach`, {
      customer: second.id,
    });
    expect(conflict.status).toBe(400);
    expect(conflict.body.error.code).toBe('payment_method_unexpected_state');

    const other = await createPaymentMethod(t);
    const detach = await t.request('POST', `/v1/payment_methods/${other.id}/detach`);
    expect(detach.status).toBe(400);

    const notAttached = await t.request('POST', `/v1/customers/${second.id}`, {
      invoice_settings: { default_payment_method: other.id },
    });
    expect(notAttached.status).toBe(400);
  });

  it("refuses to pay with another customer's payment method", async () => {
    const owner = (await t.request('POST', '/v1/customers', {})).body;
    const pm = await createPaymentMethod(t);
    await t.request('POST', `/v1/payment_methods/${pm.id}/attach`, { customer: owner.id });

    const response = await t.request('POST', '/v1/payment_intents', {
      amount: 100,
      currency: 'usd',
      payment_method: pm.id,
    });
    expect(response.status).toBe(400);
    expect(response.body.error.param).toBe('payment_method');
  });
});

describe('Stripe test tokens', () => {
  it('accepts pm_card_visa as a payment method in a PaymentIntent', async () => {
    const response = await t.request('POST', '/v1/payment_intents', {
      amount: 1000,
      currency: 'usd',
      payment_method: 'pm_card_visa',
      confirm: true,
    });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('succeeded');
    expect(response.body.payment_method).toMatch(/^pm_local_/);
    const pm = await t.request('GET', `/v1/payment_methods/${response.body.payment_method}`);
    expect(pm.body.card).toMatchObject({ brand: 'visa', last4: '4242' });
  });

  it('declines with pm_card_chargeDeclined', async () => {
    const response = await t.request('POST', '/v1/payment_intents', {
      amount: 1000,
      currency: 'usd',
      payment_method: 'pm_card_chargeDeclined',
      confirm: true,
    });
    expect(response.status).toBe(402);
    expect(response.body.error.decline_code).toBe('generic_decline');
  });
});

describe('updating and listing', () => {
  it('updates billing details, metadata and expiry', async () => {
    const pm = await createPaymentMethod(t, CARDS.visa, { metadata: { a: '1' } });
    const response = await t.request('POST', `/v1/payment_methods/${pm.id}`, {
      billing_details: { name: 'Grace' },
      metadata: { a: '', b: '2' },
      card: { exp_month: 3, exp_year: EXP_YEAR + 1 },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      billing_details: { name: 'Grace' },
      metadata: { b: '2' },
      card: { exp_month: 3, exp_year: EXP_YEAR + 1 },
    });
    const expired = await t.request('POST', `/v1/payment_methods/${pm.id}`, {
      card: { exp_year: 2001 },
    });
    expect(expired.status).toBe(402);
  });

  it('lists payment methods and rejects other types', async () => {
    const a = await createPaymentMethod(t);
    const b = await createPaymentMethod(t, CARDS.mastercard);
    const list = await t.request('GET', '/v1/payment_methods?type=card');
    expect(list.body.data.map((item: { id: string }) => item.id)).toEqual([b.id, a.id]);
    const other = await t.request('GET', '/v1/payment_methods?type=sepa_debit');
    expect(other.status).toBe(400);
  });
});
