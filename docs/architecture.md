# Architecture

LocalStripe is a **modular monolith** written in TypeScript, backed by PostgreSQL, shipped as two
containers (API and dashboard) plus Postgres.

```text
                    ┌──────────────────────────────── docker compose ───────────────────────────────┐
 browser ──:3002──▶ │ dashboard (BFF: Fastify)  ──/api/v1/* + internal key──▶  api (Fastify)  ──▶ PostgreSQL │
                    │  serves React SPA                                          │ ▲                         │
 your app ─:9001──▶ │ ───────────────────────────────────────────────────────▶  │ │  worker loop (same       │
 Stripe SDKs        │                                                            ▼ │  process by default)      │
                    │                                     webhooks ──▶ your endpoints (host.docker.internal)   │
                    └────────────────────────────────────────────────────────────────────────────────────────┘
```

## Why these choices

| Decision                                                                               | Reason                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TypeScript everywhere** (API, SDK, CLI, dashboard)                                   | One language and one set of shared types (`@localstripe/contracts`) from the database row to the React table. The main audience (web developers testing Stripe integrations) can read and extend it.                                                                              |
| **Fastify + Zod**                                                                      | Fast, schema-first HTTP. Zod schemas validate requests and generate the OpenAPI document, so docs cannot drift from behavior.                                                                                                                                                     |
| **PostgreSQL**                                                                         | Real persistence and, crucially, real concurrency primitives: row locks (`SELECT … FOR UPDATE`), unique constraints and `SKIP LOCKED` give correct refunds, idempotency and job processing under concurrency.                                                                     |
| **No Redis**                                                                           | Everything Redis would do here (job queue, idempotency, rate-limit state) is either done in Postgres or in memory. One less service to run and reason about.                                                                                                                      |
| **Kysely (query builder), not an ORM**                                                 | Type-safe SQL that stays visible and explicit.                                                                                                                                                                                                                                    |
| **Versioned SQL migrations** (`node-pg-migrate`) run by a one-shot `migrate` container | The app never creates tables on the fly; schema changes are reviewed SQL. The migrator takes an advisory lock.                                                                                                                                                                    |
| **Modular monolith, not microservices**                                                | The domain is small and highly transactional (a confirmation writes a charge, updates the payment, records events and enqueues webhook deliveries atomically). Module boundaries keep it evolvable; the worker can already run as a separate process (`LOCALSTRIPE_ROLE=worker`). |
| **Backend-for-frontend for the dashboard**                                             | The browser only talks to the dashboard server, which injects an internal API key. Secret keys never reach the browser.                                                                                                                                                           |

## Repository layout

```text
apps/
  api/                 HTTP API, background worker, hosted pages (checkout, 3DS)
    migrations/        versioned SQL migrations
    src/
      app/             composition root (wires modules together)
      config/          environment parsing and validation
      http/            server setup, auth, idempotency, error mapping
      infrastructure/  database, logger, metrics, migrations runner
      modules/         one folder per business capability (see below)
      shared/          errors, ids, pagination, validation helpers
      worker/          job queue and worker loop
    test/unit, test/integration
  dashboard/           React SPA (src/) + BFF server (server/)
  cli/                 `localstripe` command line tool (bundled into the API image)
packages/
  contracts/           resource schemas, enums, error codes, webhook signature scheme
  sdk/                 `@localstripe/sdk` TypeScript client
tests/e2e/             end-to-end tests against the real docker compose stack
infrastructure/docker/ Dockerfiles
docs/                  documentation
examples/              runnable integration examples
```

## Inside the API

Each module under `apps/api/src/modules/` owns one capability:

| Module            | Responsibility                                               |
| ----------------- | ------------------------------------------------------------ |
| `customers`       | Customer CRUD                                                |
| `payment-methods` | Card payment methods, catalog-only card validation           |
| `test-cards`      | The test card catalog and delay resolution                   |
| `payment-intents` | Lifecycle orchestration, **state machine**, outcome decision |
| `charges`         | Charges produced by confirmations                            |
| `refunds`         | Refund rules and creation                                    |
| `checkout`        | Checkout Sessions, reacting to payment lifecycle changes     |
| `events`          | Event log (the transactional outbox)                         |
| `webhooks`        | Endpoints, deliveries, signing dispatcher, retry policy      |
| `idempotency`     | `Idempotency-Key` storage and replay                         |
| `api-keys`        | Key hashing, bootstrap, management                           |
| `hosted`          | Server-rendered hosted checkout and 3DS pages                |
| `localstripe`     | Extension endpoints: stats, triggers, demo data, reset       |

Within a module:

- **Pure domain logic** lives in small, dependency-free files that are unit tested exhaustively:
  `state-machine.ts`, `outcome.ts`, `refund-calculation.ts`, `card-validation.ts`, `catalog.ts`,
  `retry-policy.ts`.
