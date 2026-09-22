import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestApp, createTestApp, resetDatabase } from './helpers/app.js';
import {
  CARDS,
  createPaymentIntent,
  createPaymentMethod,
  eventTypesFor,
} from './helpers/payments.js';

async function confirmationFor(t: TestApp, number: string) {
  const pm = await createPaymentMethod(t, number);
  const paymentIntent = await createPaymentIntent(t, { payment_method: pm.id });
  return `/v1/payment_intents/${paymentIntent.id}/confirm`;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const started = performance.now();
  const result = await fn();
  return { result, ms: performance.now() - started };
}

describe('per-request delay header', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ MAX_DELAY_MS: '1000' });
  });
  afterAll(() => t.close());
  beforeEach(() => resetDatabase(t));

  it('delays the confirmation and keeps the lifecycle intact', async () => {
    const path = await confirmationFor(t, CARDS.visa);
    const { result, ms } = await timed(() =>
      t.request('POST', path, {}, { 'localstripe-delay-ms': '300' }),
    );
    expect(ms).toBeGreaterThanOrEqual(295);
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('succeeded');
    expect(await eventTypesFor(t, result.body.id)).toEqual([
      'payment_intent.created',
      'payment_intent.succeeded',
    ]);
  });

  it('delays declines too', async () => {
    const path = await confirmationFor(t, CARDS.genericDecline);
    const { result, ms } = await timed(() =>
      t.request('POST', path, {}, { 'localstripe-delay-ms': '200' }),
    );
    expect(ms).toBeGreaterThanOrEqual(195);
    expect(result.status).toBe(402);
  });

  it('does not block other requests while waiting', async () => {
    const [first, second] = [
      await confirmationFor(t, CARDS.visa),
      await confirmationFor(t, CARDS.mastercard),
    ];
    const { result, ms } = await timed(() =>
      Promise.all([
        t.request('POST', first, {}, { 'localstripe-delay-ms': '400' }),
        t.request('POST', second, {}, { 'localstripe-delay-ms': '400' }),
        t.request('GET', '/v1/customers'),
      ]),
    );
    expect(result.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(ms).toBeGreaterThanOrEqual(395);
    expect(ms).toBeLessThan(750);
  });

  it('caps the header at MAX_DELAY_MS', async () => {
    const capped = await createTestApp({ MAX_DELAY_MS: '100' });
    try {
      const path = await confirmationFor(capped, CARDS.visa);
      const { result, ms } = await timed(() =>
        capped.request('POST', path, {}, { 'localstripe-delay-ms': '5000' }),
      );
      expect(result.body.status).toBe('succeeded');
      expect(ms).toBeGreaterThanOrEqual(95);
      expect(ms).toBeLessThan(1500);
    } finally {
      await capped.close();
    }
  });

  it('ignores malformed header values', async () => {
    const path = await confirmationFor(t, CARDS.visa);
    const { result, ms } = await timed(() =>
      t.request('POST', path, {}, { 'localstripe-delay-ms': '-5000' }),
    );
    expect(result.status).toBe(200);
    expect(ms).toBeLessThan(500);
  });
});

describe('configured delays', () => {
  it('applies PAYMENT_PROCESSING_DELAY_MS globally', async () => {
    const t = await createTestApp({ PAYMENT_PROCESSING_DELAY_MS: '250' });
    try {
      const path = await confirmationFor(t, CARDS.visa);
      const { result, ms } = await timed(() => t.request('POST', path));
      expect(result.body.status).toBe('succeeded');
      expect(ms).toBeGreaterThanOrEqual(245);

      const overridden = await confirmationFor(t, CARDS.visa);
      const fast = await timed(() =>
        t.request('POST', overridden, {}, { 'localstripe-delay-ms': '0' }),
      );
      expect(fast.ms).toBeLessThan(200);
    } finally {
      await t.close();
    }
  });

  it('applies PAYMENT_SCENARIO_DELAYS per scenario', async () => {
    const t = await createTestApp({
      PAYMENT_SCENARIO_DELAYS: 'declined=250,processing=0',
      PAYMENT_PROCESSING_DELAY_MS: '0',
    });
    try {
      const declined = await confirmationFor(t, CARDS.genericDecline);
      const slow = await timed(() => t.request('POST', declined));
      expect(slow.result.status).toBe(402);
      expect(slow.ms).toBeGreaterThanOrEqual(245);

      const succeeded = await confirmationFor(t, CARDS.visa);
      const fast = await timed(() => t.request('POST', succeeded));
      expect(fast.result.status).toBe(200);
      expect(fast.ms).toBeLessThan(200);
    } finally {
      await t.close();
    }
  });

  it('uses the delay as settlement time for processing cards without blocking the response', async () => {
    const t = await createTestApp({ PAYMENT_SCENARIO_DELAYS: 'processing=300' });
    try {
      const path = await confirmationFor(t, CARDS.processing);
      const { result, ms } = await timed(() => t.request('POST', path));
      expect(result.body.status).toBe('processing');
      expect(ms).toBeLessThan(250);

      await t.worker.tick();
      expect((await t.request('GET', `/v1/payment_intents/${result.body.id}`)).body.status).toBe(
        'processing',
      );
      await new Promise((resolve) => setTimeout(resolve, 350));
      await t.worker.tick();
      expect((await t.request('GET', `/v1/payment_intents/${result.body.id}`)).body.status).toBe(
        'succeeded',
      );
    } finally {
      await t.close();
    }
  });
});
