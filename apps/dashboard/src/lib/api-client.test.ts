import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient, buildQuery, parseApiError } from './api-client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildQuery', () => {
  it('skips empty values and encodes arrays Stripe-style', () => {
    expect(buildQuery(undefined)).toBe('');
    expect(buildQuery({ limit: 10, status: undefined, customer: '', q: null })).toBe('?limit=10');
    expect(buildQuery({ starting_after: 'pi_1', types: ['a.b', 'c'] })).toBe(
      '?starting_after=pi_1&types%5B%5D=a.b&types%5B%5D=c',
    );
    expect(buildQuery({ query: 'a b&c', flag: false })).toBe('?query=a+b%26c&flag=false');
  });
});

describe('parseApiError', () => {
  it('reads the Stripe-style error envelope', () => {
    const raw = {
      error: {
        type: 'card_error',
        code: 'card_declined',
        decline_code: 'insufficient_funds',
        message: 'Your card has insufficient funds.',
        param: 'payment_method',
        payment_intent: { id: 'pi_123' },
      },
    };
    const error = parseApiError(402, raw);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(402);
    expect(error.type).toBe('card_error');
    expect(error.code).toBe('card_declined');
    expect(error.declineCode).toBe('insufficient_funds');
    expect(error.param).toBe('payment_method');
    expect(error.message).toBe('Your card has insufficient funds.');
    expect(error.paymentIntent?.id).toBe('pi_123');
    expect(error.isCardError).toBe(true);
    expect(error.raw).toBe(raw);
  });

  it('falls back gracefully for non-JSON bodies', () => {
    const error = parseApiError(502, '<html>Bad gateway</html>');
    expect(error.type).toBe('api_error');
    expect(error.message).toBe('<html>Bad gateway</html>');
    expect(parseApiError(500, null).message).toBe('Request failed with status 500.');
  });
});

describe('apiClient', () => {
  it('sends JSON to relative /api/v1 URLs and throws ApiError on failure', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { type: 'invalid_request_error', message: 'Nope' } }),
          {
            status: 400,
          },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiClient.post('/customers', { email: 'a@b.co' })).rejects.toMatchObject({
      status: 400,
      type: 'invalid_request_error',
      message: 'Nope',
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/customers');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"email":"a@b.co"}');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.stringify(init.headers).toLowerCase()).not.toContain('authorization');
  });

  it('returns parsed JSON with query parameters', async () => {
    const fetchMock = vi.fn(async () => new Response('{"object":"list","data":[]}'));
    vi.stubGlobal('fetch', fetchMock);
    const result = await apiClient.get('/events', { query: { limit: 5 } });
    expect(result).toEqual({ object: 'list', data: [] });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('/api/v1/events?limit=5');
  });
});
