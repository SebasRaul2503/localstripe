import { describe, expect, it } from 'vitest';
import { API_URL, DASHBOARD_URL, SECRET_KEY, http } from './support.js';

describe('API platform', () => {
  it('exposes health, readiness, OpenAPI and docs', async () => {
    expect((await fetch(`${API_URL}/health`)).status).toBe(200);
    const ready = await (await fetch(`${API_URL}/ready`)).json();
    expect(ready).toMatchObject({ status: 'ready', checks: { database: 'ok', worker: 'ok' } });
    const openapi = (await (await fetch(`${API_URL}/openapi.json`)).json()) as { paths: object };
    expect(Object.keys(openapi.paths)).toContain('/v1/payment_intents/{id}/confirm');
    expect((await fetch(`${API_URL}/docs`)).status).toBe(200);
  });

  it('requires an API key and returns Stripe-style errors', async () => {
    const unauthenticated = await http('GET', '/v1/customers', { auth: false });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body['error']).toMatchObject({ type: 'authentication_error' });
    expect(unauthenticated.headers.get('request-id')).toMatch(/^req_/);
  });

  it('lists only catalog test cards', async () => {
    const cards = await http<{ data: { number: string }[] }>('GET', '/v1/localstripe/test_cards');
    expect(cards.body.data.map((card) => card.number)).toContain('4242424242424242');
  });
});

describe('dashboard', () => {
  it('serves the app and a health endpoint', async () => {
    expect((await fetch(`${DASHBOARD_URL}/healthz`)).status).toBe(200);
    const index = await fetch(`${DASHBOARD_URL}/payments/some-deep-link`);
    expect(index.status).toBe(200);
    expect(await index.text()).toContain('<div id="root">');
  });

  it('proxies the API with its own internal key and ignores client credentials', async () => {
    const stats = await fetch(`${DASHBOARD_URL}/api/v1/localstripe/stats`, {
      headers: { authorization: 'Bearer sk_test_attacker_supplied_key_0000' },
    });
    expect(stats.status).toBe(200);
    expect(((await stats.json()) as { object: string }).object).toBe('stats');
  });

  it('never ships a secret key to the browser', async () => {
    const index = await (await fetch(`${DASHBOARD_URL}/`)).text();
    const scripts = [...index.matchAll(/src="([^"]+\.js)"/g)].map((match) => match[1]!);
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      const source = await (await fetch(new URL(script, DASHBOARD_URL))).text();
      expect(source).not.toContain(SECRET_KEY);
      expect(source).not.toMatch(/sk_test_local_[A-Za-z0-9]{32}/);
    }
    const config = await (await fetch(`${DASHBOARD_URL}/config.json`)).text();
    expect(config).not.toContain('sk_test_');
  });
});
