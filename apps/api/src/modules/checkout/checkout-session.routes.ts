import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  CHECKOUT_SESSION_STATUSES,
  checkoutSessionSchema,
  lineItemSchema,
  listSchema,
} from '@localstripe/contracts';
import { requestContext } from '../../http/auth.js';
import { errorResponses, idParams, params, type RouteDeps } from '../../http/route-helpers.js';
import { listParamsShape, toPageRequest } from '../../shared/pagination.js';
import {
  currency,
  email,
  expandParam,
  httpUrl,
  integer,
  metadata,
} from '../../shared/validation.js';

const lineItem = z.strictObject({
  price_data: z.strictObject({
    currency: currency(),
    unit_amount: integer({ min: 0, max: 99_999_999 }),
    product_data: z.strictObject({
      name: z.string().min(1).max(250),
      description: z.string().max(1000).optional(),
    }),
  }),
  quantity: integer({ min: 1, max: 999 }),
});

/** Stripe's `{CHECKOUT_SESSION_ID}` placeholder is not a valid URL character sequence for URL parsers. */
const successUrl = z
  .string()
  .max(2048)
  .refine(
    (value) =>
      httpUrl().safeParse(value.replaceAll('{CHECKOUT_SESSION_ID}', 'placeholder')).success,
    {
      message: 'must be an http(s) URL',
    },
  );

export function checkoutSessionRoutes({
  services,
  strictParams,
}: RouteDeps): FastifyPluginAsyncZod {
  const tags = ['Checkout sessions'];
  const response = { 200: checkoutSessionSchema, ...errorResponses };
  return async (app) => {
    app.post('/v1/checkout/sessions', {
      schema: {
        tags,
        summary: 'Create a Checkout Session',
        description:
          "Simplified Stripe Checkout: `mode=payment` with inline `price_data` line items. The returned `url` opens LocalStripe's hosted test checkout page.",
        body: params(
          {
            mode: z.literal('payment').default('payment'),
            line_items: z.array(lineItem).min(1).max(100),
            success_url: successUrl,
            cancel_url: httpUrl().optional(),
            customer: z.string().min(1).optional(),
            customer_email: email().optional(),
            client_reference_id: z.string().max(200).optional(),
            metadata: metadata().optional(),
            payment_intent_data: z.strictObject({ metadata: metadata().optional() }).optional(),
            expires_at: integer().optional(),
            payment_method_types: z.array(z.literal('card')).optional(),
            expand: expandParam,
          },
          strictParams,
        ),
        response,
      },
      handler: (request) => services.checkoutSessions.create(request.body),
    });

    app.get('/v1/checkout/sessions', {
      schema: {
        tags,
        summary: 'List Checkout Sessions',
        querystring: params(
          {
            ...listParamsShape,
            payment_intent: z.string().optional(),
            customer: z.string().optional(),
            status: z.enum(CHECKOUT_SESSION_STATUSES).optional(),
          },
          strictParams,
        ),
        response: { 200: listSchema(checkoutSessionSchema), ...errorResponses },
      },
      handler: (request) =>
        services.checkoutSessions.list(
          {
            paymentIntent: request.query.payment_intent,
            customer: request.query.customer,
            status: request.query.status,
          },
          toPageRequest(request.query),
        ),
    });

    app.get('/v1/checkout/sessions/:id', {
      schema: { tags, summary: 'Retrieve a Checkout Session', params: idParams, response },
      handler: (request) => services.checkoutSessions.retrieve(request.params.id),
    });

    app.get('/v1/checkout/sessions/:id/line_items', {
      schema: {
        tags,
        summary: "Retrieve a Checkout Session's line items",
        params: idParams,
        querystring: params({ ...listParamsShape }, strictParams),
        response: { 200: listSchema(lineItemSchema), ...errorResponses },
      },
      handler: (request) => services.checkoutSessions.listLineItems(request.params.id),
    });

    app.post('/v1/checkout/sessions/:id/expire', {
      schema: { tags, summary: 'Expire a Checkout Session', params: idParams, response },
      handler: (request) =>
        services.checkoutSessions.expire(request.params.id, requestContext(request)),
    });
  };
}
