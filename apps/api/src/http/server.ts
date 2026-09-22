import { createHash } from 'node:crypto';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import scalar from '@scalar/fastify-api-reference';
import qs from 'qs';
import { sql } from 'kysely';
import type { Logger } from 'pino';
import {
  jsonSchemaTransform,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Config } from '../config/config.js';
import type { Db } from '../infrastructure/database.js';
import type { Metrics } from '../infrastructure/metrics.js';
import type { Services } from '../app/services.js';
import { randomToken } from '../shared/ids.js';
import { registerErrorHandling } from './errors.js';
import { registerAuthentication } from './auth.js';
import { registerIdempotency } from './idempotency.js';
import type { RouteDeps } from './route-helpers.js';
import { customerRoutes } from '../modules/customers/customer.routes.js';
import { paymentMethodRoutes } from '../modules/payment-methods/payment-method.routes.js';
import { paymentIntentRoutes } from '../modules/payment-intents/payment-intent.routes.js';
import { chargeRoutes } from '../modules/charges/charge.routes.js';
import { refundRoutes } from '../modules/refunds/refund.routes.js';
import { checkoutSessionRoutes } from '../modules/checkout/checkout-session.routes.js';
import { eventRoutes } from '../modules/events/event.routes.js';
import { webhookRoutes } from '../modules/webhooks/webhook.routes.js';
import { localStripeRoutes } from '../modules/localstripe/localstripe.routes.js';
import { hostedRoutes } from '../modules/hosted/hosted.routes.js';

export const API_VERSION_PREFIX = '/v1';

export interface ServerDeps {
  config: Config;
  db: Db;
  logger: Logger;
  metrics: Metrics;
  services: Services;
  /** Reports whether the background worker is healthy, when it runs in this process. */
  workerHealthy?: () => boolean;
}

const parseForm = (body: string) =>
  qs.parse(body, { depth: 6, arrayLimit: 100, parameterLimit: 1000, allowDots: false });

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { config, db, logger, metrics, services } = deps;
  const app = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    bodyLimit: config.http.bodyLimitBytes,
    trustProxy: false,
    genReqId: () => `req_${randomToken(16)}`,
    requestIdLogLabel: 'requestId',
    disableRequestLogging: true,
    routerOptions: {
      querystringParser: (query: string) => parseForm(query),
      ignoreTrailingSlash: true,
    },
    ajv: { customOptions: { coerceTypes: false } },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  // Responses are built from typed mappers; schemas are attached for documentation only.
  app.setSerializerCompiler(() => (data) => JSON.stringify(data));

  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string', bodyLimit: config.http.bodyLimitBytes },
    (_request, body, done) => {
      try {
        done(null, parseForm(body as string));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  app.addHook('onRequest', async (request, reply) => {
    reply.header('request-id', request.id);
  });
  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url ?? 'unmatched';
    const duration = reply.elapsedTime;
    metrics.httpRequests.inc({ method: request.method, route, status: reply.statusCode });
    metrics.httpDuration.observe({ method: request.method, route }, duration / 1000);
    if (route === '/health' || route === '/ready' || route === '/metrics') return;
    request.log.info(
      {
        method: request.method,
        route,
        statusCode: reply.statusCode,
        durationMs: Math.round(duration),
        ...(request.apiKey && { apiKeyId: request.apiKey.id }),
      },
      'request completed',
    );
  });

  await app.register(helmet, {
    // JSON responses need no CSP; HTML routes (hosted pages, docs) set their own.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(cors, {
    origin: config.http.corsOrigins.includes('*') ? true : config.http.corsOrigins,
    allowedHeaders: [
      'authorization',
      'content-type',
      'idempotency-key',
      'stripe-version',
      'localstripe-delay-ms',
    ],
    exposedHeaders: ['request-id', 'idempotent-replayed'],
    methods: ['GET', 'POST', 'DELETE'],
    maxAge: 600,
  });
  await app.register(rateLimit, {
    max: config.http.rateLimit.max,
    timeWindow: config.http.rateLimit.windowMs,
    allowList: (request) => ['/health', '/ready', '/metrics'].includes(request.url),
    keyGenerator: (request) => {
      const authorization = request.headers.authorization;
      return authorization
        ? createHash('sha256').update(authorization).digest('hex').slice(0, 32)
        : request.ip;
    },
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: 'rate_limit',
      message: `Rate limit exceeded: at most ${context.max} requests per ${context.after}.`,
    }),
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'LocalStripe API',
        version: '1.0.0',
        description:
          'A local, Stripe-like payment mock for development and testing. **LocalStripe does not process real payments**: it never moves money and never contacts banks, card networks or Stripe.',
        license: { name: 'MIT' },
      },
      servers: [{ url: config.http.publicUrl }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            description: 'sk_test_... or pk_test_... key',
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    transform: jsonSchemaTransform,
  });

  registerErrorHandling(app, { exposeInternalMessages: config.env !== 'production' });
  registerAuthentication(app, services.apiKeys);
  registerIdempotency(app, services.idempotency);

  app.get(
    '/health',
    { schema: { tags: ['Health'], summary: 'Liveness probe', security: [] } },
    async () => ({
      status: 'ok',
      service: 'localstripe-api',
    }),
  );

  app.get(
    '/ready',
    {
      schema: { tags: ['Health'], summary: 'Readiness probe (database and worker)', security: [] },
    },
    async (_request, reply) => {
      const checks: Record<string, 'ok' | 'failing'> = {};
      try {
        await sql`select 1`.execute(db);
        checks['database'] = 'ok';
      } catch {
        checks['database'] = 'failing';
      }
      if (deps.workerHealthy) checks['worker'] = deps.workerHealthy() ? 'ok' : 'failing';
      const ready = Object.values(checks).every((value) => value === 'ok');
      return reply
        .status(ready ? 200 : 503)
        .send({ status: ready ? 'ready' : 'not_ready', checks });
    },
  );

  if (config.http.metricsEnabled) {
    app.get('/metrics', { schema: { hide: true } }, async (_request, reply) =>
      reply
        .header('content-type', metrics.registry.contentType)
        .send(await metrics.registry.metrics()),
    );
  }

  app.get('/', { schema: { hide: true } }, async () => ({
    name: 'LocalStripe',
    description: 'A local Stripe-like payment mock/emulator. It does not process real payments.',
    api: `${config.http.publicUrl}${API_VERSION_PREFIX}`,
    docs: `${config.http.publicUrl}/docs`,
    openapi: `${config.http.publicUrl}/openapi.json`,
    dashboard: config.http.dashboardUrl,
  }));

  const routeDeps: RouteDeps = { services, strictParams: config.http.strictParams };
  await app.register(customerRoutes(routeDeps));
  await app.register(paymentMethodRoutes(routeDeps));
  await app.register(paymentIntentRoutes(routeDeps));
  await app.register(chargeRoutes(routeDeps));
  await app.register(refundRoutes(routeDeps));
  await app.register(checkoutSessionRoutes(routeDeps));
  await app.register(eventRoutes(routeDeps));
  await app.register(webhookRoutes(routeDeps));
  await app.register(localStripeRoutes({ ...routeDeps, config }));
  await app.register(hostedRoutes(services));

  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
  await app.register(scalar, {
    routePrefix: '/docs',
    configuration: { url: '/openapi.json', title: 'LocalStripe API' },
  });

  return app;
}
