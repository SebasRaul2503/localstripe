import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { eventSchema, listSchema } from '@localstripe/contracts';
import { errorResponses, idParams, params, type RouteDeps } from '../../http/route-helpers.js';
import { listParamsShape, toPageRequest } from '../../shared/pagination.js';
import { integer } from '../../shared/validation.js';

const createdFilter = z
  .union([
    integer(),
    z.strictObject({
      gt: integer().optional(),
      gte: integer().optional(),
      lt: integer().optional(),
      lte: integer().optional(),
    }),
  ])
  .optional();

function createdRange(created: z.infer<typeof createdFilter>) {
  if (created === undefined) return {};
  if (typeof created === 'number')
    return { createdGte: new Date(created * 1000), createdLte: new Date(created * 1000 + 999) };
  const gte = created.gte ?? (created.gt !== undefined ? created.gt + 1 : undefined);
  const lte = created.lte ?? (created.lt !== undefined ? created.lt - 1 : undefined);
  return {
    createdGte: gte !== undefined ? new Date(gte * 1000) : undefined,
    createdLte: lte !== undefined ? new Date(lte * 1000 + 999) : undefined,
  };
}

export function eventRoutes({ services, strictParams }: RouteDeps): FastifyPluginAsyncZod {
  const tags = ['Events'];
  return async (app) => {
    app.get('/v1/events', {
      schema: {
        tags,
        summary: 'List events',
        description:
          '`object_id` is a LocalStripe extension to list the events of a single object.',
        querystring: params(
          {
            ...listParamsShape,
            type: z.string().max(100).optional(),
            types: z.array(z.string().max(100)).max(20).optional(),
            created: createdFilter,
            object_id: z.string().max(255).optional(),
            delivery_success: z.unknown().optional(),
          },
          strictParams,
        ),
        response: { 200: listSchema(eventSchema), ...errorResponses },
      },
      handler: (request) =>
        services.events.list(
          {
            type: request.query.type,
            types: request.query.types,
            objectId: request.query.object_id,
            ...createdRange(request.query.created),
          },
          toPageRequest(request.query),
        ),
    });

    app.get('/v1/events/:id', {
      schema: {
        tags,
        summary: 'Retrieve an event',
        params: idParams,
        response: { 200: eventSchema, ...errorResponses },
      },
      handler: (request) => services.events.retrieve(request.params.id),
    });
  };
}
