import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { listSchema, paymentMethodSchema } from '@localstripe/contracts';
import { requestContext } from '../../http/auth.js';
import { errorResponses, idParams, params, type RouteDeps } from '../../http/route-helpers.js';
import { listParamsShape, toPageRequest } from '../../shared/pagination.js';
import {
  addressInput,
  email,
  expandParam,
  integer,
  metadata,
  nullableString,
} from '../../shared/validation.js';

const billingDetails = z.object({
  name: nullableString(256).optional(),
  email: email().optional(),
  phone: nullableString(64).optional(),
  address: z.union([z.literal('').transform(() => null), addressInput()]).optional(),
});

export function paymentMethodRoutes({ services, strictParams }: RouteDeps): FastifyPluginAsyncZod {
  const tags = ['Payment methods'];

  return async (app) => {
    app.post('/v1/payment_methods', {
      config: { allowPublishable: true },
      schema: {
        tags,
        summary: 'Create a payment method from a test card',
        description:
          'Only card numbers from the test card catalog are accepted (GET /v1/localstripe/test_cards). The card number and CVC are validated and discarded; only the brand, last4 and expiry are stored. Can be called with a publishable key.',
        body: params(
          {
            type: z.literal('card'),
            card: z.object({
              number: z.string().regex(/^[\d\s-]{12,23}$/, 'must be a card number'),
              exp_month: integer({ min: 1, max: 12 }),
              exp_year: integer({ min: 0, max: 9999 }),
              cvc: z.string().max(4).optional(),
            }),
            billing_details: billingDetails.optional(),
            metadata: metadata().optional(),
            expand: expandParam,
          },
          strictParams,
        ),
        response: { 200: paymentMethodSchema, ...errorResponses },
      },
      handler: (request) => services.paymentMethods.create(request.body),
    });

    app.get('/v1/payment_methods', {
      schema: {
        tags,
        summary: 'List payment methods',
        description:
          'Unlike Stripe, `customer` is optional so the dashboard can list every payment method.',
        querystring: params(
          { ...listParamsShape, customer: z.string().optional(), type: z.string().optional() },
          strictParams,
        ),
        response: { 200: listSchema(paymentMethodSchema), ...errorResponses },
      },
      handler: (request) =>
        services.paymentMethods.list(
          { customer: request.query.customer, type: request.query.type },
          toPageRequest(request.query),
        ),
    });

    app.get('/v1/payment_methods/:id', {
      schema: {
        tags,
        summary: 'Retrieve a payment method',
        params: idParams,
        response: { 200: paymentMethodSchema, ...errorResponses },
      },
      handler: (request) => services.paymentMethods.retrieve(request.params.id),
    });

    app.post('/v1/payment_methods/:id', {
      schema: {
        tags,
        summary: 'Update a payment method',
        params: idParams,
        body: params(
          {
            billing_details: billingDetails.optional(),
            metadata: metadata().optional(),
            card: z
              .object({
                exp_month: integer({ min: 1, max: 12 }).optional(),
                exp_year: integer({ min: 0, max: 9999 }).optional(),
              })
              .optional(),
            expand: expandParam,
          },
          strictParams,
        ).default({}),
        response: { 200: paymentMethodSchema, ...errorResponses },
      },
      handler: (request) => services.paymentMethods.update(request.params.id, request.body),
    });

    app.post('/v1/payment_methods/:id/attach', {
      schema: {
        tags,
        summary: 'Attach a payment method to a customer',
        params: idParams,
        body: params({ customer: z.string().min(1), expand: expandParam }, strictParams),
        response: { 200: paymentMethodSchema, ...errorResponses },
      },
      handler: (request) =>
        services.paymentMethods.attach(
          request.params.id,
          request.body.customer,
          requestContext(request),
        ),
    });

    app.post('/v1/payment_methods/:id/detach', {
      schema: {
        tags,
        summary: 'Detach a payment method from its customer',
        params: idParams,
        body: params({ expand: expandParam }, strictParams).default({}),
        response: { 200: paymentMethodSchema, ...errorResponses },
      },
      handler: (request) =>
        services.paymentMethods.detach(request.params.id, requestContext(request)),
    });
  };
}
