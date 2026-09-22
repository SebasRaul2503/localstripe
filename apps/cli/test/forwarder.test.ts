import { describe, expect, it } from 'vitest';
import { LocalStripe, type List, type LocalStripeEvent } from '@localstripe/sdk';
import {
  EventForwarder,
  generateWebhookSecret,
  type EventSource,
} from '../src/listen/forwarder.js';

const secret = 'whsec_forwarder_test';

const event = (id: string, created: number, type = 'payment_intent.succeeded') =>
  ({
    id,
    object: 'event',
    type,
    created,
    data: { object: { id: 'pi_1' } },
  }) as unknown as LocalStripeEvent;

/** Serves events newest first, honouring `created.gte` and `starting_after` like the API. */
function source(store: LocalStripeEvent[]): EventSource & { calls: number } {
  const fake = {
    calls: 0,
    async list(params: Parameters<EventSource['list']>[0]): Promise<List<LocalStripeEvent>> {
      fake.calls++;
      let data = [...store]
        .filter((e) => e.created >= params.created.gte)
        .sort((a, b) => b.id.localeCompare(a.id));
      if (params.starting_after) data = data.filter((e) => e.id < params.starting_after!);
      return {
        object: 'list',
        data: data.slice(0, params.limit),
        has_more: data.length > params.limit,
        url: '/v1/events',
      };
    },
  };
  return fake;
}

function receiver() {
  const received: { event: LocalStripeEvent; headers: Headers }[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    const body = String(init.body);
    received.push({
      event: LocalStripe.webhooks.constructEvent(body, headers.get('stripe-signature')!, secret, 0),
      headers,
    });
    return new Response('ok', { status: 200 });
  }) as typeof globalThis.fetch;
  return { fetch, received };
}

describe('EventForwarder', () => {
  it('forwards only events created after start, oldest first, signed', async () => {
    const now = 1_000_000;
    const store = [event('evt_01', now - 10)];
    const { fetch, received } = receiver();
    const forwarder = new EventForwarder({
      events: source(store),
      forwardTo: 'http://localhost:4242/webhooks',
      secret,
      fetch,
      now: () => now,
    });
    await forwarder.start();

    store.push(event('evt_03', now + 1, 'charge.succeeded'), event('evt_02', now));
    const results: string[] = [];
    await forwarder.poll((result) => results.push(`${result.event.id}:${result.status}`));

    expect(results).toEqual(['evt_02:200', 'evt_03:200']);
    expect(received.map((r) => r.event.id)).toEqual(['evt_02', 'evt_03']);
    expect(received[0]!.headers.get('localstripe-signature')).toBe(
      received[0]!.headers.get('stripe-signature'),
    );
    expect(received[0]!.headers.get('localstripe-event-id')).toBe('evt_02');

    await forwarder.poll((result) => results.push(result.event.id));
    expect(results).toHaveLength(2);
  });

  it('picks up late-committed events inside the overlap window', async () => {
    let now = 2_000_000;
    const store: LocalStripeEvent[] = [];
    const { fetch, received } = receiver();
    const forwarder = new EventForwarder({
      events: source(store),
      forwardTo: 'http://x',
      secret,
      fetch,
      now: () => now,
    });
    await forwarder.start();
    store.push(event('evt_10', now + 5));
    await forwarder.poll(() => {});
    now += 5;
    store.push(event('evt_09', now - 2));
    await forwarder.poll(() => {});
    expect(received.map((r) => r.event.id)).toEqual(['evt_10', 'evt_09']);
  });

  it('filters by event type and follows pagination', async () => {
    const now = 3_000_000;
    const store: LocalStripeEvent[] = [];
    const { fetch, received } = receiver();
    const events = source(store);
    const forwarder = new EventForwarder({
      events,
      forwardTo: 'http://x',
      secret,
      fetch,
      now: () => now,
      eventTypes: ['charge.succeeded'],
    });
    await forwarder.start();
    for (let i = 100; i < 250; i++) {
      store.push(event(`evt_${i}`, now, i % 50 === 0 ? 'charge.succeeded' : 'customer.created'));
    }
    const calls = events.calls;
    await forwarder.poll(() => {});
    expect(events.calls - calls).toBe(2);
    expect(received.map((r) => r.event.id)).toEqual(['evt_100', 'evt_150', 'evt_200']);
  });

  it('reports connection errors instead of throwing', async () => {
    const forwarder = new EventForwarder({
      events: source([]),
      forwardTo: 'http://x',
      secret,
      fetch: (async () => {
        throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') });
      }) as typeof globalThis.fetch,
    });
    const result = await forwarder.forward(event('evt_1', 1));
    expect(result.status).toBeUndefined();
    expect(result.error).toBe('connect ECONNREFUSED');
  });

  it('generates whsec_ secrets', () => {
    expect(generateWebhookSecret()).toMatch(/^whsec_[A-Za-z0-9_-]{32}$/);
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
  });
});
