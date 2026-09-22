# @localstripe/sdk

Typed Node.js client for [LocalStripe](../../README.md), the local Stripe-like payment **mock**.
LocalStripe never processes real payments; this SDK only talks to your local instance.

- Stripe-shaped resources (`customers`, `paymentIntents`, `refunds`, `checkout.sessions`, ...) with
  types from `@localstripe/contracts`.
- LocalStripe extensions: test cards, stats, simulated 3D Secure, triggers, seed/reset, webhook
  deliveries, API keys.
- Idempotency keys, per-request artificial delay, retries with backoff, auto-pagination, typed
  errors and webhook signature verification.
- Zero runtime dependencies besides `@localstripe/contracts`; uses the global `fetch` (Node 20+).

> You can also keep using the official `stripe` package against LocalStripe; see
> [`examples/stripe-node`](../../examples/stripe-node). This SDK adds the LocalStripe-only endpoints
> and types.

## Install

Inside this monorepo it is the workspace package `@localstripe/sdk`
(`pnpm --filter @localstripe/sdk build`). From another local project:

```bash
npm install /path/to/localstripe/packages/sdk
```

## Usage

```ts
import { LocalStripe } from '@localstripe/sdk';

const localstripe = new LocalStripe({
  apiKey: process.env.LOCALSTRIPE_API_KEY, // sk_test_local_...
  baseUrl: 'http://localhost:9001', // default
  timeoutMs: 30_000, // default
  maxNetworkRetries: 2, // default 0
});

const customer = await localstripe.customers.create({ email: 'ada@example.test' });

const paymentIntent = await localstripe.paymentIntents.create(
  {
    amount: 1990, // minor units: 19.90 PEN
    currency: 'pen',
    customer: customer.id,
    payment_method: 'pm_card_visa',
    confirm: true,
  },
  { idempotencyKey: 'order-1001', delayMs: 0 },
);

await localstripe.refunds.create({ payment_intent: paymentIntent.id, amount: 500 });
```

Every method takes an optional last argument, `RequestOptions`:

| Option           | Effect                                                                   |
| ---------------- | ------------------------------------------------------------------------ |
| `idempotencyKey` | `Idempotency-Key` header. Replays return the first response.             |
| `delayMs`        | `LocalStripe-Delay-Ms` header: overrides the simulated processing delay. |
| `signal`         | An `AbortSignal` to cancel the request.                                  |
| `timeoutMs`      | Overrides the client timeout for this request.                           |

### Resources

| Resource                        | Methods                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `customers`                     | `create`, `retrieve`, `update`, `del`, `list`, `listAll`, `listPaymentMethods` |
| `paymentMethods`                | `create`, `retrieve`, `update`, `list`, `listAll`, `attach`, `detach`          |
| `paymentIntents`                | `create`, `retrieve`, `update`, `confirm`, `cancel`, `list`, `listAll`         |
| `charges`                       | `retrieve`, `list`, `listAll`                                                  |
| `refunds`                       | `create`, `retrieve`, `update`, `list`, `listAll`                              |
| `checkout.sessions`             | `create`, `retrieve`, `list`, `listAll`, `listLineItems`, `expire`             |
| `events`                        | `retrieve`, `list`, `listAll`                                                  |
| `webhookEndpoints`              | `create`, `retrieve`, `update`, `del`, `list`, `listAll`                       |
| `localstripe`                   | LocalStripe extensions, see below                                              |
| `localstripe.webhookDeliveries` | `list`, `listAll`, `retrieve` (with attempt history), `retry`                  |
| `localstripe.apiKeys`           | `list`, `create`, `revoke`                                                     |
| (client)                        | `health()` (no API key needed)                                                 |

LocalStripe extensions (`localstripe.localstripe.*`, no Stripe equivalent): `testCards()`,
`stats()`, `config()`, `authenticatePaymentIntent(id, 'succeed' | 'fail')` (simulated 3D Secure),
`completeCheckoutSession(id, { card } | { payment_method })`, `trigger(event)`, `seed()`, `reset()`,
`resendEvent(id)`, `revealWebhookSecret(id)`.

