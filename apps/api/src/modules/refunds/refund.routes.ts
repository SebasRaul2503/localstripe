import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { REFUND_REASONS, listSchema, refundSchema } from '@localstripe/contracts';
import { requestContext } from '../../http/auth.js';
import { errorResponses, idParams, params, type RouteDeps } from '../../http/route-helpers.js';
import { listParamsShape, toPageRequest } from '../../shared/pagination.js';
import { amount, expandParam, metadata } from '../../shared/validation.js';

export function refundRoutes({ services, strictParams }: RouteDeps): FastifyPluginAsyncZod {
  const tags = ['Refunds'];
  const response = { 200: refundSchema, ...errorResponses };
  return async (app) => {
    app.post('/v1/refunds', {
      schema: {
        tags,
        summary: 'Create a refund',
        description:
          'Refunds a succeeded payment in full or in part. `amount` defaults to the remaining refundable amount.',
        body: params(
          {
            payment_intent: z.string().min(1).optional(),
            charge: z.string().min(1).optional(),
            amount: amount().optional(),
            reason: z.enum(REFUND_REASONS).optional(),
            metadata: metadata().optional(),
            expand: expandParam,
          },
          strictParams,
        ),
        response,
      },
      handler: (request) => services.refunds.create(request.body, requestContext(request)),
    });

    app.get('/v1/refunds', {
      schema: {
        tags,
        summary: 'List refunds',
        querystring: params(
          {
            ...listParamsShape,
            payment_intent: z.string().optional(),
            charge: z.string().optional(),
          },
          strictParams,
        ),
        response: { 200: listSchema(refundSchema), ...errorResponses },
      },
      handler: (request) =>
        services.refunds.list(
          { paymentIntent: request.query.payment_intent, charge: request.query.charge },
          toPageRequest(request.query),
        ),
    });

    app.get('/v1/refunds/:id', {
      schema: { tags, summary: 'Retrieve a refund', params: idParams, response },
      handler: (request) => services.refunds.retrieve(request.params.id),
    });

    app.post('/v1/refunds/:id', {
      schema: {
        tags,
        summary: 'Update a refund',
        params: idParams,
        body: params(
          { metadata: metadata().optional(), expand: expandParam },
          strictParams,
        ).default({}),
        response,
      },
      handler: (request) => services.refunds.update(request.params.id, request.body.metadata),
    });
  };
}
