export interface RecordedRequest {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export type FakeResponse =
  { status?: number; body?: unknown; headers?: Record<string, string> } | Error;

/** A fetch double that replays queued responses and records every request. */
export function fakeFetch(...responses: FakeResponse[]) {
  const requests: RecordedRequest[] = [];
  const queue = [...responses];
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    requests.push({
      url: new URL(String(input)),
      method: init.method ?? 'GET',
      headers,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (!next) throw new Error('fakeFetch: no response queued');
    if (next instanceof Error) throw next;
    return new Response(next.body === undefined ? '' : JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json', 'request-id': 'req_test', ...next.headers },
    });
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

export const list = <T>(data: T[], hasMore = false, url = '/v1/test') => ({
  object: 'list' as const,
  data,
  has_more: hasMore,
  url,
});
