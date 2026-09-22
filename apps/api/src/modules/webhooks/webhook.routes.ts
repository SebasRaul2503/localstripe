import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  WEBHOOK_DELIVERY_STATUSES,
  deletedObjectSchema,
  listSchema,
  webhookDeliveryAttemptSchema,
  webhookDeliverySchema,
  webhookEndpointSchema,
} from '@localstripe/contracts';
import { errorResponses, idParams, params, type RouteDeps } from '../../http/route-helpers.js';
import { listParamsShape, toPageRequest } from '../../shared/pagination.js';
import {
  boolean,
  expandParam,
  httpUrl,
  metadata,
  nullableString,
} from '../../shared/validation.js';

const enabledEvents = z.union([
  z.array(z.string().max(100)).max(100),
  z
    .string()
    .max(100)
    .transform((value) => [value]),
]);

export function webhookRoutes({ services, strictParams }: RouteDeps): FastifyPluginAsyncZod {
  const tags = ['Webhook endpoints'];
  const extensionTags = ['LocalStripe: webhooks'];
  const response = { 200: webhookEndpointSchema, ...errorResponses };

  return async (app) => {
    app.post('/v1/webhook_endpoints', {
      schema: {
        tags,
        summary: 'Create a webhook endpoint',
        description:
          "The signing secret (`whsec_...`) is only returned here. Use `'*'` in `enabled_events` to receive every event. From inside Docker, use `http://host.docker.internal:<port>` to reach an app running on your machine.",
        body: params(
          {
            url: httpUrl(),
            enabled_events: enabledEvents,
            description: nullableString(1000).optional(),
            metadata: metadata().optional(),
            api_version: z.string().optional(),
            connect: z.unknown().optional(),
            expand: expandParam,
          },
          strictParams,
        ),
        response,
      },
      handler: (request) => services.webhookEndpoints.create(request.body),
    });

    app.get('/v1/webhook_endpoints', {
      schema: {
        tags,
        summary: 'List webhook endpoints',
        querystring: params({ ...listParamsShape }, strictParams),
        response: { 200: listSchema(webhookEndpointSchema), ...errorResponses },
      },
      handler: (request) => services.webhookEndpoints.list(toPageRequest(request.query)),
    });

    app.get('/v1/webhook_endpoints/:id', {
      schema: { tags, summary: 'Retrieve a webhook endpoint', params: idParams, response },
      handler: (request) => services.webhookEndpoints.retrieve(request.params.id),
    });

    app.post('/v1/webhook_endpoints/:id', {
      schema: {
        tags,
        summary: 'Update a webhook endpoint',
        params: idParams,
        body: params(
          {
            url: httpUrl().optional(),
            enabled_events: enabledEvents.optional(),
            description: nullableString(1000).optional(),
            disabled: boolean().optional(),
            metadata: metadata().optional(),
            expand: expandParam,
          },
          strictParams,
        ).default({}),
        response,
      },
      handler: (request) => services.webhookEndpoints.update(request.params.id, request.body),
    });

    app.delete('/v1/webhook_endpoints/:id', {
      schema: {
        tags,
        summary: 'Delete a webhook endpoint',
        params: idParams,
        response: { 200: deletedObjectSchema, ...errorResponses },
      },
      handler: (request) => services.webhookEndpoints.delete(request.params.id),
    });

    app.get('/v1/localstripe/webhook_endpoints/:id/secret', {
      schema: {
        tags: extensionTags,
        summary: 'Reveal the signing secret of a webhook endpoint',
        params: idParams,
        response: {
          200: z.object({
            object: z.literal('webhook_endpoint_secret'),
            id: z.string(),
            secret: z.string(),
          }),
          ...errorResponses,
        },
      },
      handler: (request) => services.webhookEndpoints.revealSecret(request.params.id),
    });

    app.get('/v1/localstripe/webhook_deliveries', {
      schema: {
        tags: extensionTags,
        summary: 'List webhook deliveries',
        querystring: params(
          {
            ...listParamsShape,
            webhook_endpoint: z.string().optional(),
            event: z.string().optional(),
            status: z.enum(WEBHOOK_DELIVERY_STATUSES).optional(),
          },
          strictParams,
        ),
        response: { 200: listSchema(webhookDeliverySchema), ...errorResponses },
      },
      handler: (request) =>
        services.webhookDeliveries.list(
          {
            webhookEndpoint: request.query.webhook_endpoint,
            event: request.query.event,
            status: request.query.status,
          },
          toPageRequest(request.query),
        ),
    });

    app.get('/v1/localstripe/webhook_deliveries/:id', {
      schema: {
        tags: extensionTags,
        summary: 'Retrieve a webhook delivery with its attempt history',
        params: idParams,
        response: {
          200: webhookDeliverySchema.extend({
            attempt_history: z.array(webhookDeliveryAttemptSchema),
          }),
          ...errorResponses,
        },
      },
      handler: (request) => services.webhookDeliveries.retrieve(request.params.id),
    });

    app.post('/v1/localstripe/webhook_deliveries/:id/retry', {
      schema: {
        tags: extensionTags,
        summary: 'Retry a webhook delivery now',
        params: idParams,
        response: { 200: webhookDeliverySchema, ...errorResponses },
      },
      handler: (request) => services.webhookDeliveries.retry(request.params.id),
    });

    app.post('/v1/localstripe/events/:id/resend', {
      schema: {
        tags: extensionTags,
        summary: 'Re-send an event to its webhook endpoints',
        params: idParams,
        response: { 200: listSchema(webhookDeliverySchema), ...errorResponses },
      },
      handler: (request) => services.webhookDeliveries.resendEvent(request.params.id),
    });
  };
}