- **Services** (`*.service.ts`) orchestrate: they open transactions, lock rows, call the domain
  rules, persist, and emit events. They know nothing about HTTP.
- **Routes** (`*.routes.ts`) declare the HTTP contract with Zod schemas (validation + OpenAPI) and
  delegate to services. No business logic lives in routes.
- **Mappers** turn database rows into Stripe-shaped resources (`to*Resource`).

Modules depend on each other only through service interfaces injected in `app/services.ts`. When a
module must react to another one without a hard dependency, it uses a listener: checkout sessions
implement `PaymentIntentListener` to complete themselves when their payment succeeds.

### Payment confirmation

```text
POST /v1/payment_intents/:id/confirm
  1. load PaymentIntent, check the action is allowed from its status (state machine)
  2. resolve the payment method → catalog test card → outcome (succeeded / declined / requires_action / processing)
  3. await the artificial delay (async timer: no thread, no transaction, no row lock is held)
  4. BEGIN
       SELECT … FOR UPDATE the PaymentIntent, re-check the status (a concurrent confirm may have won)
       apply the transition (state machine rejects anything not explicitly allowed)
       insert charge, update PaymentIntent
       insert events + one webhook delivery per subscribed endpoint     ← transactional outbox
       enqueue a settle job (processing only)
     COMMIT
  5. declines → HTTP 402 card_error carrying the PaymentIntent
```

Because events and deliveries are written in the same transaction as the state change, an event is
never lost and never emitted for a change that rolled back.

### Worker

The worker loop (in the API process by default) polls Postgres every `WORKER_POLL_INTERVAL_MS`:

1. **Jobs** (`jobs` table) — currently `payment_intent.settle`, which resolves `processing` payments.
2. **Webhook deliveries** — due deliveries are claimed with a lease
   (`UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`), signed, POSTed, and every attempt is
   recorded. Failures are retried with exponential backoff until `WEBHOOK_MAX_ATTEMPTS`.
3. **Maintenance** (every minute) — expires Checkout Sessions, purges old idempotency keys.

Leases make it safe to run several workers (`LOCALSTRIPE_ROLE=worker`) and to crash mid-delivery.

### Idempotency

`Idempotency-Key` handling runs after authentication and validation. A unique constraint on
`(api_key_id, key)` decides the single winner among concurrent requests; the others get the stored
response (`Idempotent-Replayed: true`), a 409 while the first request is still running, or a 400 when
their parameters differ. 5xx responses are not stored so clients can retry. See
[`idempotency.service.ts`](../apps/api/src/modules/idempotency/idempotency.service.ts).

## Data model

Tables: `customers`, `payment_methods`, `payment_intents`, `charges`, `refunds`,
`checkout_sessions`, `events`, `webhook_endpoints`, `webhook_deliveries`,
`webhook_delivery_attempts`, `api_keys`, `idempotency_keys`, `jobs`
(see [`migrations/`](../apps/api/migrations)). Notable constraints:

- `payment_methods` stores only the catalog card id, brand, last4 and expiry — never the number or CVC.
- `charges.amount_refunded <= amount` is enforced by a `CHECK` constraint in addition to the row lock.
- `api_keys` stores SHA-256 hashes of secret keys.
- IDs are `<prefix>_local_<ULID>`: the `_local_` marker makes them impossible to confuse with real
  Stripe IDs, and ULIDs sort by time, which keyset pagination relies on.

## Adding a resource

To add, say, **Products**:

1. Add the resource schema and types to `packages/contracts/src/resources.ts` (and any event types
   to `enums.ts`).
2. Add a migration `apps/api/migrations/000N_products.sql` (up + down) and the table interface in
   `infrastructure/database.ts`.
3. Create `apps/api/src/modules/products/` with `product.service.ts` (+ mapper) and
   `product.routes.ts`; register the service in `app/services.ts` and the routes in `http/server.ts`.
4. Emit events through `EventService.emit(tx, …)` inside the service transaction — webhooks come for free.
5. Add unit tests for any pure rules and integration tests under `apps/api/test/integration/`.
6. Add SDK methods in `packages/sdk/src/resources/` and, if useful, a dashboard feature folder.
7. Update `docs/stripe-compatibility.md`.

Subscriptions, invoices, disputes or Connect would follow the same recipe; lifecycle-heavy resources
should get their own state machine like `payment-intents/state-machine.ts`, and time-based behavior
should use the existing `jobs` queue.

## Versioning

- The HTTP API is versioned by path (`/v1`). A future `/v2` would register a new set of routes that
  reuse the same services with different mappers.
- Releases follow SemVer; see [CHANGELOG](../CHANGELOG.md).
