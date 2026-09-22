import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestApp, createTestApp, resetDatabase } from './helpers/app.js';
import { CARDS, EXP_YEAR, createPaymentIntent, createPaymentMethod } from './helpers/payments.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => resetDatabase(t));

const asPublishable = () => ({ authorization: `Bearer ${t.publishableKey}` });

describe('API key authentication', () => {
  it('requires an API key', async () => {
    const response = await t.request('GET', '/v1/customers', undefined, {
      authorization: undefined,
    });
    expect(response.status).toBe(401);
    expect(response.body.error).toMatchObject({
      type: 'authentication_error',
      code: 'api_key_required',
    });
  });

  it('rejects an unknown key without echoing it', async () => {
    const key = 'sk_test_local_doesnotexist0000000000000000';
    const response = await t.request('GET', '/v1/customers', undefined, {
      authorization: `Bearer ${key}`,
    });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('api_key_invalid');
    expect(response.body.error.message).not.toContain(key);
  });

  it.each(['Bearer', 'Token sk_test_x', 'Bearer not_a_key'])('rejects %j', async (header) => {
    const response = await t.request('GET', '/v1/customers', undefined, { authorization: header });
    expect(response.status).toBe(401);
  });

  it('rejects a revoked key', async () => {
    const key = await t.services.apiKeys.create('secret', 'to revoke');
    const ok = await t.request('GET', '/v1/customers', undefined, {
      authorization: `Bearer ${key.secret}`,
    });
    expect(ok.status).toBe(200);
    const revoke = await t.request('POST', `/v1/localstripe/api_keys/${key.id}/revoke`);
    expect(revoke.status).toBe(200);
    const response = await t.request('GET', '/v1/customers', undefined, {
      authorization: `Bearer ${key.secret}`,
    });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('api_key_invalid');
  });

  it('accepts Basic auth with the key as username (curl -u sk_...:)', async () => {
    const basic = Buffer.from(`${t.secretKey}:`).toString('base64');
    const response = await t.request('GET', '/v1/customers', undefined, {
      authorization: `Basic ${basic}`,
    });
    expect(response.status).toBe(200);
    expect(response.body.object).toBe('list');
  });

  it('does not require a key outside /v1', async () => {
    const response = await t.request('GET', '/health', undefined, { authorization: undefined });
    expect(response.status).toBe(200);
  });
});

describe('publishable keys', () => {
  it('may create payment methods', async () => {
    const response = await t.request(
      'POST',
      '/v1/payment_methods',
      { type: 'card', card: { number: CARDS.visa, exp_month: 12, exp_year: EXP_YEAR } },
      asPublishable(),
    );
    expect(response.status).toBe(200);
    expect(response.body.card.last4).toBe('4242');
  });

  it('may list the test cards', async () => {
    const response = await t.request(
      'GET',
      '/v1/localstripe/test_cards',
      undefined,
      asPublishable(),
    );
    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(10);
  });

  it.each([
    ['GET', '/v1/customers'],
    ['POST', '/v1/payment_intents'],
    ['GET', '/v1/events'],
    ['POST', '/v1/refunds'],
  ])('may not call %s %s', async (method, path) => {
    const response = await t.request(
      method,
      path,
      method === 'POST' ? {} : undefined,
      asPublishable(),
    );
    expect(response.status).toBe(403);
    expect(response.body.error).toMatchObject({
      type: 'invalid_request_error',
      code: 'permission_denied',
    });
  });

  it('must present the matching client_secret to retrieve a PaymentIntent', async () => {
    const paymentIntent = await createPaymentIntent(t);
    const base = `/v1/payment_intents/${paymentIntent.id}`;

    const missing = await t.request('GET', base, undefined, asPublishable());
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatchObject({ code: 'parameter_missing', param: 'client_secret' });

    const wrong = await t.request(
      'GET',
      `${base}?client_secret=${paymentIntent.id}_secret_wrong`,
      undefined,
      asPublishable(),
    );
    expect(wrong.status).toBe(403);

    const right = await t.request(
      'GET',
      `${base}?client_secret=${encodeURIComponent(paymentIntent.client_secret)}`,
      undefined,
      asPublishable(),
    );
    expect(right.status).toBe(200);
    expect(right.body.id).toBe(paymentIntent.id);
  });

  it('must present the matching client_secret to confirm a PaymentIntent', async () => {
    const paymentMethod = await createPaymentMethod(t);
    const paymentIntent = await createPaymentIntent(t, { payment_method: paymentMethod.id });
    const path = `/v1/payment_intents/${paymentIntent.id}/confirm`;

    const missing = await t.request('POST', path, {}, asPublishable());
    expect(missing.status).toBe(400);
    expect(missing.body.error.param).toBe('client_secret');

    const wrong = await t.request('POST', path, { client_secret: 'nope' }, asPublishable());
    expect(wrong.status).toBe(403);

    const unchanged = await t.request('GET', `/v1/payment_intents/${paymentIntent.id}`);
    expect(unchanged.body.status).toBe('requires_confirmation');

    const right = await t.request(
      'POST',
      path,
      { client_secret: paymentIntent.client_secret },
      asPublishable(),
    );
    expect(right.status).toBe(200);
    expect(right.body.status).toBe('succeeded');
  });

  it('cannot use a client_secret of another PaymentIntent', async () => {
    const first = await createPaymentIntent(t);
    const second = await createPaymentIntent(t);
    const response = await t.request(
      'GET',
      `/v1/payment_intents/${second.id}?client_secret=${encodeURIComponent(first.client_secret)}`,
      undefined,
      asPublishable(),
    );
    expect(response.status).toBe(403);
  });
});
