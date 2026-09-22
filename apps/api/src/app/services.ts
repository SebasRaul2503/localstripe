import type { Logger } from 'pino';
import type { Config } from '../config/config.js';
import type { Db } from '../infrastructure/database.js';
import type { Metrics } from '../infrastructure/metrics.js';
import { TestCardCatalog } from '../modules/test-cards/catalog.js';
import { EventService } from '../modules/events/event.service.js';
import { CustomerService } from '../modules/customers/customer.service.js';
import { PaymentMethodService } from '../modules/payment-methods/payment-method.service.js';
import { ChargeService } from '../modules/charges/charge.service.js';
import { PaymentIntentService } from '../modules/payment-intents/payment-intent.service.js';
import { RefundService } from '../modules/refunds/refund.service.js';
import { CheckoutSessionService } from '../modules/checkout/checkout-session.service.js';
import { WebhookEndpointService } from '../modules/webhooks/webhook-endpoint.service.js';
import { WebhookDeliveryService } from '../modules/webhooks/webhook-delivery.service.js';
import { WebhookDispatcher } from '../modules/webhooks/webhook-dispatcher.js';
import { ApiKeyService } from '../modules/api-keys/api-key.service.js';
import { IdempotencyService } from '../modules/idempotency/idempotency.service.js';
import { StatsService } from '../modules/localstripe/stats.service.js';
import { FixturesService } from '../modules/localstripe/fixtures.service.js';
import { JobQueue } from '../worker/job-queue.js';

export interface Services {
  catalog: TestCardCatalog;
  events: EventService;
  customers: CustomerService;
  paymentMethods: PaymentMethodService;
  charges: ChargeService;
  paymentIntents: PaymentIntentService;
  refunds: RefundService;
  checkoutSessions: CheckoutSessionService;
  webhookEndpoints: WebhookEndpointService;
  webhookDeliveries: WebhookDeliveryService;
  webhookDispatcher: WebhookDispatcher;
  apiKeys: ApiKeyService;
  idempotency: IdempotencyService;
  stats: StatsService;
  fixtures: FixturesService;
  jobs: JobQueue;
}

export interface Dependencies {
  config: Config;
  db: Db;
  logger: Logger;
  metrics: Metrics;
  catalog?: TestCardCatalog;
}

/** The composition root: the only place where modules are wired together. */
export function createServices({
  config,
  db,
  logger,
  metrics,
  catalog: providedCatalog,
}: Dependencies): Services {
  const catalog = providedCatalog ?? TestCardCatalog.load(config.payments.catalogPath);
  const jobs = new JobQueue(db);
  const events = new EventService(db);
  const customers = new CustomerService(db, events);
  const paymentMethods = new PaymentMethodService(db, events, customers, catalog);
  const charges = new ChargeService(db);
  const paymentIntents = new PaymentIntentService(
    db,
    events,
    customers,
    paymentMethods,
    charges,
    jobs,
    metrics,
    {
      publicUrl: config.http.publicUrl,
      delays: config.payments,
    },
  );
  const refunds = new RefundService(db, events, charges, paymentIntents);
  const checkoutSessions = new CheckoutSessionService(
    db,
    events,
    customers,
    paymentMethods,
    paymentIntents,
    {
      publicUrl: config.http.publicUrl,
      sessionTtlMinutes: config.checkout.sessionTtlMinutes,
    },
  );
  const webhookEndpoints = new WebhookEndpointService(db);
  const webhookDeliveries = new WebhookDeliveryService(db);
  const webhookDispatcher = new WebhookDispatcher(
    db,
    events,
    logger.child({ component: 'webhooks' }),
    metrics,
    {
      maxAttempts: config.webhooks.maxAttempts,
      baseDelayMs: config.webhooks.retryBaseDelayMs,
      timeoutMs: config.webhooks.timeoutMs,
    },
  );

  return {
    catalog,
    events,
    customers,
    paymentMethods,
    charges,
    paymentIntents,
    refunds,
    checkoutSessions,
    webhookEndpoints,
    webhookDeliveries,
    webhookDispatcher,
    apiKeys: new ApiKeyService(db, logger.child({ component: 'api-keys' })),
    idempotency: new IdempotencyService(db),
    stats: new StatsService(db, customers, events, webhookDeliveries),
    fixtures: new FixturesService(
      db,
      catalog,
      customers,
      paymentMethods,
      paymentIntents,
      refunds,
      checkoutSessions,
    ),
    jobs,
  };
}
