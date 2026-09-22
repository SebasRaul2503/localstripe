import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Loose, type TestApp, createTestApp, resetDatabase } from './helpers/app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => resetDatabase(t));

const ids = (response: Loose) => (response.body.data as Loose[]).map((event) => event.id);
const types = (response: Loose) => (response.body.data as Loose[]).map((event) => event.type);

async function seedEvents() {
  const customer = (await t.request('POST', '/v1/customers', { name: 'A' })).body;
  await t.request('POST', `/v1/customers/${customer.id}`, { name: 'B' });
  const other = (await t.request('POST', '/v1/customers', { name: 'C' })).body;
  await t.request('DELETE', `/v1/customers/${other.id}`);
  return { customer, other };
}

describe('events', () => {
  it('lists newest first and retrieves single events', async () => {
    await seedEvents();
    const list = await t.request('GET', '/v1/events');
    expect(list.status).toBe(200);
    expect(types(list)).toEqual([
      'customer.deleted',
      'customer.created',
      'customer.updated',
      'customer.created',
    ]);
    const event = list.body.data[0];
    expect(event).toMatchObject({
      object: 'event',
      api_version: 'localstripe-v1',
      livemode: false,
      pending_webhooks: 0,
      request: { id: expect.stringMatching(/^req_/), idempotency_key: null },
    });
    expect(event.id).toMatch(/^evt_local_/);

    const retrieved = await t.request('GET', `/v1/events/${event.id}`);
    expect(retrieved.body).toEqual(event);
    expect((await t.request('GET', '/v1/events/evt_local_missing')).status).toBe(404);
  });

  it('filters by type, types[] and object_id', async () => {
    const { customer } = await seedEvents();
    expect(types(await t.request('GET', '/v1/events?type=customer.created'))).toEqual([
      'customer.created',
      'customer.created',
    ]);
    expect(
      types(await t.request('GET', '/v1/events?types[]=customer.updated&types[]=customer.deleted')),
    ).toEqual(['customer.deleted', 'customer.updated']);
    expect(types(await t.request('GET', `/v1/events?object_id=${customer.id}`))).toEqual([
      'customer.updated',
      'customer.created',
    ]);
    expect(types(await t.request('GET', '/v1/events?type=charge.succeeded'))).toEqual([]);
  });

  it('filters by created ranges', async () => {
    const old = (await t.request('POST', '/v1/customers', { name: 'Old' })).body;
    await sql`UPDATE events SET created_at = now() - interval '1 hour' WHERE object_id = ${old.id}`.execute(
      t.db,
    );
    const fresh = (await t.request('POST', '/v1/customers', { name: 'Fresh' })).body;
    const cutoff = Math.floor(Date.now() / 1000) - 600;

    const recent = await t.request('GET', `/v1/events?created[gte]=${cutoff}`);
    expect(recent.body.data.map((event: Loose) => event.data.object.id)).toEqual([fresh.id]);
    const earlier = await t.request('GET', `/v1/events?created[lt]=${cutoff}`);
    expect(earlier.body.data.map((event: Loose) => event.data.object.id)).toEqual([old.id]);
    const exact = await t.request('GET', `/v1/events?created=${earlier.body.data[0].created}`);
    expect(exact.body.data).toHaveLength(1);
    const invalid = await t.request('GET', '/v1/events?created[after]=1');
    expect(invalid.status).toBe(400);
  });

  it('paginates', async () => {
    await seedEvents();
    const all = ids(await t.request('GET', '/v1/events'));
    const first = await t.request('GET', '/v1/events?limit=3');
    expect(ids(first)).toEqual(all.slice(0, 3));
    expect(first.body.has_more).toBe(true);
    const second = await t.request('GET', `/v1/events?limit=3&starting_after=${all[2]}`);
    expect(ids(second)).toEqual(all.slice(3));
    expect(second.body.has_more).toBe(false);
    const back = await t.request('GET', `/v1/events?limit=2&ending_before=${all[3]}`);
    expect(ids(back)).toEqual(all.slice(1, 3));
  });

  it('records the idempotency key of the request that caused the event', async () => {
    await t.request('POST', '/v1/customers', { name: 'K' }, { 'idempotency-key': 'evt-key-1' });
    const list = await t.request('GET', '/v1/events');
    expect(list.body.data[0].request.idempotency_key).toBe('evt-key-1');
  });
});
