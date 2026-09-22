import type {
  ApiKey,
  ApiKeyType,
  CheckoutSession,
  List,
  PaymentIntent,
  Stats,
  TestCard,
  WebhookDelivery,
  WebhookDeliveryAttempt,
} from '@localstripe/contracts';
import type { HttpClient, RequestOptions } from '../http-client.js';
import { autoPaginate } from '../pagination.js';
import type { CardParam, WebhookDeliveryListParams } from './params.js';
import { Resource, idPath } from './resource.js';

/** Events that `localstripe.trigger()` can produce by running a fixture flow. */
export const TRIGGERABLE_EVENTS = [
  'customer.created',
  'payment_intent.created',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.requires_action',
  'payment_intent.processing',
  'payment_intent.canceled',
  'charge.succeeded',
  'charge.failed',
  'charge.refunded',
  'refund.created',
  'checkout.session.completed',
  'checkout.session.expired',
] as const;
export type TriggerableEvent = (typeof TRIGGERABLE_EVENTS)[number];

export interface LocalStripeConfigInfo {
  object: 'localstripe_config';
  version: string;
  public_api_url: string;
  strict_params: boolean;
  payments: {
    global_delay_ms: number;
    scenario_delays_ms: Record<string, number>;
    max_delay_ms: number;
    custom_catalog: boolean;
  };
  webhooks: { max_attempts: number; retry_base_delay_ms: number; timeout_ms: number };
  checkout: { session_ttl_minutes: number };
}

export interface CheckoutCompletion {
  object: 'checkout_completion';
  checkout_session: CheckoutSession;
  payment_intent: PaymentIntent;
}

export type CompleteCheckoutSessionParams = { card: CardParam } | { payment_method: string };

export interface TriggerResult {
  object: 'trigger_result';
  event: string;
  /** Ids of the objects created by the fixture flow. */
  objects: string[];
  /** Ids of the events emitted, oldest first. */
  events: string[];
}

export interface SeedResult {
  object: 'seed_result';
  customers: number;
  payment_intents: number;
}

export interface ResetResult {
  object: 'reset_result';
  reset: true;
}

export interface WebhookEndpointSecret {
  object: 'webhook_endpoint_secret';
  id: string;
  secret: string;
}

export interface WebhookDeliveryWithAttempts extends WebhookDelivery {
  attempt_history: WebhookDeliveryAttempt[];
}

export class WebhookDeliveries extends Resource {
  list(
    params: WebhookDeliveryListParams = {},
    options?: RequestOptions,
  ): Promise<List<WebhookDelivery>> {
    return this.get('/v1/localstripe/webhook_deliveries', params, options);
  }

  listAll(params: WebhookDeliveryListParams = {}, options?: RequestOptions) {
    return autoPaginate((page) => this.list(page, options), params);
  }

  retrieve(id: string, options?: RequestOptions): Promise<WebhookDeliveryWithAttempts> {
    return this.get(idPath('/v1/localstripe/webhook_deliveries/{id}', id), undefined, options);
  }

  retry(id: string, options?: RequestOptions): Promise<WebhookDelivery> {
    return this.post(idPath('/v1/localstripe/webhook_deliveries/{id}/retry', id), {}, options);
  }
}

export class ApiKeys extends Resource {
  list(options?: RequestOptions): Promise<List<ApiKey>> {
    return this.get('/v1/localstripe/api_keys', undefined, options);
  }

  /** The full key is returned in `secret` only in this response. */
  create(params: { type: ApiKeyType; name: string }, options?: RequestOptions): Promise<ApiKey> {
    return this.post('/v1/localstripe/api_keys', params, options);
  }

  revoke(id: string, options?: RequestOptions): Promise<ApiKey> {
    return this.post(idPath('/v1/localstripe/api_keys/{id}/revoke', id), {}, options);
  }
}

/** LocalStripe-only endpoints (`/v1/localstripe/*`) that have no Stripe equivalent. */
export class LocalStripeExtensions extends Resource {
  readonly webhookDeliveries: WebhookDeliveries;
  readonly apiKeys: ApiKeys;

  constructor(http: HttpClient) {
    super(http);
    this.webhookDeliveries = new WebhookDeliveries(http);
    this.apiKeys = new ApiKeys(http);
  }

  testCards(options?: RequestOptions): Promise<List<TestCard>> {
    return this.get('/v1/localstripe/test_cards', undefined, options);
  }

  stats(options?: RequestOptions): Promise<Stats> {
    return this.get('/v1/localstripe/stats', undefined, options);
  }

  config(options?: RequestOptions): Promise<LocalStripeConfigInfo> {
    return this.get('/v1/localstripe/config', undefined, options);
  }

  /** Completes the simulated 3D Secure challenge of a `requires_action` PaymentIntent. */
  authenticatePaymentIntent(
    id: string,
    outcome: 'succeed' | 'fail' = 'succeed',
    options?: RequestOptions,
  ): Promise<PaymentIntent> {
    return this.post(
      idPath('/v1/localstripe/payment_intents/{id}/authenticate', id),
      { outcome },
      options,
    );
  }

  /** Pays a Checkout Session without the hosted page. */
  completeCheckoutSession(
    id: string,
    params: CompleteCheckoutSessionParams,
    options?: RequestOptions,
  ): Promise<CheckoutCompletion> {
    return this.post(
      idPath('/v1/localstripe/checkout/sessions/{id}/complete', id),
      params,
      options,
    );
  }

  trigger(event: TriggerableEvent, options?: RequestOptions): Promise<TriggerResult> {
    return this.post('/v1/localstripe/trigger', { event }, options);
  }

  seed(options?: RequestOptions): Promise<SeedResult> {
    return this.post('/v1/localstripe/seed', {}, options);
  }

  /** Deletes all payment data. API keys and webhook endpoints are kept. */
  reset(options?: RequestOptions): Promise<ResetResult> {
    return this.post('/v1/localstripe/reset', { confirm: true }, options);
  }

  resendEvent(id: string, options?: RequestOptions): Promise<List<WebhookDelivery>> {
    return this.post(idPath('/v1/localstripe/events/{id}/resend', id), {}, options);
  }

  revealWebhookSecret(id: string, options?: RequestOptions): Promise<WebhookEndpointSecret> {
    return this.get(
      idPath('/v1/localstripe/webhook_endpoints/{id}/secret', id),
      undefined,
      options,
    );
  }
}
