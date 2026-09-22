import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestApp, countRows, createTestApp, resetDatabase } from './helpers/app.js';
import { CARDS, createPaymentIntent, createPaymentMethod } from './helpers/payments.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => resetDatabase(t));

const withKey = (key: string) => ({ 'idempotency-key': key });

describe('idempotent requests', () => {
  it('stores the first response', async () => {
    const response = await t.request('POST', '/v1/customers', { name: 'Ada' }, withKey('k1'));
    expect(response.status).toBe(200);
    expect(response.headers['idempotent-replayed']).toBeUndefined();
    const row = await t.db
      .selectFrom('idempotencyKeys')
      .selectAll()
      .where('key', '=', 'k1')
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      apiKeyId: t.secretKeyId,
      status: 'completed',
      responseStatus: 200,
      requestMethod: 'POST',
      requestPath: '/v1/customers',
    });
    expect(row.responseBody).toEqual(response.body);
  });

  it('replays the same response for the same key and parameters', async () => {
    const first = await t.request(
      'POST',
      '/v1/customers',
      { name: 'Ada', metadata: { a: '1', b: '2' } },
      withKey('k2'),
    );
    const second = await t.request(
      'POST',
      '/v1/customers',
      { metadata: { b: '2', a: '1' }, name: 'Ada' },
      withKey('k2'),
    );
    expect(second.status).toBe(200);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body).toEqual(first.body);
    expect(await countRows(t.db, 'customers')).toBe(1);
    expect(await countRows(t.db, 'events')).toBe(1);
  });

  it('treats form and JSON encodings of the same parameters as identical', async () => {
    const first = await t.request(
      'POST',
      '/v1/payment_intents',
      { amount: 500, currency: 'usd' },
      withKey('k3'),
    );
    const second = await t.request(
      'POST',
      '/v1/payment_intents',
      'amount=500&currency=usd',
      withKey('k3'),
    );
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.id).toBe(first.body.id);
  });

  it('rejects the same key with different parameters', async () => {
    await t.request('POST', '/v1/customers', { name: 'Ada' }, withKey('k4'));
    const response = await t.request('POST', '/v1/customers', { name: 'Grace' }, withKey('k4'));
    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({
      type: 'idempotency_error',
      code: 'idempotency_key_reused',
    });
    const otherPath = await t.request(
      'POST',
      '/v1/payment_intents',
      { amount: 5, currency: 'usd' },
      withKey('k4'),
    );
    expect(otherPath.status).toBe(400);
    expect(otherPath.body.error.type).toBe('idempotency_error');
    expect(await countRows(t.db, 'customers')).toBe(1);
  });

  it('replays card declines (402) without a second attempt', async () => {
    const pm = await createPaymentMethod(t, CARDS.genericDecline);
    const paymentIntent = await createPaymentIntent(t, { payment_method: pm.id });
    const path = `/v1/payment_intents/${paymentIntent.id}/confirm`;
    const first = await t.request('POST', path, {}, withKey('k5'));
    expect(first.status).toBe(402);
    const second = await t.request('POST', path, {}, withKey('k5'));
    expect(second.status).toBe(402);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body).toEqual(first.body);
    const charges = await t.request('GET', `/v1/charges?payment_intent=${paymentIntent.id}`);
    expect(charges.body.data).toHaveLength(1);
  });

  it('does not consume the key when validation fails', async () => {
    const invalid = await t.request('POST', '/v1/customers', { bogus: 1 }, withKey('k6'));
    expect(invalid.status).toBe(400);
    expect(await countRows(t.db, 'idempotency_keys')).toBe(0);
    const valid = await t.request('POST', '/v1/customers', { name: 'Ada' }, withKey('k6'));
    expect(valid.status).toBe(200);
    expect(valid.headers['idempotent-replayed']).toBeUndefined();
  });

  it('scopes keys per API key', async () => {
    const other = await t.services.apiKeys.create('secret', 'other');
    const mine = await t.request('POST', '/v1/customers', { name: 'Ada' }, withKey('k7'));
    const theirs = await t.request(
      'POST',
      '/v1/customers',
      { name: 'Grace' },
      {
        ...withKey('k7'),
        authorization: `Bearer ${other.secret}`,
      },
    );
    expect(theirs.status).toBe(200);
    expect(theirs.headers['idempotent-replayed']).toBeUndefined();
    expect(theirs.body.id).not.toBe(mine.body.id);
  });

  it('ignores the header on GET requests and validates the key length', async () => {
    const get = await t.request('GET', '/v1/customers', undefined, withKey('k8'));
    expect(get.status).toBe(200);
    expect(await countRows(t.db, 'idempotency_keys')).toBe(0);
    const tooLong = await t.request('POST', '/v1/customers', {}, withKey('x'.repeat(256)));
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.type).toBe('idempotency_error');
  });

  it('creates exactly one resource under concurrent requests with the same key', async () => {
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        t.request(
          'POST',
          '/v1/payment_intents',
          { amount: 777, currency: 'usd', payment_method: 'pm_card_visa', confirm: true },
          withKey('race'),
        ),
      ),
    );
    const ok = responses.filter((response) => response.status === 200);
    const conflicts = responses.filter((response) => response.status !== 200);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(new Set(ok.map((response) => response.body.id)).size).toBe(1);
    for (const response of conflicts) {
      expect(response.status).toBe(409);
      expect(response.body.error).toMatchObject({
        type: 'idempotency_error',
        code: 'idempotency_key_in_use',
      });
    }
    expect(await countRows(t.db, 'payment_intents')).toBe(1);
    expect(await countRows(t.db, 'charges')).toBe(1);

    const replay = await t.request(
      'POST',
      '/v1/payment_intents',
      { amount: 777, currency: 'usd', payment_method: 'pm_card_visa', confirm: true },
      withKey('race'),
    );
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.id).toBe(ok[0]!.body.id);
  });

  it('creates exactly one customer under concurrent requests with the same key', async () => {
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        t.request('POST', '/v1/customers', { name: 'Race' }, withKey('race-customer')),
      ),
    );
    const ids = responses.filter((r) => r.status === 200).map((r) => r.body.id);
    expect(ids.length).toBeGreaterThanOrEqual(1);
    expect(new Set(ids).size).toBe(1);
    expect(responses.every((r) => r.status === 200 || r.status === 409)).toBe(true);
    expect(await countRows(t.db, 'customers')).toBe(1);
  });
});
