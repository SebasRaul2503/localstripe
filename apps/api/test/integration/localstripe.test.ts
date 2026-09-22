import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/http/server.js';
import { Metrics } from '../../src/infrastructure/metrics.js';
import { TRIGGERABLE_EVENTS } from '../../src/modules/localstripe/fixtures.service.js';
import {
  type Loose,
  type TestApp,
  countRows,
  createTestApp,
  resetDatabase,
} from './helpers/app.js';
import { CARDS, pay, succeededPayment } from './helpers/payments.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => resetDatabase(t));

describe('operational endpoints', () => {
  it('serves /health and /ready without authentication', async () => {
    const health = await t.request('GET', '/health', undefined, { authorization: undefined });
    expect(health.body).toEqual({ status: 'ok', service: 'localstripe-api' });
    const ready = await t.request('GET', '/ready', undefined, { authorization: undefined });
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: 'ready', checks: { database: 'ok' } });
  });

  it('reports not ready when the worker is unhealthy', async () => {
    const app = await buildServer({
      config: t.config,
      db: t.db,
      logger: pino({ level: 'silent' }),
      metrics: new Metrics(),
      services: t.services,
      workerHealthy: () => false,
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/ready' });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        status: 'not_ready',
        checks: { database: 'ok', worker: 'failing' },
      });
    } finally {
      await app.close();
    }
  });

  it('exposes Prometheus metrics', async () => {
    await t.request('GET', '/v1/customers');
    await pay(t, CARDS.visa);
    const response = await t.request('GET', '/metrics', undefined, { authorization: undefined });
    expect(response.status).toBe(200);
    expect(String(response.headers['content-type'])).toContain('text/plain');
    expect(response.text).toContain(
      'localstripe_http_requests_total{method="GET",route="/v1/customers",status="200"}',
    );
    expect(response.text).toMatch(/localstripe_payment_outcomes_total\{outcome="succeeded"\} \d+/);
  });

  it('publishes the OpenAPI document and the API root', async () => {
    const response = await t.request('GET', '/openapi.json', undefined, {
      authorization: undefined,
    });
    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe('3.1.0');
    expect(Object.keys(response.body.paths)).toEqual(
      expect.arrayContaining(['/v1/payment_intents', '/v1/customers', '/v1/refunds']),
    );
    expect(response.text).not.toContain('/checkout/{id}/pay');

    const root = await t.request('GET', '/', undefined, { authorization: undefined });
    expect(root.body).toMatchObject({ name: 'LocalStripe', api: 'http://localstripe.test/v1' });
  });

  it('describes the effective configuration without secrets', async () => {
    const response = await t.request('GET', '/v1/localstripe/config');
    expect(response.body).toMatchObject({
      object: 'localstripe_config',
      strict_params: true,
      payments: { scenario_delays_ms: { processing: 0 }, custom_catalog: false },
      webhooks: { retry_base_delay_ms: 0 },
    });
    expect(response.text).not.toContain('postgres://');
  });

  it('lists the test card catalog', async () => {
    const response = await t.request('GET', '/v1/localstripe/test_cards');
    expect(response.body.data).toHaveLength(t.services.catalog.list().length);
    expect(response.body.data[0]).toMatchObject({ object: 'test_card', id: 'visa_success' });
  });
});

describe('stats', () => {
  it('summarizes payments, refunds, customers, events and deliveries', async () => {
    await t.request('POST', '/v1/customers', { name: 'Ada' });
    const paid = await succeededPayment(t, 1000);
    await succeededPayment(t, 500);
    await pay(t, CARDS.genericDecline, { amount: 700 });
    await pay(t, CARDS.visa, { amount: 300, currency: 'eur' });
    await t.request('POST', '/v1/refunds', { payment_intent: paid.id, amount: 250 });
    await t.request('POST', '/v1/payment_intents', { amount: 50, currency: 'usd' });

    const response = await t.request('GET', '/v1/localstripe/stats');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      object: 'stats',
      payment_intents: {
        total: 5,
        by_status: { succeeded: 3, requires_payment_method: 2 },
        failed: 1,
      },
      volume: [
        { currency: 'eur', succeeded_amount: 300, refunded_amount: 0 },
        { currency: 'usd', succeeded_amount: 1500, refunded_amount: 250 },
      ],
      customers: 1,
      refunds: 1,
      events: await countRows(t.db, 'events'),
      webhook_deliveries: { pending: 0, succeeded: 0, failed: 0 },
    });
  });
});

