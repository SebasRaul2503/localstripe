import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Loose, type TestApp, createTestApp, resetDatabase } from './helpers/app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => resetDatabase(t));

async function createCustomer(params: Record<string, unknown> = {}): Promise<Loose> {
  const response = await t.request('POST', '/v1/customers', params);
  expect(response.status, response.text).toBe(200);
  return response.body;
}

async function eventsOf(objectId: string): Promise<Loose[]> {
  const response = await t.request('GET', `/v1/events?object_id=${objectId}`);
  return [...response.body.data].reverse();
}

describe('customers CRUD', () => {
  it('creates a customer with all fields', async () => {
    const customer = await createCustomer({
      email: 'ada@example.test',
      name: 'Ada Lovelace',
      phone: '+1 555',
      description: 'First programmer',
      address: { line1: '1 Analytical St', city: 'London', country: 'GB' },
      metadata: { tier: 'gold' },
    });
    expect(customer).toMatchObject({
      object: 'customer',
      email: 'ada@example.test',
      name: 'Ada Lovelace',
      phone: '+1 555',
      description: 'First programmer',
      address: { line1: '1 Analytical St', city: 'London', country: 'GB', line2: null },
      metadata: { tier: 'gold' },
      livemode: false,
      invoice_settings: { default_payment_method: null },
    });
    expect(customer.id).toMatch(/^cus_local_[0-9A-Z]{26}$/);
    expect(typeof customer.created).toBe('number');
  });

  it('creates an empty customer without a body', async () => {
    const response = await t.request('POST', '/v1/customers');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ email: null, name: null, metadata: {}, address: null });
  });

  it('retrieves and updates a customer', async () => {
    const customer = await createCustomer({ name: 'Ada', email: 'ada@example.test' });
    const retrieved = await t.request('GET', `/v1/customers/${customer.id}`);
    expect(retrieved.body).toEqual(customer);

    const updated = await t.request('POST', `/v1/customers/${customer.id}`, {
      name: 'Ada King',
      email: '',
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: 'Ada King', email: null });
  });

  it('merges, deletes and clears metadata like Stripe', async () => {
    const customer = await createCustomer({ metadata: { a: '1', b: '2' } });
    const merged = await t.request('POST', `/v1/customers/${customer.id}`, {
      metadata: { b: '', c: '3' },
    });
    expect(merged.body.metadata).toEqual({ a: '1', c: '3' });

    const unchanged = await t.request('POST', `/v1/customers/${customer.id}`, { name: 'x' });
    expect(unchanged.body.metadata).toEqual({ a: '1', c: '3' });

    const cleared = await t.request('POST', `/v1/customers/${customer.id}`, 'metadata=');
    expect(cleared.status, cleared.text).toBe(200);
    expect(cleared.body.metadata).toEqual({});
  });

  it('rejects more than 50 metadata keys', async () => {
    const metadata = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, 'v']));
    const response = await t.request('POST', '/v1/customers', { metadata });
    expect(response.status).toBe(400);
    expect(response.body.error.param).toBe('metadata');
  });

  it('deletes a customer and returns a deleted stub afterwards', async () => {
    const customer = await createCustomer({ name: 'Temp' });
    const deleted = await t.request('DELETE', `/v1/customers/${customer.id}`);
    expect(deleted.body).toEqual({ id: customer.id, object: 'customer', deleted: true });

    const retrieved = await t.request('GET', `/v1/customers/${customer.id}`);
    expect(retrieved.status).toBe(200);
    expect(retrieved.body).toEqual({ id: customer.id, object: 'customer', deleted: true });

    expect((await t.request('DELETE', `/v1/customers/${customer.id}`)).status).toBe(404);
    expect((await t.request('POST', `/v1/customers/${customer.id}`, { name: 'x' })).status).toBe(
      404,
    );
    const list = await t.request('GET', '/v1/customers');
    expect(list.body.data).toHaveLength(0);

    const paymentIntent = await t.request('POST', '/v1/payment_intents', {
      amount: 100,
      currency: 'usd',
      customer: customer.id,
    });
    expect(paymentIntent.status).toBe(404);
    expect(paymentIntent.body.error.param).toBe('customer');
  });

  it('emits customer.created, customer.updated (with previous_attributes) and customer.deleted', async () => {
    const customer = await createCustomer({ name: 'Ada', metadata: { a: '1' } });
    await t.request('POST', `/v1/customers/${customer.id}`, {
      name: 'Ada K',
      metadata: { b: '2' },
    });
    await t.request('DELETE', `/v1/customers/${customer.id}`);

    const events = await eventsOf(customer.id);
    expect(events.map((event) => event.type)).toEqual([
      'customer.created',
      'customer.updated',
      'customer.deleted',
    ]);
    const [created, updated] = events;
    expect(created.data.object).toMatchObject({ id: customer.id, name: 'Ada' });
    expect(updated.data.object).toMatchObject({ name: 'Ada K', metadata: { a: '1', b: '2' } });
    expect(updated.data.previous_attributes).toEqual({ name: 'Ada', metadata: { a: '1' } });
    expect(created.request.id).toMatch(/^req_/);
  });
});

describe('listing customers', () => {
  let ids: string[];
  beforeEach(async () => {
    ids = [];
    for (let index = 0; index < 5; index += 1) {
      ids.push(
        (await createCustomer({ email: `user${index}@example.test`, name: `User ${index}` })).id,
      );
    }
  });

  const listIds = async (query: string) => {
    const response = await t.request('GET', `/v1/customers?${query}`);
    expect(response.status, response.text).toBe(200);
    return {
      ids: (response.body.data as Loose[]).map((item) => item.id),
      hasMore: response.body.has_more,
    };
  };

  it('lists newest first with limit and has_more', async () => {
    expect(await listIds('limit=2')).toEqual({ ids: [ids[4], ids[3]], hasMore: true });
    expect(await listIds('limit=5')).toEqual({ ids: [...ids].reverse(), hasMore: false });
  });

  it('pages with starting_after', async () => {
    expect(await listIds(`limit=2&starting_after=${ids[3]}`)).toEqual({
      ids: [ids[2], ids[1]],
      hasMore: true,
    });
    expect(await listIds(`limit=2&starting_after=${ids[1]}`)).toEqual({
      ids: [ids[0]],
      hasMore: false,
    });
  });

  it('pages with ending_before', async () => {
    expect(await listIds(`limit=2&ending_before=${ids[1]}`)).toEqual({
      ids: [ids[3], ids[2]],
      hasMore: true,
    });
    expect(await listIds(`limit=2&ending_before=${ids[3]}`)).toEqual({
      ids: [ids[4]],
      hasMore: false,
    });
  });

  it('validates limit', async () => {
    expect((await t.request('GET', '/v1/customers?limit=0')).status).toBe(400);
    expect((await t.request('GET', '/v1/customers?limit=101')).status).toBe(400);
  });

  it('filters by exact email, case-insensitively', async () => {
    expect((await listIds('email=USER2@example.test')).ids).toEqual([ids[2]]);
    expect((await listIds('email=user')).ids).toEqual([]);
  });

  it('searches id, email and name with query', async () => {
    expect((await listIds('query=user 3')).ids).toEqual([ids[3]]);
    expect((await listIds('query=user4@')).ids).toEqual([ids[4]]);
    expect((await listIds(`query=${ids[1]}`)).ids).toEqual([ids[1]]);
    expect((await listIds('query=%25')).ids).toEqual([]);
  });
});
