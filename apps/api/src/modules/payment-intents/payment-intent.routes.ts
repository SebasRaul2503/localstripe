import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  CANCELLATION_REASONS,
  PAYMENT_INTENT_STATUSES,
  listSchema,
  paymentIntentSchema,
} from '@localstripe/contracts';
import { isPublishable, requestContext } from '../../http/auth.js';
import {
  errorResponses,
  idParams,
  ignoredPaymentParams,
  params,
  type RouteDeps,
} from '../../http/route-helpers.js';
import { listParamsShape, toPageRequest } from '../../shared/pagination.js';
import { invalidRequest } from '../../shared/errors.js';
import {
  amount,
  boolean,
  currency,
  email,
  expandParam,
  httpUrl,
  metadata,
  nullableString,
} from '../../shared/validation.js';

const DELAY_HEADER_DOC =
  'Send the `LocalStripe-Delay-Ms` header to override the artificial processing delay for this request.';

function requireClientSecretForPublishable(publishable: boolean, clientSecret: string | undefined) {
  if (publishable && !clientSecret) {
    throw invalidRequest('A client_secret is required when using a publishable key.', {
      code: 'parameter_missing',
      param: 'client_secret',
    });
  }
  return publishable ? clientSecret : undefined;
}

export function paymentIntentRoutes({ services, strictParams }: RouteDeps): FastifyPluginAsyncZod {
  const tags = ['Payment intents'];
  const paymentMethodTypes = z
    .array(
      z.literal('card', { error: "LocalStripe only supports the 'card' payment method type." }),
    )
    .optional();
  const response = { 200: paymentIntentSchema, ...errorResponses };

  return async (app) => {
    app.post('/v1/payment_intents', {
      schema: {
        tags,
        summary: 'Create a payment intent',
        description: `Pass \`confirm=true\` with a \`payment_method\` to create and confirm in one call. ${DELAY_HEADER_DOC}`,
        body: params(
          {
            amount: amount(),
            currency: currency(),
            customer: z.string().min(1).optional(),
            payment_method: z.string().min(1).optional(),
            description: nullableString(1000).optional(),
            receipt_email: email().optional(),
            metadata: metadata().optional(),
            confirm: boolean().optional(),
            return_url: httpUrl().optional(),
            capture_method: z.literal('automatic').optional(),
            confirmation_method: z.literal('automatic').optional(),
            payment_method_types: paymentMethodTypes,
            expand: expandParam,
            ...ignoredPaymentParams,
          },
          strictParams,
        ),
        response,
      },
      handler: (request) => services.paymentIntents.create(request.body, requestContext(request)),
    });

    app.get('/v1/payment_intents', {
      schema: {
        tags,
        summary: 'List payment intents',
        description: 'Filtering by `status` is a LocalStripe extension.',
        querystring: params(
          {
            ...listParamsShape,
            customer: z.string().optional(),
            status: z.enum(PAYMENT_INTENT_STATUSES).optional(),
          },
          strictParams,
        ),
        response: { 200: listSchema(paymentIntentSchema), ...errorResponses },
      },
      handler: (request) =>
        services.paymentIntents.list(
          { customer: request.query.customer, status: request.query.status },
          toPageRequest(request.query),
        ),
    });

    app.get('/v1/payment_intents/:id', {
      config: { allowPublishable: true },
      schema: {
        tags,
        summary: 'Retrieve a payment intent',
        description: 'With a publishable key, `client_secret` is required.',
        params: idParams,
        querystring: params(
          { client_secret: z.string().optional(), expand: expandParam },
          strictParams,
        ),
        response,
      },
      handler: (request) =>
        services.paymentIntents.retrieve(
          request.params.id,
          requireClientSecretForPublishable(isPublishable(request), request.query.client_secret),
        ),
    });

    app.post('/v1/payment_intents/:id', {
      schema: {
        tags,
        summary: 'Update a payment intent',
        params: idParams,
        body: params(
          {
            amount: amount().optional(),
            currency: currency().optional(),
            customer: nullableString(255).optional(),
            payment_method: z.string().min(1).optional(),
            description: nullableString(1000).optional(),
            receipt_email: email().optional(),
            metadata: metadata().optional(),
            payment_method_types: paymentMethodTypes,
            expand: expandParam,
            ...ignoredPaymentParams,
          },
          strictParams,
        ).default({}),
        response,
      },
      handler: (request) => services.paymentIntents.update(request.params.id, request.body),
    });

    app.post('/v1/payment_intents/:id/confirm', {
      config: { allowPublishable: true },
      schema: {
        tags,
        summary: 'Confirm a payment intent',
        description: `The outcome is decided by the test card behind the payment method. Declines return HTTP 402 with the updated PaymentIntent in \`error.payment_intent\`. ${DELAY_HEADER_DOC}`,
        params: idParams,
        body: params(
          {
            payment_method: z.string().min(1).optional(),
            return_url: httpUrl().optional(),
            client_secret: z.string().optional(),
            expand: expandParam,
            ...ignoredPaymentParams,
          },
          strictParams,
        ).default({}),
        response,
      },
      handler: (request) =>
        services.paymentIntents.confirm(
          request.params.id,
          request.body,
          requestContext(request),
          requireClientSecretForPublishable(isPublishable(request), request.body.client_secret),
        ),
    });

    app.post('/v1/payment_intents/:id/cancel', {
      schema: {
        tags,
        summary: 'Cancel a payment intent',
        params: idParams,
        body: params(
          { cancellation_reason: z.enum(CANCELLATION_REASONS).optional(), expand: expandParam },
          strictParams,
        ).default({}),
        response,
      },
      handler: (request) =>
        services.paymentIntents.cancel(
          request.params.id,
          request.body.cancellation_reason,
          requestContext(request),
        ),
    });
  };
}
