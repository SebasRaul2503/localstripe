import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Loose, type TestApp, createTestApp, resetDatabase } from './helpers/app.js';
import { CARDS, pay } from './helpers/payments.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => resetDatabase(t));

const XSS = `<script>alert("x")</script><img src=x onerror=alert(1)>`;

async function createSession(name = 'T-shirt'): Promise<Loose> {
  const response = await t.request('POST', '/v1/checkout/sessions', {
    success_url: 'http://shop.test/success?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'http://shop.test/cancel',
    line_items: [
      { price_data: { currency: 'usd', unit_amount: 1990, product_data: { name } }, quantity: 1 },
    ],
  });
  expect(response.status, response.text).toBe(200);
  return response.body;
}

const hosted = (method: 'GET' | 'POST', url: string, form?: string) =>
  t.app.inject({
    method,
    url,
    ...(form !== undefined && {
      payload: form,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    }),
  });

describe('hosted checkout page', () => {
  it('renders HTML with a strict CSP and escapes user-provided names', async () => {
    const session = await createSession(XSS);
    const response = await hosted('GET', `/checkout/${session.id}`);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toContain('$19.90');
    expect(response.body).toContain('No real payment will be made');
    expect(response.body).not.toContain('<script');
    expect(response.body).not.toContain('<img src=x');
    expect(response.body).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(response.body).toContain(`action="/checkout/${session.id}/pay"`);
  });

  it('needs no API key and returns 404 pages for unknown sessions', async () => {
    const response = await hosted('GET', '/checkout/cs_local_missing');
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('text/html');
  });

  it('pays with a catalog card and redirects to success_url with the session id', async () => {
    const session = await createSession();
    const response = await hosted(
      'POST',
      `/checkout/${session.id}/pay`,
      'test_card=visa_success&expiry=12/40&cvc=123',
    );
    expect(response.statusCode).toBe(303);
    expect(response.headers['location']).toBe(`http://shop.test/success?session_id=${session.id}`);
    const after = await t.request('GET', `/v1/checkout/sessions/${session.id}`);
    expect(after.body).toMatchObject({ status: 'complete', payment_status: 'paid' });

    const revisit = await hosted('GET', `/checkout/${session.id}`);
    expect(revisit.statusCode).toBe(303);
  });

  it('accepts a typed card number with spaces', async () => {
    const session = await createSession();
    const response = await hosted(
      'POST',
      `/checkout/${session.id}/pay`,
      'card_number=4242+4242+4242+4242&expiry=12%2F40&cvc=123',
    );
    expect(response.statusCode).toBe(303);
  });

  it('shows the decline message and keeps the session payable', async () => {
    const session = await createSession();
    const declined = await hosted(
      'POST',
      `/checkout/${session.id}/pay`,
      'test_card=insufficient_funds&expiry=12/40&cvc=123',
    );
    expect(declined.statusCode).toBe(402);
    expect(declined.headers['content-security-policy']).toBeDefined();
    expect(declined.body).toContain('insufficient funds');

    const page = await hosted('GET', `/checkout/${session.id}`);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('insufficient funds');

    const retried = await hosted(
      'POST',
      `/checkout/${session.id}/pay`,
      'test_card=visa_success&expiry=12/40&cvc=123',
    );
    expect(retried.statusCode).toBe(303);
  });

  it('rejects a missing card or expiry and non-catalog numbers', async () => {
    const session = await createSession();
    const missing = await hosted('POST', `/checkout/${session.id}/pay`, 'expiry=12/40');
    expect(missing.statusCode).toBe(400);
    const badExpiry = await hosted(
      'POST',
      `/checkout/${session.id}/pay`,
      'test_card=visa_success&expiry=1240',
    );
    expect(badExpiry.statusCode).toBe(400);
    const unknown = await hosted(
      'POST',
      `/checkout/${session.id}/pay`,
      'card_number=4111111111111111&expiry=12/40&cvc=123',
    );
    expect(unknown.statusCode).toBe(402);
    expect(unknown.body).not.toContain('4111111111111111');
  });

  it('shows an expired page for expired sessions', async () => {
    const session = await createSession();
    await t.request('POST', `/v1/checkout/sessions/${session.id}/expire`);
    const response = await hosted('GET', `/checkout/${session.id}`);
    expect(response.statusCode).toBe(410);
  });

  it('redirects to the 3DS page for cards that require authentication', async () => {
    const session = await createSession();
    const response = await hosted(
      'POST',
      `/checkout/${session.id}/pay`,
      'test_card=authentication_required&expiry=12/40&cvc=123',
    );
    expect(response.statusCode).toBe(303);
    const location = new URL(response.headers['location'] as string);
    expect(location.pathname).toMatch(/^\/3ds\/pi_local_/);

    const challenge = await hosted('GET', `${location.pathname}${location.search}`);
    expect(challenge.statusCode).toBe(200);
    expect(challenge.body).toContain('Simulated 3D Secure challenge');

    const paymentIntentId = location.pathname.split('/')[2]!;
    const clientSecret = location.searchParams.get('client_secret')!;
    const completed = await hosted(
      'POST',
      `/3ds/${paymentIntentId}`,
      `client_secret=${encodeURIComponent(clientSecret)}&outcome=succeed`,
    );
    expect(completed.statusCode).toBe(303);
    const back = new URL(completed.headers['location'] as string);
    expect(back.pathname).toBe(`/checkout/${session.id}`);
    expect(back.searchParams.get('redirect_status')).toBe('succeeded');
    expect(back.searchParams.get('payment_intent')).toBe(paymentIntentId);

    const after = await t.request('GET', `/v1/checkout/sessions/${session.id}`);
    expect(after.body).toMatchObject({ status: 'complete', payment_status: 'paid' });
  });
});

