import Stripe from 'stripe';
import { LocalStripe } from '@localstripe/sdk';
import type { LocalStripeEvent } from '@localstripe/contracts';

export const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:19901';
export const DASHBOARD_URL = process.env['E2E_DASHBOARD_URL'] ?? 'http://localhost:13902';
export const SINK_URL = process.env['E2E_SINK_URL'] ?? 'http://localhost:14242';
/** How the API container reaches the sink, inside the compose network. */
export const SINK_INTERNAL_URL = 'http://webhook-sink:4242';
export const SECRET_KEY =
  process.env['E2E_SECRET_KEY'] ?? 'sk_test_local_e2e_fixture_key_000000000000';

const api = new URL(API_URL);

/** The official Stripe SDK, pointed at LocalStripe. */
export const stripe = new Stripe(SECRET_KEY, {
  host: api.hostname,
  port: Number(api.port),
  protocol: api.protocol.replace(':', '') as 'http' | 'https',
  maxNetworkRetries: 0,
});

export const localstripe = new LocalStripe({ apiKey: SECRET_KEY, baseUrl: API_URL });

export const futureYear = () => new Date().getUTCFullYear() + 3;

export interface ApiResponse<T = Record<string, unknown>> {
  status: number;
  headers: Headers;
  body: T;
}

/** Raw HTTP access for things SDKs hide (headers, concurrency, hosted pages). */
export async function http<T = Record<string, unknown>>(
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string>; auth?: boolean } = {},
): Promise<ApiResponse<T>> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(options.auth !== false && { authorization: `Bearer ${SECRET_KEY}` }),
      ...(options.body !== undefined && { 'content-type': 'application/json' }),
      ...options.headers,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Non-JSON responses (hosted pages) are returned as text.
  }
  return { status: response.status, headers: response.headers, body: body as T };
}

export async function waitFor<T>(
  probe: () => Promise<T | undefined | null | false>,
  { timeoutMs = 15_000, intervalMs = 150, message = 'condition' } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${message}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export interface SinkDelivery {
  eventId: string | null;
  path: string;
  headers: Record<string, string>;
  body: string;
  respondedWith: number;
}

export const sink = {
  async received(eventId?: string): Promise<SinkDelivery[]> {
    const response = await fetch(`${SINK_URL}/received${eventId ? `?event=${eventId}` : ''}`);
    return (await response.json()) as SinkDelivery[];
  },
  async failNext(endpointName: string, count: number) {
    await fetch(`${SINK_URL}/fail-next?path=/webhooks/${endpointName}&count=${count}`, {
      method: 'POST',
    });
  },
  async clear() {
    await fetch(`${SINK_URL}/received`, { method: 'DELETE' });
  },
};

/** Registers a sink endpoint for this test file; the returned secret verifies signatures. */
export async function registerSinkEndpoint(name: string, events: string[] = ['*']) {
  const endpoint = await stripe.webhookEndpoints.create({
    url: `${SINK_INTERNAL_URL}/webhooks/${name}`,
    enabled_events: events as Stripe.WebhookEndpointCreateParams.EnabledEvent[],
  });
  return { id: endpoint.id, secret: endpoint.secret! };
}

export async function findEvent(objectId: string, type: string): Promise<LocalStripeEvent> {
  return waitFor(
    async () => {
      const events = await http<{ data: LocalStripeEvent[] }>(
        'GET',
        `/v1/events?object_id=${objectId}&limit=100`,
      );
      return events.body.data.find((event) => event.type === type);
    },
    { message: `${type} for ${objectId}` },
  );
}

export async function waitForDelivery(
  eventId: string,
  predicate: (d: SinkDelivery) => boolean = () => true,
) {
  return waitFor(async () => (await sink.received(eventId)).find(predicate), {
    message: `webhook delivery of ${eventId}`,
  });
}

export async function createCardPaymentMethod(number: string) {
  return stripe.paymentMethods.create({
    type: 'card',
    card: { number, exp_month: 12, exp_year: futureYear(), cvc: '123' },
  });
}
