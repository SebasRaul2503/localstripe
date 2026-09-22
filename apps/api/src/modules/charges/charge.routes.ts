import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { chargeSchema, listSchema } from '@localstripe/contracts';
import { errorResponses, idParams, params, type RouteDeps } from '../../http/route-helpers.js';
import { listParamsShape, toPageRequest } from '../../shared/pagination.js';

export function chargeRoutes({ services, strictParams }: RouteDeps): FastifyPluginAsyncZod {
  const tags = ['Charges'];
  return async (app) => {
    app.get('/v1/charges', {
      schema: {
        tags,
        summary: 'List charges',
        querystring: params(
          {
            ...listParamsShape,
            payment_intent: z.string().optional(),
            customer: z.string().optional(),
          },
          strictParams,
        ),
        response: { 200: listSchema(chargeSchema), ...errorResponses },
      },
      handler: (request) =>
        services.charges.list(
          { paymentIntent: request.query.payment_intent, customer: request.query.customer },
          toPageRequest(request.query),
        ),
    });

    app.get('/v1/charges/:id', {
      schema: {
        tags,
        summary: 'Retrieve a charge',
        params: idParams,
        response: { 200: chargeSchema, ...errorResponses },
      },
      handler: (request) => services.charges.retrieve(request.params.id),
    });
  };
}
