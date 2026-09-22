import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestApp, createTestApp, resetDatabase } from './helpers/app.js';
import { CARDS, EXP_YEAR } from './helpers/payments.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ BODY_LIMIT_BYTES: '2048' });
});
afterAll(() => t.close());
beforeEach(() => resetDatabase(t));

describe('error envelope', () => {
  it('answers unknown routes with a Stripe-style 404', async () => {
    const response = await t.request('GET', '/v1/does_not_exist?x=1');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        type: 'invalid_request_error',
        code: 'resource_missing',
        message: 'Unrecognized request URL (GET: /v1/does_not_exist).',
      },
    });
  });

  it('answers unknown objects with resource_missing', async () => {
    const response = await t.request('GET', '/v1/customers/cus_local_missing');
    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({ code: 'resource_missing', param: 'id' });
  });

  it('rejects malformed JSON', async () => {
    const response = await t.app.inject({
      method: 'POST',
      url: '/v1/customers',
      headers: { authorization: `Bearer ${t.secretKey}`, 'content-type': 'application/json' },
      payload: '{"name": ',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatchObject({
      type: 'invalid_request_error',
      code: 'malformed_request',
    });
  });

  it('rejects unsupported content types', async () => {
    const response = await t.app.inject({
      method: 'POST',
      url: '/v1/customers',
      headers: { authorization: `Bearer ${t.secretKey}`, 'content-type': 'text/csv' },
      payload: 'a,b',
    });
    expect(response.statusCode).toBe(415);
    expect(response.json().error.code).toBe('malformed_request');
  });

  it('rejects oversized bodies with 413', async () => {
    const json = await t.request('POST', '/v1/customers', { description: 'x'.repeat(4096) });
    expect(json.status).toBe(413);
    expect(json.body.error.code).toBe('body_too_large');

    const form = await t.request('POST', '/v1/customers', `description=${'x'.repeat(4096)}`);
    expect(form.status).toBe(413);
    expect(form.body.error.code).toBe('body_too_large');
  });

  it('rejects unknown parameters with parameter_unknown', async () => {
    const response = await t.request('POST', '/v1/customers', { name: 'Ada', nickname: 'ada' });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({
      type: 'invalid_request_error',
      code: 'parameter_unknown',
      param: 'nickname',
    });
  });

  it('names nested unknown parameters in bracket notation', async () => {
    const response = await t.request('POST', '/v1/checkout/sessions', {
      success_url: 'http://shop.test/ok',
      line_items: [
        {
          quantity: 1,
          price_data: { currency: 'usd', unit_amount: 100, product_data: { name: 'A' } },
          bogus: 1,
        },
      ],
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({
      code: 'parameter_unknown',
      param: 'line_items[0][bogus]',
    });
  });

  it('reports missing and invalid parameters', async () => {
    const missing = await t.request('POST', '/v1/payment_intents', { amount: 100 });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatchObject({ code: 'parameter_missing', param: 'currency' });

    const missingAmount = await t.request('POST', '/v1/payment_intents', 'currency=usd');
    expect(missingAmount.status).toBe(400);
    expect(missingAmount.body.error).toMatchObject({
      code: 'parameter_missing',
      param: 'amount',
      message: 'Missing required param: amount.',
    });

    const invalid = await t.request('POST', '/v1/payment_intents', { amount: -1, currency: 'usd' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toMatchObject({ code: 'parameter_invalid', param: 'amount' });

    const decimal = await t.request('POST', '/v1/payment_intents', 'amount=10.5&currency=usd');
    expect(decimal.status).toBe(400);
    expect(decimal.body.error.param).toBe('amount');
  });

  it('accepts POST requests without any body', async () => {
    const post = (url: string) =>
      t.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${t.secretKey}` } });

    const customer = await post('/v1/customers');
    expect(customer.statusCode).toBe(200);

    const paymentIntent = await t.request('POST', '/v1/payment_intents', {
      amount: 100,
      currency: 'usd',
    });
    const canceled = await post(`/v1/payment_intents/${paymentIntent.body.id}/cancel`);
    expect(canceled.statusCode).toBe(200);
    expect(canceled.json().status).toBe('canceled');

    const missing = await post('/v1/payment_intents');
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toMatchObject({ code: 'parameter_missing', param: 'amount' });
  });

  it('adds a request-id header to every response', async () => {
    const responses = await Promise.all([
      t.request('GET', '/health'),
      t.request('GET', '/v1/customers'),
      t.request('GET', '/v1/customers', undefined, { authorization: undefined }),
      t.request('GET', '/v1/nope'),
      t.request('POST', '/v1/customers', { bogus: true }),
      t.request('GET', '/checkout/cs_local_missing'),
    ]);
    const ids = responses.map((response) => response.headers['request-id']);
    for (const id of ids) expect(id).toMatch(/^req_[A-Za-z0-9]{16}$/);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('form-encoded bodies', () => {
  it('parses nested brackets for cards and metadata', async () => {
    const pm = await t.request(
      'POST',
      '/v1/payment_methods',
      `type=card&card[number]=${CARDS.visa}&card[exp_month]=12&card[exp_year]=${EXP_YEAR}&card[cvc]=123&metadata[order]=42&billing_details[name]=Ada`,
    );
    expect(pm.status, pm.text).toBe(200);
    expect(pm.body).toMatchObject({
      card: { last4: '4242', exp_month: 12, exp_year: EXP_YEAR },
      metadata: { order: '42' },
      billing_details: { name: 'Ada' },
    });

    const pi = await t.request(
      'POST',
      '/v1/payment_intents',
      `amount=1990&currency=USD&confirm=true&payment_method=${pm.body.id}&metadata[k]=v`,
    );
    expect(pi.status, pi.text).toBe(200);
    expect(pi.body).toMatchObject({
      amount: 1990,
      currency: 'usd',
      status: 'succeeded',
      metadata: { k: 'v' },
    });
  });

  it('parses indexed arrays of nested objects', async () => {
    const response = await t.request(
      'POST',
      '/v1/checkout/sessions',
      [
        'success_url=http%3A%2F%2Fshop.test%2Fok',
        'line_items[0][price_data][currency]=usd',
        'line_items[0][price_data][unit_amount]=1500',
        'line_items[0][price_data][product_data][name]=T-shirt',
        'line_items[0][quantity]=2',
        'line_items[1][price_data][currency]=usd',
        'line_items[1][price_data][unit_amount]=500',
        'line_items[1][price_data][product_data][name]=Socks',
        'line_items[1][quantity]=1',
      ].join('&'),
    );
    expect(response.status, response.text).toBe(200);
    expect(response.body.amount_total).toBe(3500);
  });

  it('parses list query strings with brackets', async () => {
    const response = await t.request(
      'GET',
      '/v1/events?types[]=customer.created&types[]=customer.updated&created[gte]=0',
    );
    expect(response.status, response.text).toBe(200);
  });
});

describe('rate limiting', () => {
  it('answers with a 429 Stripe error once the limit is reached, per API key', async () => {
    const limited = await createTestApp({ RATE_LIMIT_MAX: '3' });
    try {
      const statuses = [];
      for (let index = 0; index < 4; index += 1) {
        statuses.push((await limited.request('GET', '/v1/customers')).status);
      }
      expect(statuses).toEqual([200, 200, 200, 429]);
      const blocked = await limited.request('GET', '/v1/customers');
      expect(blocked.body.error).toMatchObject({ type: 'rate_limit_error', code: 'rate_limit' });
      expect(blocked.headers['request-id']).toBeDefined();

      const otherKey = await limited.request('GET', '/v1/customers', undefined, {
        authorization: `Bearer ${limited.publishableKey}`,
      });
      expect(otherKey.status).toBe(403);
      expect((await limited.request('GET', '/health')).status).toBe(200);
    } finally {
      await limited.close();
    }
  });
});

describe('CORS', () => {
  it('allows the dashboard origin and the LocalStripe headers', async () => {
    const response = await t.app.inject({
      method: 'OPTIONS',
      url: '/v1/customers',
      headers: {
        origin: 'http://localhost:3002',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,idempotency-key,localstripe-delay-ms',
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3002');
    expect(String(response.headers['access-control-allow-headers'])).toContain('idempotency-key');

    const other = await t.app.inject({
      method: 'OPTIONS',
      url: '/v1/customers',
      headers: { origin: 'http://evil.test', 'access-control-request-method': 'POST' },
    });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('STRICT_PARAMS=false', () => {
  let lenient: TestApp;
  beforeAll(async () => {
    lenient = await createTestApp({ STRICT_PARAMS: 'false' });
  });
  afterAll(() => lenient.close());

  it('ignores unknown parameters', async () => {
    const response = await lenient.request('POST', '/v1/customers', {
      name: 'Ada',
      nickname: 'ada',
    });
    expect(response.status).toBe(200);
    expect(response.body.name).toBe('Ada');
    expect(response.body).not.toHaveProperty('nickname');

    const list = await lenient.request('GET', '/v1/customers?unknown_filter=1');
    expect(list.status).toBe(200);
  });
});
