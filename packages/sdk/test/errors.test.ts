import { describe, expect, it } from 'vitest';
import {
  APIError,
  AuthenticationError,
  CardError,
  ConnectionError,
  IdempotencyError,
  InvalidRequestError,
  LocalStripe,
  LocalStripeError,
  PermissionError,
  RateLimitError,
} from '../src/index.js';
import { fakeFetch, type FakeResponse } from './fake-fetch.js';

async function failWith(response: FakeResponse) {
  const fake = fakeFetch(response);
  const localstripe = new LocalStripe({ apiKey: 'sk_test_x', fetch: fake.fetch });
  return localstripe.paymentIntents.retrieve('pi_1').then(
    () => {
      throw new Error('expected the request to fail');
    },
    (error: unknown) => error as LocalStripeError,
  );
}

const envelope = (error: Record<string, unknown>) => ({ error });

describe('error mapping', () => {
  it('maps a 402 decline to CardError carrying the PaymentIntent', async () => {
    const paymentIntent = {
      id: 'pi_1',
      object: 'payment_intent',
      status: 'requires_payment_method',
    };
    const error = await failWith({
      status: 402,
      headers: { 'request-id': 'req_decline' },
      body: envelope({
        type: 'card_error',
        code: 'card_declined',
        decline_code: 'insufficient_funds',
        message: 'Your card has insufficient funds.',
        payment_intent: paymentIntent,
      }),
    });
    expect(error).toBeInstanceOf(CardError);
    expect(error).toBeInstanceOf(LocalStripeError);
    expect(error.name).toBe('CardError');
    expect(error.message).toBe('Your card has insufficient funds.');
    expect(error.type).toBe('card_error');
    expect(error.code).toBe('card_declined');
    expect(error.declineCode).toBe('insufficient_funds');
    expect(error.statusCode).toBe(402);
    expect(error.requestId).toBe('req_decline');
    expect(error.paymentIntent).toEqual(paymentIntent);
    expect(error.raw).toEqual(expect.objectContaining({ error: expect.any(Object) }));
  });

  it.each([
    [401, 'authentication_error', 'api_key_invalid', AuthenticationError],
    [403, 'invalid_request_error', 'permission_denied', PermissionError],
    [409, 'idempotency_error', 'idempotency_key_reused', IdempotencyError],
    [409, 'invalid_request_error', 'resource_already_exists', InvalidRequestError],
    [400, 'invalid_request_error', 'parameter_missing', InvalidRequestError],
    [404, 'invalid_request_error', 'resource_missing', InvalidRequestError],
    [413, 'invalid_request_error', 'body_too_large', InvalidRequestError],
    [429, 'rate_limit_error', 'rate_limit', RateLimitError],
    [500, 'api_error', 'internal_error', APIError],
  ])('maps HTTP %i (%s) to the right class', async (status, type, code, ErrorClass) => {
    const error = await failWith({
      status,
      body: envelope({ type, code, message: 'boom', param: 'amount' }),
    });
    expect(error).toBeInstanceOf(ErrorClass);
    expect(error.statusCode).toBe(status);
    expect(error.code).toBe(code);
    expect(error.param).toBe('amount');
  });

  it('handles a non-JSON error body', async () => {
    const fetch = (async () =>
      new Response('<html>bad gateway</html>', { status: 502 })) as typeof globalThis.fetch;
    const localstripe = new LocalStripe({ apiKey: 'sk_test_x', fetch });
    const error = await localstripe.charges.retrieve('ch_1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(APIError);
    expect((error as APIError).message).toMatch(/HTTP 502/);
  });

  it('wraps network failures in ConnectionError', async () => {
    const error = await failWith(new TypeError('fetch failed'));
    expect(error).toBeInstanceOf(ConnectionError);
    expect(error.code).toBe('connection_failed');
    expect(error.message).toMatch(/fetch failed/);
  });

  it('reports timeouts as ConnectionError', async () => {
    const fetch = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as unknown as typeof globalThis.fetch;
    const localstripe = new LocalStripe({ apiKey: 'sk_test_x', fetch, timeoutMs: 10 });
    const error = await localstripe.customers.list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectionError);
    expect((error as ConnectionError).code).toBe('timeout');
  });

  it('requires an API key for authenticated calls', async () => {
    const fake = fakeFetch({ body: {} });
    const localstripe = new LocalStripe({ fetch: fake.fetch });
    await expect(localstripe.customers.list()).rejects.toBeInstanceOf(AuthenticationError);
    expect(fake.requests).toHaveLength(0);
  });
});