### Pagination

`list()` returns one page (`{ object: 'list', data, has_more, url }`). `listAll()` returns an async
iterator that follows `starting_after` (or walks backwards from `ending_before`):

```ts
for await (const paymentIntent of localstripe.paymentIntents.listAll({ status: 'succeeded' })) {
  console.log(paymentIntent.id);
}
```

`autoPaginate(fetchPage, params)` is exported for custom page functions. Filters are encoded like
Stripe's, e.g. `events.list({ created: { gte: 1790000000 }, types: ['charge.succeeded'] })` sends
`created[gte]=1790000000&types[0]=charge.succeeded`.

## Errors

API errors are thrown as subclasses of `LocalStripeError`:

| Class                 | When                                                                |
| --------------------- | ------------------------------------------------------------------- |
| `CardError`           | HTTP 402, `card_error`: the (test) card was declined.               |
| `InvalidRequestError` | 400, 404, 409, 413: bad parameters, missing resource...             |
| `AuthenticationError` | 401: missing or invalid API key.                                    |
| `PermissionError`     | 403: e.g. a publishable key on a secret-only endpoint.              |
| `IdempotencyError`    | `idempotency_error`: key reused with other params / in use.         |
| `RateLimitError`      | 429.                                                                |
| `APIError`            | 5xx or unexpected responses.                                        |
| `ConnectionError`     | No response: network failure, timeout (`code: 'timeout'`) or abort. |

Each error has `type`, `code`, `param`, `declineCode`, `statusCode`, `requestId`, `headers`, `raw`
and, for declines, `paymentIntent` (the updated PaymentIntent):

```ts
import { CardError } from '@localstripe/sdk';

try {
  await localstripe.paymentIntents.create({
    amount: 4200,
    currency: 'usd',
    payment_method: 'pm_card_chargeDeclinedInsufficientFunds',
    confirm: true,
  });
} catch (error) {
  if (error instanceof CardError) {
    console.log(error.declineCode, error.paymentIntent?.status); // insufficient_funds requires_payment_method
  } else throw error;
}
```

### Retries

With `maxNetworkRetries > 0`, network errors, `409`, `429` and `5xx` responses are retried with
exponential backoff and jitter (500 ms doubling, capped at 5 s; `Retry-After` is honoured). POST
requests without an `idempotencyKey` get a generated one (`crypto.randomUUID()`) that is reused for
every attempt, so a retry can never create a second payment.

## Webhooks

LocalStripe signs deliveries like Stripe (`t=<unix>,v1=<hex HMAC-SHA256>` over
`<timestamp>.<raw body>`) and sends the header as both `LocalStripe-Signature` and
`Stripe-Signature`.

```ts
import { LocalStripe, WebhookSignatureVerificationError } from '@localstripe/sdk';

// `rawBody` must be the exact bytes received (string or Buffer), not re-serialized JSON.
try {
  const event = LocalStripe.webhooks.constructEvent(
    rawBody,
    request.headers['localstripe-signature'],
    process.env.LOCALSTRIPE_WEBHOOK_SECRET!, // whsec_...
    300, // tolerance in seconds (default 300; 0 disables the timestamp check)
  );
  console.log(event.type);
} catch (error) {
  if (error instanceof WebhookSignatureVerificationError) {
    // error.reason: missing_header | malformed_header | no_matching_signature |
    //               timestamp_outside_tolerance | invalid_payload
  }
  throw error;
}
```

To test your handler, sign a payload yourself:

```ts
const payload = JSON.stringify(fakeEvent);
const header = LocalStripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test' });
```

`localstripe.webhooks` (on instances) is the same object. A complete receiver lives in
[`examples/webhook-receiver`](../../examples/webhook-receiver).
