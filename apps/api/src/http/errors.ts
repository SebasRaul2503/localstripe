import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { ApiError } from '../shared/errors.js';

/** `/card/number` → `card[number]`, `/line_items/0/quantity` → `line_items[0][quantity]`. */
export function toStripeParam(path: string | (string | number)[]): string {
  const segments = (Array.isArray(path) ? path.map(String) : path.split('/')).filter(Boolean);
  const [first, ...rest] = segments;
  return (first ?? '') + rest.map((segment) => `[${segment}]`).join('');
}

interface ValidationIssue {
  keyword: string;
  instancePath: string;
  message: string;
  params: Record<string, unknown>;
}

export function validationIssueToError(issue: ValidationIssue): ApiError {
  const base = toStripeParam(issue.instancePath);
  if (issue.keyword === 'unrecognized_keys') {
    const keys = (issue.params['keys'] as string[] | undefined) ?? [];
    const param = base ? `${base}[${keys[0]}]` : (keys[0] ?? '');
    return new ApiError(400, 'invalid_request_error', `Received unknown parameter: ${param}`, {
      code: 'parameter_unknown',
      param,
    });
  }
  const missing = issue.keyword === 'invalid_type' && /received undefined/.test(issue.message);
  if (missing) {
    return new ApiError(400, 'invalid_request_error', `Missing required param: ${base}.`, {
      code: 'parameter_missing',
      param: base,
    });
  }
  return new ApiError(
    400,
    'invalid_request_error',
    `Invalid ${base || 'request'}: ${issue.message}`,
    {
      code: 'parameter_invalid',
      ...(base && { param: base }),
    },
  );
}

function toApiError(error: FastifyError, exposeInternalMessages: boolean): ApiError {
  if (error instanceof ApiError) return error;
  if (hasZodFastifySchemaValidationErrors(error)) {
    return validationIssueToError(error.validation[0] as unknown as ValidationIssue);
  }
  switch (error.code) {
    case 'FST_ERR_CTP_BODY_TOO_LARGE':
      return new ApiError(413, 'invalid_request_error', 'Request body is too large.', {
        code: 'body_too_large',
      });
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
      return new ApiError(
        415,
        'invalid_request_error',
        'Unsupported Content-Type. Use application/x-www-form-urlencoded or application/json.',
        { code: 'malformed_request' },
      );
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
    case 'FST_ERR_CTP_INVALID_JSON_BODY':
      return new ApiError(
        400,
        'invalid_request_error',
        'Invalid request body: could not parse JSON.',
        {
          code: 'malformed_request',
        },
      );
  }
  if (error.statusCode === 429) {
    return new ApiError(429, 'rate_limit_error', 'Too many requests hit the API too quickly.', {
      code: 'rate_limit',
    });
  }
  if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    return new ApiError(error.statusCode, 'invalid_request_error', error.message, {
      code: 'malformed_request',
    });
  }
  return new ApiError(
    500,
    'api_error',
    exposeInternalMessages
      ? `Internal error: ${error.message}`
      : 'An unexpected error occurred in LocalStripe.',
    { code: 'internal_error' },
  );
}

export function registerErrorHandling(
  app: FastifyInstance,
  options: { exposeInternalMessages: boolean },
) {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const apiError = toApiError(error, options.exposeInternalMessages);
    if (apiError.statusCode >= 500) request.log.error({ err: error }, 'unhandled error');
    else
      request.log.info(
        { errorType: apiError.type, errorCode: apiError.options.code },
        apiError.message,
      );
    for (const [name, value] of Object.entries(apiError.options.headers ?? {}))
      reply.header(name, value);
    // Stack traces are never sent to clients, in any environment.
    return reply.status(apiError.statusCode).send(apiError.toBody());
  });

  app.setNotFoundHandler((request, reply) => {
    const error = new ApiError(
      404,
      'invalid_request_error',
      `Unrecognized request URL (${request.method}: ${request.url.split('?')[0]}).`,
      { code: 'resource_missing' },
    );
    return reply.status(404).send(error.toBody());
  });
}
