# LocalStripe

**A local Stripe-like payment mock/emulator for development and automated testing.**

[![CI](https://github.com/SebasRaul2503/localstripe/actions/workflows/ci.yml/badge.svg)](https://github.com/SebasRaul2503/localstripe/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> [!WARNING]
> **This project does not process real payments.** LocalStripe is only a mock/emulator for
> development and testing. It does not move money, does not connect to banks, card networks or
> Stripe, only accepts its own [test cards](#test-cards), and must never be used in production to
> process real payments.

LocalStripe gives you a Stripe-shaped HTTP API on `localhost` — customers, payment methods, payment
intents, Checkout Sessions, refunds, events and signed webhooks — so you can build and test payment
integrations offline, in CI, and in demos, with deterministic outcomes you control. The **official
Stripe SDKs work against it** by changing the host.

```bash
git clone https://github.com/SebasRaul2503/localstripe.git
cd localstripe
docker compose up -d
```

```text
Dashboard → http://localhost:3002
API       → http://localhost:9001      (reference: http://localhost:9001/docs)
```

---

- [Features](#features)
- [Quick Start](#quick-start)
- [Docker Compose](#docker-compose)
- [Architecture](#architecture)
- [API](#api)
- [Authentication](#authentication)
- [Test cards](#test-cards)
- [Payment lifecycle](#payment-lifecycle)
- [Artificial delays](#artificial-delays)
- [Webhooks](#webhooks)
- [Idempotency](#idempotency)
- [Refunds](#refunds)
- [Checkout Sessions](#checkout-sessions)
- [Dashboard](#dashboard)
- [SDK](#sdk)
- [CLI](#cli)
- [Stripe compatibility](#stripe-compatibility)
- [Limitations](#limitations)
- [Security considerations](#security-considerations)
- [Development](#development)
- [Testing](#testing)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Stripe-compatible `/v1` API** — same paths, form-encoded bodies, error envelope, pagination and
  object shapes for Customers, PaymentMethods, PaymentIntents, Charges, Refunds, Checkout Sessions,
  Events and Webhook Endpoints. Use `stripe-node` (or other Stripe SDKs) by pointing them at LocalStripe.
- **Deterministic test cards** — each card number triggers one outcome: success, decline (with the
  decline code you need), 3D Secure, or asynchronous processing. Every other card number is rejected.
- **Real payment lifecycle** — from `requires_payment_method` to `succeeded` or `canceled`, enforced
  by a state machine. Declines, 3DS challenges and async settlement behave like Stripe's.
- **Artificial delays** — globally, per scenario, per card, or per request, without blocking the server.
- **Webhooks** — Stripe-compatible signatures (`stripe.webhooks.constructEvent` works), retries with
  backoff, full attempt history, manual retry and resend.
- **Idempotency** — `Idempotency-Key` with Stripe semantics, correct under concurrency.
- **Refunds** — full, partial and multiple; never more than was paid, even under concurrent requests.
- **Checkout Sessions** — with a hosted test checkout page.
- **Dashboard** — payments, customers, refunds, events, webhook deliveries (with Retry), API keys,
  test cards; create test payments and demo data from the UI.
- **TypeScript SDK**, **CLI** (`localstripe listen`, `localstripe trigger`, ...), **OpenAPI 3.1** docs,
  **Prometheus metrics**, structured logs, health checks.
- **Persistent** (PostgreSQL) and **zero-setup**: `docker compose up -d`.

## Quick Start

Requirements: Docker with Compose v2. Nothing else — no Node, no database, no manual migrations.

```bash
git clone https://github.com/SebasRaul2503/localstripe.git
cd localstripe
docker compose up -d
```

The first start builds the images (a few minutes). Then:

1. Open the dashboard at **http://localhost:3002** — click **Load demo data** or **Create test payment**.
2. Get your secret key. LocalStripe generates a key pair on first start and prints it:

   ```bash
   docker compose logs api | grep "Secret key"
   # Secret key:      sk_test_local_4tq...
   ```

   Prefer a fixed key? Set `LOCALSTRIPE_SECRET_KEY=sk_test_<anything, 16+ chars>` in a `.env` file
   (see [`.env.example`](.env.example)) and run `docker compose up -d` again.

3. Make your first payment:

   ```bash
   export SK=sk_test_local_...   # your key

   curl http://localhost:9001/v1/payment_intents -u "$SK:" \
     -d amount=1990 -d currency=pen -d payment_method=pm_card_visa -d confirm=true
   ```

   ```json
   {
     "id": "pi_local_01K...",
     "object": "payment_intent",
     "amount": 1990,
     "currency": "pen",
     "status": "succeeded",
     "latest_charge": "ch_local_01K...",
     "livemode": false,
     "...": "..."
   }
   ```

4. Or use the official Stripe SDK in your app:

   ```ts
   import Stripe from 'stripe';

   const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
     host: 'localhost',
     port: 9001,
     protocol: 'http',
   });

   const paymentIntent = await stripe.paymentIntents.create({
     amount: 1990,
     currency: 'pen',
     payment_method: 'pm_card_visa',
     confirm: true,
   });
   ```

More runnable examples live in [`examples/`](examples).

## Docker Compose

`docker compose up -d` starts four services:

| Service     | What it does                                                                       |
| ----------- | ---------------------------------------------------------------------------------- |
| `postgres`  | PostgreSQL 16 with a persistent volume (`postgres-data`). Not exposed on the host. |
| `migrate`   | One-shot container that applies the versioned SQL migrations, then exits.          |
| `api`       | The LocalStripe API and background worker on port **9001**.                        |
| `dashboard` | The dashboard and its backend on port **3002**.                                    |

Services have health checks, restart policies and dependency conditions (`api` starts after
migrations succeed; `dashboard` after `api` is healthy). Data survives `docker compose down` /
`up` and restarts; `docker compose down -v` wipes it.

Configuration is done with environment variables, all optional. Copy [`.env.example`](.env.example)
to `.env` to change them. The most useful ones:

| Variable                                                 | Default           | Description                                                                      |
| -------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------- |
| `API_PORT` / `DASHBOARD_PORT`                            | `9001` / `3002`   | Host ports.                                                                      |
| `LOCALSTRIPE_BIND_ADDRESS`                               | `127.0.0.1`       | Host interface the ports bind to. `0.0.0.0` exposes LocalStripe to your network. |
| `LOCALSTRIPE_SECRET_KEY` / `LOCALSTRIPE_PUBLISHABLE_KEY` | generated         | Pin your API keys.                                                               |
| `PAYMENT_PROCESSING_DELAY_MS`                            | `0`               | Global artificial delay.                                                         |
| `PAYMENT_SCENARIO_DELAYS`                                | `processing=5000` | Per-scenario delays.                                                             |
| `WEBHOOK_MAX_ATTEMPTS` / `WEBHOOK_RETRY_BASE_DELAY_MS`   | `5` / `10000`     | Webhook retry policy.                                                            |
| `STRICT_PARAMS`                                          | `true`            | Reject unknown parameters, like Stripe.                                          |
| `SEED_DEMO_DATA`                                         | `false`           | Create labelled demo data on first start.                                        |
| `CORS_ORIGINS`                                           | dashboard URL     | Origins allowed to call the API from a browser.                                  |

Useful commands:

```bash
docker compose ps                          # status and health
docker compose logs -f api                 # structured JSON logs
docker compose exec api localstripe payments list   # CLI, preconfigured inside the container
docker compose down                        # stop (data is kept)
docker compose down -v                     # stop and delete all data
```

## Architecture

LocalStripe is a **TypeScript modular monolith** (Fastify, Zod, Kysely) on **PostgreSQL**, with a
Postgres-backed job queue for the worker (no Redis), a React dashboard behind a small
backend-for-frontend, and shared contracts between API, SDK, CLI and dashboard.

```text
 browser ──▶ dashboard :3002 (React SPA + BFF) ──internal key──▶ api :9001 ──▶ PostgreSQL
 your app / Stripe SDK / CLI ─────────────────────────────────▶ api :9001
                                                   worker ──signed webhooks──▶ your endpoints
```

```text
apps/api          HTTP API, worker, hosted checkout/3DS pages, migrations
apps/dashboard    React dashboard (src/) + backend-for-frontend (server/)
apps/cli          `localstripe` CLI
packages/contracts  shared schemas, types, enums, webhook signature scheme
packages/sdk      @localstripe/sdk
tests/e2e         end-to-end tests against the docker compose stack
docs/             architecture, compatibility, errors, webhooks
```

Read [docs/architecture.md](docs/architecture.md) for the design decisions, module boundaries, the
confirmation flow, the transactional outbox for events, and how to add resources such as
subscriptions or invoices.

## API

- Base URL: `http://localhost:9001/v1`
- Interactive reference: **http://localhost:9001/docs** — OpenAPI 3.1 document: `/openapi.json`
- Health: `GET /health` (liveness), `GET /ready` (database + worker). Metrics: `GET /metrics` (Prometheus).
- Bodies: `application/x-www-form-urlencoded` (what Stripe SDKs send, with bracket notation such as
  `metadata[order_id]=42`) or `application/json`.
- Amounts are integers in the currency's minor unit (`1990` = S/ 19.90).
- IDs look like `pi_local_01K...` — the `_local_` marker makes them impossible to confuse with real Stripe IDs.

| Resource               | Endpoints                                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customers              | `POST /v1/customers` · `GET /v1/customers/:id` · `POST /v1/customers/:id` · `DELETE /v1/customers/:id` · `GET /v1/customers` · `GET /v1/customers/:id/payment_methods`     |
| Payment methods        | `POST /v1/payment_methods` · `GET /v1/payment_methods/:id` · `POST /v1/payment_methods/:id` · `GET /v1/payment_methods` · `POST .../attach` · `POST .../detach`            |
| Payment intents        | `POST /v1/payment_intents` · `GET /v1/payment_intents/:id` · `POST /v1/payment_intents/:id` · `POST .../confirm` · `POST .../cancel` · `GET /v1/payment_intents`           |
| Charges                | `GET /v1/charges/:id` · `GET /v1/charges`                                                                                                                                  |
| Refunds                | `POST /v1/refunds` · `GET /v1/refunds/:id` · `POST /v1/refunds/:id` · `GET /v1/refunds`                                                                                    |
| Checkout               | `POST /v1/checkout/sessions` · `GET /v1/checkout/sessions/:id` · `GET /v1/checkout/sessions` · `GET .../line_items` · `POST .../expire`                                    |
| Events                 | `GET /v1/events/:id` · `GET /v1/events`                                                                                                                                    |
| Webhook endpoints      | `POST /v1/webhook_endpoints` · `GET/POST/DELETE /v1/webhook_endpoints/:id` · `GET /v1/webhook_endpoints`                                                                   |
| LocalStripe extensions | `/v1/localstripe/*`: test cards, stats, config, API keys, 3DS completion, checkout completion, `trigger`, `seed`, `reset`, webhook deliveries (list / retry), event resend |

Errors follow Stripe's envelope and types (`card_error` → HTTP 402, `invalid_request_error`,
`authentication_error`, `idempotency_error`, `rate_limit_error`, `api_error`):

```json
{
  "error": {
    "type": "card_error",
    "code": "card_declined",
    "decline_code": "generic_decline",
    "message": "Your card was declined. (Simulated by LocalStripe; no real payment was attempted.)",
    "payment_intent": { "id": "pi_local_01K...", "status": "requires_payment_method" }
  }
}
```

The complete taxonomy is in [docs/errors.md](docs/errors.md).

## Authentication

Every `/v1` request needs an API key, as a Bearer token or as the Basic-auth username:

```bash
curl http://localhost:9001/v1/customers -H "Authorization: Bearer sk_test_local_..."
curl http://localhost:9001/v1/customers -u sk_test_local_...:
```

| Key         | Prefix        | Use                                                                                                                                              |
| ----------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Secret      | `sk_test_...` | Server-side. Full access.                                                                                                                        |
| Publishable | `pk_test_...` | Client-side. Only: create payment methods, retrieve/confirm a PaymentIntent with its `client_secret`, list test cards, complete a 3DS challenge. |

- On first start LocalStripe generates a secret/publishable pair and prints it in the API logs
  (`docker compose logs api | grep "Secret key"`). Nothing is hardcoded.
- `LOCALSTRIPE_SECRET_KEY` / `LOCALSTRIPE_PUBLISHABLE_KEY` pin your own keys (handy for `.env` files
  and CI).
- Create and revoke additional keys in the dashboard (**API keys**) or with
  `POST /v1/localstripe/api_keys`. Secret keys are stored hashed and shown only once.
- The dashboard uses its own internal key, server-side; secret keys are never sent to the browser.

## Test cards

LocalStripe **only accepts the card numbers below** (use any future expiry date and any 3-digit CVC,
4 digits for Amex). Any other number is rejected with `incorrect_number`. Card numbers and CVCs are
validated and immediately discarded — only the brand, last 4 digits and expiry are stored.

Stripe-familiar numbers (so existing test suites keep working):

| Number                | Brand        | Outcome                 | Error / decline code                   | Token                                     |
| --------------------- | ------------ | ----------------------- | -------------------------------------- | ----------------------------------------- |
| `4242 4242 4242 4242` | Visa         | ✅ Succeeds             |                                        | `pm_card_visa`                            |
| `4000 0566 5566 5556` | Visa (debit) | ✅ Succeeds             |                                        | `pm_card_visa_debit`                      |
| `5555 5555 5555 4444` | Mastercard   | ✅ Succeeds             |                                        | `pm_card_mastercard`                      |
| `3782 822463 10005`   | Amex         | ✅ Succeeds             |                                        | `pm_card_amex`                            |
| `4000 0000 0000 0002` | Visa         | ❌ Declined             | `card_declined` / `generic_decline`    | `pm_card_chargeDeclined`                  |
| `4000 0000 0000 9995` | Visa         | ❌ Declined             | `card_declined` / `insufficient_funds` | `pm_card_chargeDeclinedInsufficientFunds` |
| `4000 0000 0000 0069` | Visa         | ❌ Declined             | `expired_card`                         | `pm_card_chargeDeclinedExpiredCard`       |
| `4000 0000 0000 0127` | Visa         | ❌ Declined             | `incorrect_cvc`                        | `pm_card_chargeDeclinedIncorrectCvc`      |
| `4000 0000 0000 0119` | Visa         | ❌ Declined             | `processing_error`                     | `pm_card_chargeDeclinedProcessingError`   |
| `4000 0025 0000 3155` | Visa         | 🔐 Requires 3D Secure   |                                        | `pm_card_authenticationRequired`          |
| `4000 0000 0000 3220` | Visa         | 🔐 Requires 3D Secure 2 |                                        | `pm_card_threeDSecure2Required`           |

LocalStripe-only series (never valid as real card numbers — they deliberately fail the Luhn check):

| Number                | Outcome                                                   |
| --------------------- | --------------------------------------------------------- |
| `4242 4242 4242 0001` | ✅ Succeeds                                               |
| `4242 4242 4242 0002` | ❌ Declined (`generic_decline`)                           |
| `4242 4242 4242 0003` | 🔐 Requires 3D Secure                                     |
| `4242 4242 4242 0004` | ⏳ `processing`, then succeeds after the processing delay |
| `4242 4242 4242 0005` | ❌ Declined (`insufficient_funds`)                        |
| `4242 4242 4242 0006` | ❌ Declined (`expired_card`)                              |
| `4242 4242 4242 0007` | ⏳ `processing`, then fails after the processing delay    |

The behavior of Stripe-familiar numbers is **LocalStripe's own definition**; it mirrors Stripe's
documented test cards but may differ in details. The catalog is also available at
`GET /v1/localstripe/test_cards`, in the dashboard, and via `localstripe test-cards`.

**Custom catalog.** Mount a JSON file and set `TEST_CARD_CATALOG_PATH` to extend (or replace) the
catalog, e.g. to add a card with its own delay:

```json
{
  "mode": "extend",
  "cards": [
    {
      "id": "slow_visa",
      "number": "4242424242429999",
      "brand": "visa",
      "label": "Slow Visa",
      "scenario": "succeeded",
      "delay_ms": 3000
    }
  ]
}
```

Scenarios: `succeeded`, `declined` (requires `error_code`, optional `decline_code`),
`requires_action`, `processing` (requires `settles_to`: `succeeded` | `declined`).

## Payment lifecycle

```text
                       create (no payment_method)
                                 │
                                 ▼
 ┌──────────────────▶ requires_payment_method ◀──────────────┐
 │                               │ attach payment_method      │ decline / failed 3DS /
 │                               ▼                            │ async failure
 │                     requires_confirmation                  │
 │                               │ confirm                    │
 │           ┌───────────────────┼───────────────────┐        │
 │           ▼                   ▼                   ▼        │
 │    requires_action        processing ────────▶ succeeded   │
 │   (3DS challenge) ─────────────┴──────────────────▲────────┘
 │           │ authenticate ✓                        │
 │           └───────────────────────────────────────┘
 │
 └── cancel (from requires_payment_method, requires_confirmation, requires_action) ──▶ canceled
```

Each confirmation runs: **create → confirm → payment method evaluation (test card) → state transition
→ event generation → webhook delivery**. Transitions are validated by an explicit state machine;
anything else is rejected with `payment_intent_unexpected_state`.

- **Succeeded** — a charge is created, `amount_received` and `latest_charge` are set.
  Events: `charge.succeeded`, `payment_intent.succeeded`.
- **Declined** — HTTP 402 `card_error` containing the PaymentIntent, which returns to
  `requires_payment_method` with `last_payment_error`. Events: `charge.failed`,
  `payment_intent.payment_failed`. Confirm again with another card.
- **Requires action (3DS)** — `next_action.redirect_to_url.url` points to a LocalStripe page where
  you complete or fail the simulated challenge; you're then redirected to your `return_url` with
  `payment_intent`, `payment_intent_client_secret` and `redirect_status`. In tests, call
  `POST /v1/localstripe/payment_intents/:id/authenticate` with `outcome=succeed|fail`.
  Event: `payment_intent.requires_action`.
- **Processing** — `payment_intent.processing` now; the worker settles it after the processing delay
  (`payment_intent.succeeded` or `payment_intent.payment_failed`).
- **Canceled** — `payment_intent.canceled`.

## Artificial delays

Simulate slow payment processing to test timeouts, spinners and race conditions. Delays are async
timers: they never block the server, other requests, database connections or row locks.

| Level        | How                            | Example                                                           |
| ------------ | ------------------------------ | ----------------------------------------------------------------- |
| Global       | `PAYMENT_PROCESSING_DELAY_MS`  | `1500`                                                            |
| Per scenario | `PAYMENT_SCENARIO_DELAYS`      | `succeeded=500,declined=300,requires_action=1000,processing=5000` |
| Per card     | `delay_ms` in a custom catalog | `"delay_ms": 3000`                                                |
| Per request  | `LocalStripe-Delay-Ms` header  | `-H "LocalStripe-Delay-Ms: 2000"`                                 |

Precedence: request header > card > scenario > global. Every delay is capped by `MAX_DELAY_MS`
(default 60 s).

Semantics: for `succeeded`, `declined` and `requires_action`, the delay is how long the
confirmation request takes to respond. For `processing`, confirmation responds immediately with
`status: processing` and the delay is how long the payment stays in `processing` before the worker
settles it (default 5 s).

## Webhooks

Register an endpoint (from the dashboard, a Stripe SDK, or curl):

```bash
curl http://localhost:9001/v1/webhook_endpoints -u "$SK:" \
  -d url=http://host.docker.internal:3000/webhooks \
  -d "enabled_events[]=*"
# → { "id": "we_local_...", "secret": "whsec_...", ... }   (the secret is shown once)
```

> From inside Docker, `localhost` is the container. Use `http://host.docker.internal:<port>` to reach
> an app on your machine. Or use `localstripe listen --forward-to http://localhost:3000/webhooks`.

Events delivered: `payment_intent.created`, `payment_intent.processing`,
`payment_intent.requires_action`, `payment_intent.succeeded`, `payment_intent.payment_failed`,
`payment_intent.canceled`, `charge.succeeded`, `charge.failed`, `charge.refunded`, `refund.created`,
`checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `checkout.session.expired`, `customer.created|updated|deleted`,
`payment_method.attached|detached`.

- **Flow**: event → one delivery per subscribed endpoint (written atomically with the event) →
  attempt(s) → `succeeded` / `failed`. Any 2xx counts as success.
- **Signatures**: HMAC-SHA256, Stripe's scheme, sent as both `Stripe-Signature` and
  `LocalStripe-Signature` (`t=<timestamp>,v1=<hex>`). Verify with
  `LocalStripe.webhooks.constructEvent(rawBody, header, secret)` or, unchanged,
  `stripe.webhooks.constructEvent(...)`.
- **Retries**: exponential backoff (`10s, 30s, 90s, 270s` by default), up to `WEBHOOK_MAX_ATTEMPTS`.
  Every attempt's status, duration and response body (2 KB) is recorded.
- **Manual retry**: dashboard (Webhooks → Retry, Events → Resend),
  `POST /v1/localstripe/webhook_deliveries/:id/retry`, `POST /v1/localstripe/events/:id/resend`,
  or `localstripe webhooks retry <event-id>`.
- **Trigger events on demand**: `localstripe trigger payment_intent.succeeded` or
  `POST /v1/localstripe/trigger`.

Full details: [docs/webhooks.md](docs/webhooks.md).

## Idempotency

Send `Idempotency-Key: <unique key>` on any `POST`:

| Situation                                         | Result                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| First request                                     | Executed; the response (including 4xx such as declines) is stored for 24 h.           |
| Retry: same key, same parameters                  | The stored response is returned with `Idempotent-Replayed: true`. Nothing runs twice. |
| Same key, different parameters                    | `400 idempotency_error` (`idempotency_key_reused`).                                   |
| Same key while the first request is still running | `409 idempotency_error` (`idempotency_key_in_use`) — retry later.                     |
| Request rejected by validation                    | Not stored; the key can be reused.                                                    |
| 5xx response                                      | Not stored; retry safely with the same key.                                           |

Keys are scoped per API key. Concurrency safety comes from a database unique constraint, so exactly
one of N simultaneous identical requests executes.

## Refunds

```bash
curl http://localhost:9001/v1/refunds -u "$SK:" -d payment_intent=pi_local_... -d amount=3000
```

- Refund a succeeded PaymentIntent (or a `charge`) fully (omit `amount`) or partially, as many times
  as you want until nothing is left: a S/ 100.00 payment refunded S/ 30.00 has S/ 70.00 refundable.
- Refunding more than what remains fails with `amount_too_large`; a fully refunded charge fails with
  `charge_already_refunded`; non-succeeded payments cannot be refunded.
- The charge row is locked during a refund and a database constraint enforces
  `amount_refunded ≤ amount`, so concurrent refunds are always correct.
- Events: `refund.created`, `charge.refunded` (with the updated `amount_refunded` / `refunded`).

## Checkout Sessions

```ts
const session = await stripe.checkout.sessions.create({
  mode: 'payment',
  success_url: 'http://localhost:3000/success?session_id={CHECKOUT_SESSION_ID}',
  cancel_url: 'http://localhost:3000/cancel',
  line_items: [
    {
      price_data: { currency: 'usd', unit_amount: 1500, product_data: { name: 'T-shirt' } },
      quantity: 2,
    },
  ],
});
// Redirect the user to session.url → LocalStripe's hosted test checkout page.
```

The hosted page lets you pick any test card (declines, 3DS and processing included) and redirects to
`success_url` once paid. Events: `checkout.session.completed` (plus `async_payment_succeeded` /
`async_payment_failed` for processing cards, and `checkout.session.expired`). Automated tests can pay
a session without a browser: `POST /v1/localstripe/checkout/sessions/:id/complete`.

## Dashboard

**http://localhost:3002**

| Page              | What you can do                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview          | Totals (payments, succeeded, failed, processing, refunds, customers), volume per currency, webhook health, recent events and payments.        |
| Payments          | Filter by status/customer, open a payment: timeline of events, charge, refunds, errors, 3DS actions; refund, cancel; **Create test payment**. |
| Customers         | Search, create, inspect payment methods and payments, delete.                                                                                 |
| Payment methods   | Brand, last 4, expiry, owner — card numbers are never stored.                                                                                 |
| Refunds           | List and detail.                                                                                                                              |
| Checkout sessions | Create, open the hosted page, expire, inspect line items.                                                                                     |
| Events            | Filter by type, inspect payloads, see deliveries, resend.                                                                                     |
| Webhooks          | Manage endpoints and secrets; deliveries with status, attempts, last attempt and **Retry**.                                                   |
| API keys          | List, create (shown once), revoke.                                                                                                            |
| Test cards        | The catalog, with copy buttons.                                                                                                               |
| Settings          | Effective configuration, load demo data, reset data.                                                                                          |

The dashboard is served by a small backend-for-frontend that proxies `/api/v1/*` to the API with an
internal key it reads from a shared Docker volume. The browser never sees a secret key.

## SDK

A TypeScript SDK with typed resources lives in [`packages/sdk`](packages/sdk):

```ts
import { LocalStripe } from '@localstripe/sdk';

const localstripe = new LocalStripe({
  apiKey: 'sk_test_local_...',
  baseUrl: 'http://localhost:9001',
});

const customer = await localstripe.customers.create({ email: 'ada@example.com' });
const paymentIntent = await localstripe.paymentIntents.create(
  {
    amount: 1990,
    currency: 'pen',
    customer: customer.id,
    payment_method: 'pm_card_visa',
    confirm: true,
  },
  { idempotencyKey: 'order-1001' },
);

// Webhooks
const event = LocalStripe.webhooks.constructEvent(rawBody, signatureHeader, 'whsec_...');
```

Typed errors (`CardError`, `InvalidRequestError`, `IdempotencyError`, ...), auto-pagination,
retries with automatic idempotency keys, per-request delays and the LocalStripe extensions
(`localstripe.localstripe.trigger(...)`, `testCards()`, ...) are included. See the
[SDK README](packages/sdk/README.md).

You don't need this SDK to use LocalStripe: the official Stripe SDKs work too (see
[Stripe compatibility](#stripe-compatibility)).

## CLI

The `localstripe` CLI is preinstalled in the API container and configures itself:

```bash
docker compose exec api localstripe health
docker compose exec api localstripe payments list --status succeeded
docker compose exec api localstripe payments retrieve pi_local_...
docker compose exec api localstripe customers list
docker compose exec api localstripe events list --type payment_intent.succeeded
docker compose exec api localstripe webhooks list
docker compose exec api localstripe webhooks retry evt_local_...
docker compose exec api localstripe trigger payment_intent.succeeded
docker compose exec api localstripe test-cards
```

From the repository (Node ≥ 20.19), it can also forward events to an app on your machine, like `stripe listen`:

```bash
pnpm install && pnpm build
node apps/cli/dist/main.js --api-key sk_test_local_... listen --forward-to http://localhost:3000/webhooks
```

## Stripe compatibility

LocalStripe implements the parts of Stripe that most integrations use, with the same wire protocol.
The official `stripe` Node SDK is exercised against it in CI (customers, payment methods, payment
intents incl. declines and 3DS, refunds, Checkout Sessions, webhook endpoints, idempotency and
`webhooks.constructEvent`).

|                         |                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Supported**           | Customers, Refunds, Events, Webhook endpoints & signatures, Idempotency-Key, pagination, error envelope, form-encoded bodies, `pm_card_*` test tokens             |
| **Partially supported** | Payment Intents (no manual capture), Payment Methods (cards only), Charges (read-only), Checkout Sessions (`mode=payment`, inline `price_data`), publishable keys |
| **Not supported**       | Products/Prices, Subscriptions, Invoices, Connect, Disputes, Payouts, Balance, Setup Intents, Stripe.js/Elements, `expand[]`, search endpoints, API versioning    |

The full, honest matrix: [docs/stripe-compatibility.md](docs/stripe-compatibility.md).

## Limitations

- **Not a payment processor.** No money, banks, card networks, acquirers, payouts, balances, KYC,
  PCI compliance, Apple Pay / Google Pay, or connection to Stripe. By design.
- Single account, test mode only (`livemode: false`). No Connect.
- Only card payment methods, only automatic capture, only `mode=payment` Checkout.
- `expand[]` is ignored; related objects are returned as IDs. `Stripe-Version` is ignored.
- Refunds succeed instantly; there are no disputes, and no balance transactions.
- Stripe.js / Elements are not emulated: collect test card numbers server-side or through
  `POST /v1/payment_methods` with a publishable key, and follow `next_action.redirect_to_url` for 3DS.
- Events are kept forever and never expire (Stripe keeps them 30 days).

## Security considerations

**LocalStripe is NOT suitable for production and must not be exposed to the internet.** It is a
development tool. Even so, it follows good practices so it is safe to run on your machine and in CI:

- **No card data is stored or logged.** Only catalog card numbers are accepted; the number and CVC
  are validated and discarded (only brand, last4 and expiry are kept). Log redaction also covers
  card fields and `Authorization` headers.
- **Authentication** on every `/v1` route; secret keys are stored as SHA-256 hashes and generated
  randomly — there is no universal hardcoded key. Publishable keys are limited to client-safe endpoints.
- **Secret keys never reach the browser**: the dashboard's server injects its own internal key.
- **Signed webhooks** (HMAC-SHA256 with timestamp against replays), one secret per endpoint.
- **Input validation** of every parameter with Zod (unknown parameters rejected), body size limits,
  protection against malformed JSON/form bodies and prototype pollution.
- **Rate limiting** per key/IP, configurable **CORS**, **security headers** (Helmet; strict CSP on
  HTML pages; no inline scripts), escaped output on hosted pages.
- **Errors never include stack traces**; internal messages are hidden when `NODE_ENV=production`.
- **Ports bind to `127.0.0.1`** by default; Postgres is not exposed at all. Containers run as a
  non-root user.
- No secrets in the repository; configuration comes from environment variables.

Report vulnerabilities privately — see [SECURITY.md](SECURITY.md).

## Development

Requirements: Node.js ≥ 20.19 (22 recommended), pnpm 10 (`corepack enable`), Docker.

```bash
pnpm install
pnpm build:packages        # shared packages (contracts, sdk)
pnpm db:test:up            # disposable Postgres on :55432
```

Run the API with hot reload, then the dashboard (see [CONTRIBUTING.md](CONTRIBUTING.md) for the
exact commands). Useful scripts:

| Command                                           |                                                |
| ------------------------------------------------- | ---------------------------------------------- |
| `pnpm build`                                      | Build every package and app                    |
| `pnpm lint` / `pnpm format`                       | ESLint / Prettier                              |
| `pnpm typecheck`                                  | TypeScript across the monorepo                 |
| `pnpm test:unit`                                  | Unit tests                                     |
| `pnpm test:integration`                           | API + PostgreSQL integration tests             |
| `pnpm e2e:up` → `pnpm test:e2e` → `pnpm e2e:down` | End-to-end tests against the real Docker stack |

## Testing

| Level       | Where                                                         | What                                                                                                                                                                                                                                          |
| ----------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | `apps/api/test/unit`, `packages/*/test`, `apps/*/…/*.test.ts` | State machine, test card catalog, delays, card validation, refund math, retry policy, idempotency hashing, signatures, validation, SDK, CLI, dashboard helpers and BFF.                                                                       |
| Integration | `apps/api/test/integration`                                   | The HTTP API with a real PostgreSQL: every resource, lifecycle and scenario, webhooks with a real receiver, idempotency (incl. concurrency), refund concurrency, delays, auth, errors.                                                        |
| End-to-end  | `tests/e2e`                                                   | The real `docker compose` stack driven by the **official Stripe SDK**: success, decline, 3DS, processing, delays, refunds, checkout, idempotency, webhook signatures, retries and manual retry, dashboard proxy, persistence across restarts. |

CI (GitHub Actions) runs lint, format, typecheck, unit, integration, build, Docker image builds and
the end-to-end suite on every push and pull request.

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md). Use
[Conventional Commits](https://www.conventionalcommits.org/), keep business logic out of routes and
components, add tests, and keep [docs/stripe-compatibility.md](docs/stripe-compatibility.md) honest.

## License

[MIT](LICENSE) © Sebastian Castillo.

LocalStripe is an independent project. It is not affiliated with, endorsed by, or connected to
Stripe, Inc. "Stripe" is a trademark of Stripe, Inc., used here only to describe API compatibility.
