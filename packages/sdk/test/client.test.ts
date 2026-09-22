import { describe, expect, it } from 'vitest';
import { LocalStripe } from '../src/index.js';
import { fakeFetch, list } from './fake-fetch.js';

const API_KEY = 'sk_test_local_unit';

function client(...responses: Parameters<typeof fakeFetch>) {
  const fake = fakeFetch(...responses);
  const localstripe = new LocalStripe({
    apiKey: API_KEY,
    baseUrl: 'http://api.test/',
    fetch: fake.fetch,
  });
  return { localstripe, requests: fake.requests };
}

describe('requests', () => {
  it('sends the bearer key, JSON body and user agent', async () => {
    const { localstripe, requests } = client({ body: { id: 'pi_1', object: 'payment_intent' } });
    const result = await localstripe.paymentIntents.create({
      amount: 1990,
      currency: 'pen',
      payment_method: 'pm_card_visa',
      confirm: true,
      metadata: { order: '1' },
    });

    expect(result.id).toBe('pi_1');
    const [request] = requests;
    expect(request?.method).toBe('POST');
    expect(request?.url.href).toBe('http://api.test/v1/payment_intents');
    expect(request?.headers['authorization']).toBe(`Bearer ${API_KEY}`);
    expect(request?.headers['content-type']).toBe('application/json');
    expect(request?.headers['user-agent']).toMatch(/^localstripe-sdk-node\//);
    expect(request?.headers['idempotency-key']).toBeUndefined();
    expect(request?.body).toEqual({
      amount: 1990,
      currency: 'pen',
      payment_method: 'pm_card_visa',
      confirm: true,
      metadata: { order: '1' },
    });
  });

  it('encodes list params including nested objects and arrays', async () => {
    const { localstripe, requests } = client({ body: list([]) });
    await localstripe.events.list({
      limit: 5,
      created: { gte: 100, lt: 200 },
      types: ['charge.succeeded', 'refund.created'],
      type: undefined,
    });

    const url = requests[0]!.url;
    expect(url.pathname).toBe('/v1/events');
    expect(decodeURIComponent(url.search)).toBe(
      '?limit=5&created[gte]=100&created[lt]=200&types[0]=charge.succeeded&types[1]=refund.created',
    );
    expect(requests[0]!.body).toBeUndefined();
  });

  it('url-encodes ids in paths', async () => {
    const { localstripe, requests } = client({ body: {} });
    await localstripe.customers.retrieve('cus/../x');
    expect(requests[0]!.url.pathname).toBe('/v1/customers/cus%2F..%2Fx');
  });

  it('sends idempotency and delay headers from request options', async () => {
    const { localstripe, requests } = client({ body: {} });
    await localstripe.paymentIntents.confirm(
      'pi_1',
      { payment_method: 'pm_card_visa' },
      { idempotencyKey: 'order-1', delayMs: 0 },
    );
    expect(requests[0]!.url.pathname).toBe('/v1/payment_intents/pi_1/confirm');
    expect(requests[0]!.headers['idempotency-key']).toBe('order-1');
    expect(requests[0]!.headers['localstripe-delay-ms']).toBe('0');
  });

  it('uses DELETE for del()', async () => {
    const { localstripe, requests } = client({ body: { id: 'cus_1', deleted: true } });
    await localstripe.customers.del('cus_1');
    expect(requests[0]!.method).toBe('DELETE');
    expect(requests[0]!.headers['content-type']).toBeUndefined();
  });

  it('calls health() without an API key', async () => {
    const fake = fakeFetch({ body: { status: 'ok', service: 'localstripe-api' } });
    const localstripe = new LocalStripe({ fetch: fake.fetch });
    await expect(localstripe.health()).resolves.toEqual({
      status: 'ok',
      service: 'localstripe-api',
    });
    expect(fake.requests[0]!.url.href).toBe('http://localhost:9001/health');
    expect(fake.requests[0]!.headers['authorization']).toBeUndefined();
  });

  it('routes LocalStripe extensions to /v1/localstripe', async () => {
    const { localstripe, requests } = client({ body: {} });
    await localstripe.localstripe.trigger('payment_intent.succeeded');
    await localstripe.localstripe.authenticatePaymentIntent('pi_1', 'fail');
    await localstripe.localstripe.completeCheckoutSession('cs_1', {
      payment_method: 'pm_card_visa',
    });
    await localstripe.localstripe.reset();
    await localstripe.localstripe.webhookDeliveries.retry('whd_1');
    await localstripe.checkout.sessions.expire('cs_1');

    expect(requests.map((r) => `${r.method} ${r.url.pathname}`)).toEqual([
      'POST /v1/localstripe/trigger',
      'POST /v1/localstripe/payment_intents/pi_1/authenticate',
      'POST /v1/localstripe/checkout/sessions/cs_1/complete',
      'POST /v1/localstripe/reset',
      'POST /v1/localstripe/webhook_deliveries/whd_1/retry',
      'POST /v1/checkout/sessions/cs_1/expire',
    ]);
    expect(requests[0]!.body).toEqual({ event: 'payment_intent.succeeded' });
    expect(requests[1]!.body).toEqual({ outcome: 'fail' });
    expect(requests[3]!.body).toEqual({ confirm: true });
  });
});

describe('pagination', () => {
  it('iterates every page following starting_after', async () => {
    const { localstripe, requests } = client(
      { body: list([{ id: 'cus_3' }, { id: 'cus_2' }], true) },
      { body: list([{ id: 'cus_1' }], false) },
    );
    const ids: string[] = [];
    for await (const customer of localstripe.customers.listAll({ limit: 2, email: 'a@b.c' })) {
      ids.push(customer.id);
    }
    expect(ids).toEqual(['cus_3', 'cus_2', 'cus_1']);
    expect(requests).toHaveLength(2);
    expect(requests[0]!.url.searchParams.get('starting_after')).toBeNull();
    expect(requests[1]!.url.searchParams.get('starting_after')).toBe('cus_2');
    expect(requests[1]!.url.searchParams.get('email')).toBe('a@b.c');
  });

  it('walks backwards when ending_before is given', async () => {
    const { localstripe, requests } = client(
      { body: list([{ id: 'evt_5' }, { id: 'evt_4' }], true) },
      { body: list([{ id: 'evt_6' }], false) },
    );
    const ids: string[] = [];
    for await (const event of localstripe.events.listAll({ ending_before: 'evt_3', limit: 2 })) {
      ids.push(event.id);
    }
    expect(ids).toEqual(['evt_4', 'evt_5', 'evt_6']);
    expect(requests[1]!.url.searchParams.get('ending_before')).toBe('evt_5');
  });

  it('stops on an empty page', async () => {
    const { localstripe, requests } = client({ body: list([], true) });
    const items = [];
    for await (const item of localstripe.refunds.listAll()) items.push(item);
    expect(items).toEqual([]);
    expect(requests).toHaveLength(1);
  });
});
