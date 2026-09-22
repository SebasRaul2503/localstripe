import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  customerSchema,
  deletedObjectSchema,
  listSchema,
  paymentMethodSchema,
} from '@localstripe/contracts';
import { requestContext } from '../../http/auth.js';
import { errorResponses, idParams, params, type RouteDeps } from '../../http/route-helpers.js';
import { listParamsShape, toPageRequest } from '../../shared/pagination.js';
import {
  addressInput,
  email,
  expandParam,
  metadata,
  nullableString,
} from '../../shared/validation.js';

export function customerRoutes({ services, strictParams }: RouteDeps): FastifyPluginAsyncZod {
  const fields = {
    email: email().optional(),
    name: nullableString(256).optional(),
    phone: nullableString(64).optional(),
    description: nullableString(5000).optional(),
    address: z.union([z.literal('').transform(() => null), addressInput()]).optional(),
    metadata: metadata().optional(),
    expand: expandParam,
  };
  const tags = ['Customers'];

  return async (app) => {
    app.post('/v1/customers', {
      schema: {
        tags,
        summary: 'Create a customer',
        body: params(fields, strictParams).default({}),
        response: { 200: customerSchema, ...errorResponses },
      },
      handler: (request) => services.customers.create(request.body, requestContext(request)),
    });

    app.get('/v1/customers', {
      schema: {
        tags,
        summary: 'List customers',
        description: '`query` is a LocalStripe extension that matches id, email or name.',
        querystring: params(
          {
            ...listParamsShape,
            email: z.string().max(512).optional(),
            query: z.string().max(256).optional(),
          },
          strictParams,
        ),
        response: { 200: listSchema(customerSchema), ...errorResponses },
      },
      handler: (request) =>
        services.customers.list(
          { email: request.query.email, query: request.query.query },
          toPageRequest(request.query),
        ),
    });

    app.get('/v1/customers/:id', {
      schema: {
        tags,
        summary: 'Retrieve a customer',
        params: idParams,
        response: { 200: customerSchema.or(deletedObjectSchema), ...errorResponses },
      },
      handler: (request) => services.customers.retrieve(request.params.id),
    });

    app.post('/v1/customers/:id', {
      schema: {
        tags,
        summary: 'Update a customer',
        params: idParams,
        body: params(
          {
            ...fields,
            invoice_settings: z
              .object({ default_payment_method: nullableString(255).optional() })
              .optional(),
          },
          strictParams,
        ).default({}),
        response: { 200: customerSchema, ...errorResponses },
      },
      handler: (request) =>
        services.customers.update(request.params.id, request.body, requestContext(request)),
    });

    app.delete('/v1/customers/:id', {
      schema: {
        tags,
        summary: 'Delete a customer',
        params: idParams,
        response: { 200: deletedObjectSchema, ...errorResponses },
      },
      handler: (request) => services.customers.delete(request.params.id, requestContext(request)),
    });

    app.get('/v1/customers/:id/payment_methods', {
      schema: {
        tags,
        summary: "List a customer's payment methods",
        params: idParams,
        querystring: params({ ...listParamsShape, type: z.string().optional() }, strictParams),
        response: { 200: listSchema(paymentMethodSchema), ...errorResponses },
      },
      handler: async (request) => {
        await services.customers.ensureActive(request.params.id, 'id');
        return services.paymentMethods.list(
          { customer: request.params.id, type: request.query.type },
          toPageRequest(request.query),
          `/v1/customers/${request.params.id}/payment_methods`,
        );
      },
    });
  };
}