describe('trigger', () => {
  it.each(TRIGGERABLE_EVENTS)('triggers %s', async (event) => {
    const response = await t.request('POST', '/v1/localstripe/trigger', { event });
    expect(response.status, response.text).toBe(200);
    expect(response.body).toMatchObject({ object: 'trigger_result', event });
    expect(response.body.objects.length).toBeGreaterThan(0);
    for (const id of response.body.objects) expect(id).toMatch(/^[a-z]+_local_[0-9A-Z]{26}$/);

    expect(response.body.events.length).toBeGreaterThan(0);
    const emitted = await Promise.all(
      (response.body.events as string[]).map((id) => t.request('GET', `/v1/events/${id}`)),
    );
    const types = emitted.map((item) => item.body.type);
    expect(types).toContain(event);
    expect(new Set(emitted.map((item) => item.body.request.id)).size).toBe(1);
  });

  it('rejects events that cannot be triggered', async () => {
    const response = await t.request('POST', '/v1/localstripe/trigger', {
      event: 'customer.deleted',
    });
    expect(response.status).toBe(400);
  });
});

describe('seed and reset', () => {
  it('seeds clearly labelled demo data', async () => {
    const response = await t.request('POST', '/v1/localstripe/seed');
    expect(response.body).toEqual({ object: 'seed_result', customers: 3, payment_intents: 7 });
    const customers = await t.request('GET', '/v1/customers');
    expect(customers.body.data).toHaveLength(3);
    for (const customer of customers.body.data as Loose[]) {
      expect(customer.name).toMatch(/^\[Demo\] /);
      expect(customer.metadata).toEqual({ localstripe_demo: 'true' });
    }
    const refunds = await t.request('GET', '/v1/refunds');
    expect(refunds.body.data).toHaveLength(2);
  });

  it('requires confirm=true to reset', async () => {
    await t.request('POST', '/v1/customers', { name: 'Keep' });
    const missing = await t.request('POST', '/v1/localstripe/reset', {});
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatchObject({ code: 'parameter_missing', param: 'confirm' });
    const refused = await t.request('POST', '/v1/localstripe/reset', 'confirm=false');
    expect(refused.status).toBe(400);
    expect(refused.body.error.param).toBe('confirm');
    expect(await countRows(t.db, 'customers')).toBe(1);
  });

  it('deletes payment data but keeps API keys and webhook endpoints', async () => {
    const endpoint = await t.request('POST', '/v1/webhook_endpoints', {
      url: 'http://127.0.0.1:9/hook',
      enabled_events: ['*'],
    });
    await t.request('POST', '/v1/localstripe/seed');
    await pay(t, CARDS.processing);
    await t.request('POST', '/v1/customers', { name: 'x' }, { 'idempotency-key': 'before-reset' });
    const keys = await countRows(t.db, 'api_keys');

    const response = await t.request('POST', '/v1/localstripe/reset', { confirm: true });
    expect(response.body).toEqual({ object: 'reset_result', reset: true });
    for (const table of [
      'customers',
      'payment_methods',
      'payment_intents',
      'charges',
      'refunds',
      'events',
      'webhook_deliveries',
      'idempotency_keys',
      'jobs',
    ]) {
      expect(await countRows(t.db, table), table).toBe(0);
    }
    expect(await countRows(t.db, 'api_keys')).toBe(keys);
    const kept = await t.request('GET', `/v1/webhook_endpoints/${endpoint.body.id}`);
    expect(kept.status).toBe(200);
  });
});
