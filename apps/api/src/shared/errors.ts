import type { ErrorCode, ErrorType, PaymentIntent } from '@localstripe/contracts';

export interface ApiErrorOptions {
  // Card errors may carry catalog-defined codes beyond the built-in taxonomy.
  code?: ErrorCode | (string & {});
  param?: string;
  declineCode?: string;
  paymentIntent?: PaymentIntent;
  headers?: Record<string, string>;
}

/** An error that is rendered to clients as a Stripe-style `{ error: {...} }` body. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly type: ErrorType,
    message: string,
    readonly options: ApiErrorOptions = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  toBody() {
    return {
      error: {
        type: this.type,
        message: this.message,
        ...(this.options.code && { code: this.options.code }),
        ...(this.options.param && { param: this.options.param }),
        ...(this.options.declineCode && { decline_code: this.options.declineCode }),
        ...(this.options.paymentIntent && { payment_intent: this.options.paymentIntent }),
      },
    };
  }
}

export const invalidRequest = (message: string, options: ApiErrorOptions = {}) =>
  new ApiError(400, 'invalid_request_error', message, { code: 'parameter_invalid', ...options });

export const missingParam = (param: string) =>
  new ApiError(400, 'invalid_request_error', `Missing required param: ${param}.`, {
    code: 'parameter_missing',
    param,
  });

export const notFound = (resource: string, id: string, param = 'id') =>
  new ApiError(404, 'invalid_request_error', `No such ${resource}: '${id}'`, {
    code: 'resource_missing',
    param,
  });

export const unexpectedState = (code: ErrorCode, message: string, options: ApiErrorOptions = {}) =>
  new ApiError(400, 'invalid_request_error', message, { code, ...options });

export const unauthenticated = (message: string, code: ErrorCode = 'api_key_invalid') =>
  new ApiError(401, 'authentication_error', message, { code });

export const forbidden = (message: string) =>
  new ApiError(403, 'invalid_request_error', message, { code: 'permission_denied' });

export const cardError = (message: string, options: ApiErrorOptions) =>
  new ApiError(402, 'card_error', message, options);
