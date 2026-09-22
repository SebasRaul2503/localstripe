import { randomUUID } from 'node:crypto';
import {
  AuthenticationError,
  ConnectionError,
  LocalStripeError,
  errorFromResponse,
} from './errors.js';
import { encodeQuery } from './query.js';

export interface RequestOptions {
  /** Sent as `Idempotency-Key`; replays of a POST with the same key return the first response. */
  idempotencyKey?: string;
  /** Sent as `LocalStripe-Delay-Ms`: overrides the artificial processing delay for this request. */
  delayMs?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type HttpMethod = 'GET' | 'POST' | 'DELETE';

export interface HttpRequest {
  method: HttpMethod;
  path: string;
  query?: object;
  body?: object;
  options?: RequestOptions;
  /** `false` for unauthenticated endpoints such as `/health`. */
  auth?: boolean;
}

export interface HttpClientConfig {
  apiKey?: string;
  baseUrl: string;
  timeoutMs: number;
  maxNetworkRetries: number;
  fetch: typeof fetch;
  userAgent: string;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const INITIAL_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 5_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class HttpClient {
  private readonly baseUrl: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly config: HttpClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.sleep = config.sleep ?? defaultSleep;
    this.random = config.random ?? Math.random;
  }

  async request<T>(request: HttpRequest): Promise<T> {
    const options = request.options ?? {};
    const maxRetries = Math.max(0, this.config.maxNetworkRetries);
    const idempotencyKey =
      options.idempotencyKey ??
      (request.method === 'POST' && maxRetries > 0 ? randomUUID() : undefined);
    const headers = this.buildHeaders(request, idempotencyKey);
    const query = encodeQuery(request.query);
    const url = `${this.baseUrl}${request.path}${query ? `?${query}` : ''}`;
    const body = request.body === undefined ? undefined : JSON.stringify(request.body);

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.send<T>(url, request.method, headers, body, options);
      } catch (error) {
        if (attempt >= maxRetries || !this.isRetryable(error, options)) throw error;
        await this.sleep(this.retryDelay(attempt, error));
      }
    }
  }

  private buildHeaders(request: HttpRequest, idempotencyKey: string | undefined) {
    const { options = {} } = request;
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': this.config.userAgent,
    };
    if (request.auth !== false) {
      if (!this.config.apiKey) {
        throw new AuthenticationError({
          type: 'authentication_error',
          code: 'api_key_required',
          message: 'No API key provided. Pass `apiKey` to the LocalStripe constructor.',
        });
      }
      headers['authorization'] = `Bearer ${this.config.apiKey}`;
    }
    if (request.body !== undefined) headers['content-type'] = 'application/json';
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    if (options.delayMs !== undefined) headers['localstripe-delay-ms'] = String(options.delayMs);
    return headers;
  }

  private async send<T>(
    url: string,
    method: HttpMethod,
    headers: Record<string, string>,
    body: string | undefined,
    options: RequestOptions,
  ): Promise<T> {
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

    let response: Response;
    let text: string;
    try {
      response = await this.config.fetch(url, { method, headers, body, signal });
      text = await response.text();
    } catch (error) {
      const timedOut = timeout.aborted && !options.signal?.aborted;
      throw new ConnectionError({
        type: 'api_connection_error',
        code: timedOut ? 'timeout' : options.signal?.aborted ? 'aborted' : 'connection_failed',
        message: timedOut
          ? `Request to LocalStripe timed out after ${timeoutMs}ms (${method} ${url}).`
          : `Could not connect to LocalStripe at ${this.baseUrl}: ${describe(error)}`,
        cause: error,
      });
    }

    const responseHeaders = Object.fromEntries(response.headers.entries());
    const parsed = parseJson(text);
    if (!response.ok) throw errorFromResponse(response.status, parsed, responseHeaders);
    if (parsed === undefined && text.length > 0) {
      throw new LocalStripeError({
        type: 'api_error',
        message: `LocalStripe returned an invalid JSON response (HTTP ${response.status}).`,
        statusCode: response.status,
        requestId: responseHeaders['request-id'],
        headers: responseHeaders,
        raw: text,
      });
    }
    return parsed as T;
  }

  private isRetryable(error: unknown, options: RequestOptions): boolean {
    if (options.signal?.aborted) return false;
    if (error instanceof ConnectionError) return true;
    if (!(error instanceof LocalStripeError) || error.statusCode === undefined) return false;
    return error.statusCode === 409 || error.statusCode === 429 || error.statusCode >= 500;
  }

  private retryDelay(attempt: number, error: unknown): number {
    const retryAfter = error instanceof LocalStripeError ? error.headers['retry-after'] : undefined;
    const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : Number.NaN;
    if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
      return Math.min(retryAfterMs, MAX_RETRY_DELAY_MS);
    }
    const exponential = Math.min(INITIAL_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
    return Math.round(exponential * (0.5 + this.random() * 0.5));
  }
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

const describe = (error: unknown) => {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? ` (${error.cause.message})` : '';
  return `${error.message}${cause}`;
};
