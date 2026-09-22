import type { PaymentIntent } from '@localstripe/contracts';

export const API_BASE = '/api/v1';

export type QueryValue = string | number | boolean | null | undefined | readonly string[];
export type QueryParams = Record<string, QueryValue>;

export interface ErrorBody {
  type?: string;
  code?: string;
  message?: string;
  param?: string;
  decline_code?: string;
  payment_intent?: PaymentIntent;
}

export class ApiError extends Error {
  readonly status: number;
  readonly type: string;
  readonly code: string | undefined;
  readonly param: string | undefined;
  readonly declineCode: string | undefined;
  readonly paymentIntent: PaymentIntent | undefined;
  readonly raw: unknown;

  constructor(status: number, body: ErrorBody, raw: unknown) {
    super(body.message ?? `Request failed with status ${status}.`);
    this.name = 'ApiError';
    this.status = status;
    this.type = body.type ?? 'api_error';
    this.code = body.code;
    this.param = body.param;
    this.declineCode = body.decline_code;
    this.paymentIntent = body.payment_intent;
    this.raw = raw;
  }

  get isCardError(): boolean {
    return this.type === 'card_error';
  }
}

/** Builds `?a=1&b[]=x` style query strings (Stripe array syntax), skipping empty values. */
export function buildQuery(params: QueryParams | undefined): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value as readonly string[]) search.append(`${key}[]`, item);
    } else {
      search.append(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export function parseApiError(status: number, raw: unknown): ApiError {
  const envelope =
    typeof raw === 'object' && raw !== null && 'error' in raw
      ? (raw as { error: unknown }).error
      : undefined;
  if (typeof envelope === 'object' && envelope !== null) {
    return new ApiError(status, envelope as ErrorBody, raw);
  }
  const message =
    typeof raw === 'string' && raw.trim()
      ? raw.trim().slice(0, 300)
      : `Request failed with status ${status}.`;
  return new ApiError(status, { type: 'api_error', message }, raw);
}

export interface RequestOptions {
  query?: QueryParams;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}${buildQuery(options.query)}`, {
      method,
      headers,
      body,
      signal: options.signal,
      credentials: 'same-origin',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(
      0,
      { type: 'api_error', message: 'Network error: the dashboard server is unreachable.' },
      error,
    );
  }

  const data = await readBody(response);
  if (!response.ok) throw parseApiError(response.status, data);
  return data as T;
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, { ...options, body: body ?? {} }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, options),
};

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
