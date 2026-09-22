import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  API_KEY_TYPES,
  apiKeySchema,
  checkoutSessionSchema,
  listSchema,
  paymentIntentSchema,
  statsSchema,
  testCardSchema,
} from '@localstripe/contracts';
import type { Config } from '../../config/config.js';
import { requestContext } from '../../http/auth.js';
import { errorResponses, idParams, params, type RouteDeps } from '../../http/route-helpers.js';
import { TestCardCatalog } from '../test-cards/catalog.js';
import { boolean, integer } from '../../shared/validation.js';
import { invalidRequest } from '../../shared/errors.js';
import { TRIGGERABLE_EVENTS } from './fixtures.service.js';

export function localStripeRoutes({
  services,
  strictParams,
  config,
}: RouteDeps & { config: Config }): FastifyPluginAsyncZod {
  const tags = ['LocalStripe'];

  return async (app) => {
    app.get('/v1/localstripe/test_cards', {
      config: { allowPublishable: true },
      schema: {
        tags,
        summary: 'List the test card catalog',
        description: 'The only card numbers LocalStripe accepts, and what each one does.',
        response: { 200: listSchema(testCardSchema), ...errorResponses },
      },
      handler: () => ({
        object: 'list' as const,
        data: services.catalog.list().map(TestCardCatalog.toResource),
        has_more: false,
        url: '/v1/localstripe/test_cards',
      }),
    });

    app.get('/v1/localstripe/stats', {
      schema: {
        tags,
        summary: 'Dashboard summary statistics',
        response: { 200: statsSchema, ...errorResponses },
      },
      handler: () => services.stats.summary(),
    });

    app.get('/v1/localstripe/config', {
      schema: { tags, summary: 'Effective (non-secret) runtime settings' },
      handler: () => ({
        object: 'localstripe_config',
        version: process.env['npm_package_version'] ?? '0.1.0',
        public_api_url: config.http.publicUrl,
        strict_params: config.http.strictParams,
        payments: {
          global_delay_ms: config.payments.globalDelayMs,
          scenario_delays_ms: config.payments.scenarioDelays,
          max_delay_ms: config.payments.maxDelayMs,
          custom_catalog: Boolean(config.payments.catalogPath),
        },
        webhooks: {
          max_attempts: config.webhooks.maxAttempts,
          retry_base_delay_ms: config.webhooks.retryBaseDelayMs,
          timeout_ms: config.webhooks.timeoutMs,
        },
        checkout: { session_ttl_minutes: config.checkout.sessionTtlMinutes },
      }),
    });

    app.get('/v1/localstripe/api_keys', {
      schema: {
        tags,
        summary: 'List API keys',
        response: { 200: listSchema(apiKeySchema), ...errorResponses },
      },
      handler: () => services.apiKeys.list(),
    });

    app.post('/v1/localstripe/api_keys', {
      schema: {
        tags,
        summary: 'Create an API key',
        description: 'The full secret key is returned only in this response.',
        body: params(
          { type: z.enum(API_KEY_TYPES), name: z.string().min(1).max(100) },
          strictParams,
        ),
        response: { 200: apiKeySchema, ...errorResponses },
      },
      handler: (request) => services.apiKeys.create(request.body.type, request.body.name),
    });

    app.post('/v1/localstripe/api_keys/:id/revoke', {
      schema: {
        tags,
        summary: 'Revoke an API key',
        params: idParams,
        response: { 200: apiKeySchema, ...errorResponses },
      },
      handler: (request) =>
        services.apiKeys.revoke(request.params.id, requestContext(request).apiKey),
    });

    app.post('/v1/localstripe/payment_intents/:id/authenticate', {
      config: { allowPublishable: true },
      schema: {
        tags,
        summary: 'Complete the simulated 3D Secure challenge',
        description:
          'Programmatic equivalent of the hosted 3DS page (`next_action.redirect_to_url.url`). `outcome=succeed` makes the payment succeed, `outcome=fail` declines it with `payment_intent_authentication_failure`.',
        params: idParams,
        body: params(
          {
            outcome: z.enum(['succeed', 'fail']).default('succeed'),
            client_secret: z.string().optional(),
          },
          strictParams,
        ).default({ outcome: 'succeed' }),
        response: { 200: paymentIntentSchema, ...errorResponses },
      },
      handler: (request) => {
        const ctx = requestContext(request);
        const clientSecret =
          ctx.apiKey.type === 'publishable' ? (request.body.client_secret ?? '') : undefined;
        return services.paymentIntents.authenticate(
          request.params.id,
          request.body.outcome,
          ctx,
          clientSecret,
        );
      },
    });

    app.post('/v1/localstripe/checkout/sessions/:id/complete', {
      schema: {
        tags,
        summary: 'Pay a Checkout Session without the hosted page',
        description:
          'Equivalent to submitting the hosted checkout page. Provide a test `card` or an existing `payment_method`.',
        params: idParams,
        body: params(
          {
            payment_method: z.string().min(1).optional(),
            card: z
              .object({
                number: z.string().regex(/^[\d\s-]{12,23}$/),
                exp_month: integer({ min: 1, max: 12 }),
                exp_year: integer({ min: 0, max: 9999 }),
                cvc: z.string().max(4).optional(),
              })
              .optional(),
          },
          strictParams,
        ),
        response: {
          200: z.object({
            object: z.literal('checkout_completion'),
            checkout_session: checkoutSessionSchema,
            payment_intent: paymentIntentSchema,
          }),
          ...errorResponses,
        },
      },
      handler: async (request) => {
        const result = await services.checkoutSessions.complete(
          request.params.id,
          request.body,
          requestContext(request),
        );
        return {
          object: 'checkout_completion' as const,
          checkout_session: result.session,
          payment_intent: result.paymentIntent,
        };
      },
    });

    app.post('/v1/localstripe/trigger', {
      schema: {
        tags,
        summary: 'Trigger an event by running a fixture flow',
        description: 'Like `stripe trigger`: creates the objects needed to produce the event.',
        body: params({ event: z.enum(TRIGGERABLE_EVENTS) }, strictParams),
        response: {
          200: z.object({
            object: z.literal('trigger_result'),
            event: z.string(),
            objects: z.array(z.string()),
            events: z.array(z.string()),
          }),
          ...errorResponses,
        },
      },
      handler: async (request) => {
        const ctx = requestContext(request);
        const objects = await services.fixtures.trigger(request.body.event, ctx);
        const events = await services.events.list(
          { requestId: ctx.requestId ?? undefined },
          { limit: 100 },
        );
        return {
          object: 'trigger_result' as const,
          event: request.body.event,
          objects,
          events: events.data.map((event) => event.id).reverse(),
        };
      },
    });

    app.post('/v1/localstripe/seed', {
      schema: { tags, summary: 'Create clearly labelled demo data' },
      handler: (request) =>
        services.fixtures
          .seedDemoData(requestContext(request))
          .then((result) => ({ object: 'seed_result', ...result })),
    });

    app.post('/v1/localstripe/reset', {
      schema: {
        tags,
        summary: 'Delete all payment data',
        description:
          'Removes customers, payments, refunds, events and deliveries. API keys and webhook endpoints are kept. Requires `confirm=true`.',
        body: params({ confirm: boolean() }, strictParams),
      },
      handler: async (request) => {
        if (!request.body.confirm)
          throw invalidRequest('Pass confirm=true to delete all data.', { param: 'confirm' });
        await services.fixtures.reset();
        request.log.warn('all payment data was reset');
        return { object: 'reset_result', reset: true };
      },
    });
  };
}
