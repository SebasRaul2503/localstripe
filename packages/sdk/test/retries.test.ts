import { describe, expect, it } from 'vitest';
import { ConnectionError, InvalidRequestError, RateLimitError } from '../src/index.js';
import { HttpClient } from '../src/http-client.js';
import { fakeFetch, type FakeResponse } from './fake-fetch.js';

function httpClient(maxNetworkRetries: number, ...responses: FakeResponse[]) {
  const fake = fakeFetch(...responses);
  const delays: number[] = [];
  const http = new HttpClient({
    apiKey: 'sk_test_x',
    baseUrl: 'http://api.test',
    timeoutMs: 1_000,
    maxNetworkRetries,
    fetch: fake.fetch,
    userAgent: 'test',
    sleep: async (ms) => {
      delays.push(ms);
    },
    random: () => 1,
  });
  return { http, requests: fake.requests, delays };
}

const serverError = { status: 500, body: { error: { type: 'api_error', message: 'boom' } } };
const conflict = {
  status: 409,
  body: { error: { type: 'idempotency_error', code: 'idempotency_key_in_use', message: 'busy' } },
};

describe('retries', () => {
  it('does not retry nor add an idempotency key by default', async () => {
    const { http, requests } = httpClient(0, serverError);
    await expect(http.request({ method: 'POST', path: '/v1/customers', body: {} })).rejects.toThrow(
      'boom',
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]!.headers['idempotency-key']).toBeUndefined();
  });

  it('retries 5xx, 409 and network errors with the same auto-generated idempotency key', async () => {
    const { http, requests, delays } = httpClient(
      3,
      serverError,
      conflict,
      new TypeError('fetch failed'),
      { body: { id: 'cus_1' } },
    );
    const result = await http.request<{ id: string }>({
      method: 'POST',
      path: '/v1/customers',
      body: { email: 'a@b.c' },
    });

    expect(result.id).toBe('cus_1');
    expect(requests).toHaveLength(4);
    const keys = new Set(requests.map((r) => r.headers['idempotency-key']));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(delays).toEqual([500, 1000, 2000]);
  });

  it('keeps a caller-provided idempotency key', async () => {
    const { http, requests } = httpClient(1, serverError, { body: {} });
    await http.request({
      method: 'POST',
      path: '/v1/refunds',
      body: {},
      options: { idempotencyKey: 'refund-1' },
    });
    expect(requests.map((r) => r.headers['idempotency-key'])).toEqual(['refund-1', 'refund-1']);
  });

  it('does not add idempotency keys to GET requests', async () => {
    const { http, requests } = httpClient(1, serverError, { body: {} });
    await http.request({ method: 'GET', path: '/v1/customers' });
    expect(requests).toHaveLength(2);
    expect(requests[0]!.headers['idempotency-key']).toBeUndefined();
  });

  it('honours Retry-After on 429 and gives up after maxNetworkRetries', async () => {
    const { http, requests, delays } = httpClient(2, {
      status: 429,
      headers: { 'retry-after': '1' },
      body: { error: { type: 'rate_limit_error', code: 'rate_limit', message: 'slow down' } },
    });
    await expect(http.request({ method: 'GET', path: '/v1/customers' })).rejects.toBeInstanceOf(
      RateLimitError,
    );
    expect(requests).toHaveLength(3);
    expect(delays).toEqual([1000, 1000]);
  });

  it('does not retry client errors', async () => {
    const { http, requests } = httpClient(3, {
      status: 400,
      body: { error: { type: 'invalid_request_error', message: 'bad' } },
    });
    await expect(http.request({ method: 'POST', path: '/v1/refunds' })).rejects.toBeInstanceOf(
      InvalidRequestError,
    );
    expect(requests).toHaveLength(1);
  });

  it('does not retry after the caller aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    const { http, requests } = httpClient(3, new DOMException('aborted', 'AbortError'));
    const error = await http
      .request({ method: 'GET', path: '/v1/customers', options: { signal: controller.signal } })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectionError);
    expect((error as ConnectionError).code).toBe('aborted');
    expect(requests).toHaveLength(1);
  });
});