describe('hosted 3DS page', () => {
  it('requires the client secret', async () => {
    const paymentIntent = (await pay(t, CARDS.threeDS)).body;
    const wrong = await hosted('GET', `/3ds/${paymentIntent.id}?client_secret=wrong`);
    expect(wrong.statusCode).toBe(404);
    const post = await hosted(
      'POST',
      `/3ds/${paymentIntent.id}`,
      'client_secret=wrong&outcome=succeed',
    );
    expect(post.statusCode).toBe(403);
    const unchanged = await t.request('GET', `/v1/payment_intents/${paymentIntent.id}`);
    expect(unchanged.body.status).toBe('requires_action');
  });

  it('fails the payment and shows the result without a return_url', async () => {
    const paymentIntent = (await pay(t, CARDS.threeDS)).body;
    const response = await hosted(
      'POST',
      `/3ds/${paymentIntent.id}`,
      `client_secret=${encodeURIComponent(paymentIntent.client_secret)}&outcome=fail`,
    );
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Authentication failed');
    expect(response.body).toContain('requires_payment_method');
    const after = await t.request('GET', `/v1/payment_intents/${paymentIntent.id}`);
    expect(after.body.last_payment_error.code).toBe('payment_intent_authentication_failure');

    const nothing = await hosted(
      'GET',
      `/3ds/${paymentIntent.id}?client_secret=${encodeURIComponent(paymentIntent.client_secret)}`,
    );
    expect(nothing.body).toContain('Nothing to authenticate');
  });

  it('redirects to the return_url with the payment result', async () => {
    const paymentIntent = (await pay(t, CARDS.threeDS, { return_url: 'http://shop.test/done?x=1' }))
      .body;
    const response = await hosted(
      'POST',
      `/3ds/${paymentIntent.id}`,
      `client_secret=${encodeURIComponent(paymentIntent.client_secret)}&outcome=succeed`,
    );
    expect(response.statusCode).toBe(303);
    const location = new URL(response.headers['location'] as string);
    expect(location.origin + location.pathname).toBe('http://shop.test/done');
    expect(Object.fromEntries(location.searchParams)).toEqual({
      x: '1',
      payment_intent: paymentIntent.id,
      payment_intent_client_secret: paymentIntent.client_secret,
      redirect_status: 'succeeded',
    });
  });
});
