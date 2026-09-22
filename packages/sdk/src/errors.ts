import type { PaymentIntent } from '@localstripe/contracts';

export interface RawErrorBody {
  type?: string;
  code?: string;
  message?: string;
  param?: string;
  decline_code?: string;
  payment_intent?: PaymentIntent;
  [key: string]: unknown;
}

export interface LocalStripeErrorInit {
  message: string;
  type?: string;
  code?: string;
  param?: string;
  declineCode?: string;
  statusCode?: number;
  requestId?: string;
  paymentIntent?: PaymentIntent;
  raw?: unknown;
  headers?: Record<string, string>;
  cause?: unknown;
}

export class LocalStripeError extends Error {
  readonly type: string;
  readonly code: string | undefined;
  readonly param: string | undefined;
  readonly declineCode: string | undefined;
  readonly statusCode: number | undefined;
  readonly requestId: string | undefined;
  readonly paymentIntent: PaymentIntent | undefined;
  readonly headers: Record<string, string>;
  readonly raw: unknown;

  constructor(init: LocalStripeErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = new.target.name;
    this.type = init.type ?? 'api_error';
    this.code = init.code;
    this.param = init.param;
    this.declineCode = init.declineCode;
    this.statusCode = init.statusCode;
    this.requestId = init.requestId;
    this.paymentIntent = init.paymentIntent;
    this.headers = init.headers ?? {};
    this.raw = init.raw;
  }
}

export class CardError extends LocalStripeError {}
export class InvalidRequestError extends LocalStripeError {}
export class AuthenticationError extends LocalStripeError {}
export class PermissionError extends LocalStripeError {}
export class IdempotencyError extends LocalStripeError {}
export class RateLimitError extends LocalStripeError {}
export class APIError extends LocalStripeError {}
/** The request never produced an HTTP response (network failure, timeout or abort). */
export class ConnectionError extends LocalStripeError {}

export function errorFromResponse(
  statusCode: number,
  body: unknown,
  headers: Record<string, string>,
): LocalStripeError {
  const error = extractErrorBody(body);
  const init: LocalStripeErrorInit = {
    message: error?.message ?? `LocalStripe responded with HTTP ${statusCode}.`,
    type: error?.type,
    code: error?.code,
    param: error?.param,
    declineCode: error?.decline_code,
    paymentIntent: error?.payment_intent,
    statusCode,
    requestId: headers['request-id'],
    headers,
    raw: body,
  };
  if (error?.type === 'idempotency_error') return new IdempotencyError(init);
  if (error?.type === 'card_error' || statusCode === 402) return new CardError(init);
  switch (statusCode) {
    case 401:
      return new AuthenticationError(init);
    case 403:
      return new PermissionError(init);
    case 429:
      return new RateLimitError(init);
  }
  if (statusCode >= 400 && statusCode < 500) return new InvalidRequestError(init);
  return new APIError(init);
}

function extractErrorBody(body: unknown): RawErrorBody | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  return typeof error === 'object' && error !== null ? (error as RawErrorBody) : undefined;
}
