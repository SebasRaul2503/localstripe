import { HttpClient, type RequestOptions } from './http-client.js';
import { Charges } from './resources/charges.js';
import { Checkout, CheckoutSessions } from './resources/checkout-sessions.js';
import { Customers } from './resources/customers.js';
import { Events } from './resources/events.js';
import { LocalStripeExtensions } from './resources/localstripe.js';
import { PaymentIntents } from './resources/payment-intents.js';
import { PaymentMethods } from './resources/payment-methods.js';
import { Refunds } from './resources/refunds.js';
import { WebhookEndpoints } from './resources/webhook-endpoints.js';
import { webhooks } from './webhooks.js';

export const SDK_VERSION = '0.1.0';
export const DEFAULT_BASE_URL = 'http://localhost:9001';

export interface LocalStripeConfig {
  /** A `sk_test_...` (or `pk_test_...`) key. Only `health()` works without one. */
  apiKey?: string;
  /** Defaults to `http://localhost:9001`. */
  baseUrl?: string;
  /** Per-request timeout. Defaults to 30 seconds. */
  timeoutMs?: number;
  /** Retries for network errors, 409, 429 and 5xx responses. Defaults to 0. */
  maxNetworkRetries?: number;
  /** Custom fetch implementation (tests, proxies). Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

export interface HealthStatus {
  status: string;
  service: string;
}

export class LocalStripe {
  static readonly webhooks = webhooks;
  readonly webhooks = webhooks;

  readonly customers: Customers;
  readonly paymentMethods: PaymentMethods;
  readonly paymentIntents: PaymentIntents;
  readonly charges: Charges;
  readonly refunds: Refunds;
  readonly checkout: Checkout;
  readonly events: Events;
  readonly webhookEndpoints: WebhookEndpoints;
  readonly localstripe: LocalStripeExtensions;

  private readonly http: HttpClient;

  constructor(config: LocalStripeConfig = {}) {
    const fetchImpl = config.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new Error('No fetch implementation found. Use Node.js 20+ or pass `fetch`.');
    }
    this.http = new HttpClient({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      timeoutMs: config.timeoutMs ?? 30_000,
      maxNetworkRetries: config.maxNetworkRetries ?? 0,
      fetch: fetchImpl,
      userAgent: `localstripe-sdk-node/${SDK_VERSION}`,
    });
    this.customers = new Customers(this.http);
    this.paymentMethods = new PaymentMethods(this.http);
    this.paymentIntents = new PaymentIntents(this.http);
    this.charges = new Charges(this.http);
    this.refunds = new Refunds(this.http);
    this.checkout = new Checkout(new CheckoutSessions(this.http));
    this.events = new Events(this.http);
    this.webhookEndpoints = new WebhookEndpoints(this.http);
    this.localstripe = new LocalStripeExtensions(this.http);
  }

  /** Liveness probe; does not require an API key. */
  health(options?: RequestOptions): Promise<HealthStatus> {
    return this.http.request({ method: 'GET', path: '/health', options, auth: false });
  }
}
