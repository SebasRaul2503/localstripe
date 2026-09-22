# Stripe compatibility

LocalStripe implements a **subset** of the Stripe API so that code written against Stripe can be
developed and tested locally. It is not a complete Stripe replacement, and it is not affiliated with
Stripe. This page lists, honestly, what works, what partially works and what does not.

> LocalStripe never processes real payments. There are no banks, card networks, payouts or balances
> behind it — only a deterministic simulation driven by [test cards](../README.md#test-cards).

## How to point a Stripe SDK at LocalStripe

The official SDKs let you override the API host. For `stripe-node`:

```ts
import Stripe from 'stripe';

const stripe = new Stripe(process.env.LOCALSTRIPE_SECRET_KEY!, {
  host: 'localhost',
  port: 9001,
  protocol: 'http',
});
```

The end-to-end suite runs the official `stripe` package (v19) against LocalStripe on every CI run,
covering customers, payment methods, payment intents (success, decline, 3DS), refunds, events,
Checkout Sessions, webhook endpoints and `stripe.webhooks.constructEvent`.

Other SDKs (Python `stripe.api_base = "http://localhost:9001"`, Go `stripe.SetBackend`, Ruby
`Stripe.api_base`, PHP `Stripe::$apiBase`) use the same wire protocol and should work for the
supported endpoints, but they are not part of the automated test suite.

## Protocol

| Area | Status | Notes |
| --- | --- | --- |
| `/v1` paths, HTTP verbs | Supported | Same paths and methods as Stripe for the resources below. |
| `application/x-www-form-urlencoded` bodies with bracket notation (`metadata[key]=v`, `line_items[0][quantity]=1`) | Supported | What Stripe SDKs send. JSON bodies are also accepted (LocalStripe extension). |
| Auth: `Authorization: Bearer sk_...`, Basic auth (`curl -u sk_...:`) | Supported | Keys look like `sk_test_local_...` / `pk_test_local_...`. |
| Publishable keys | Partially supported | Allowed for `POST /v1/payment_methods`, `GET /v1/payment_intents/:id` and `POST /v1/payment_intents/:id/confirm` (both with `client_secret`), and the test card list. |
| Error envelope `{ error: { type, code, decline_code, message, param, payment_intent } }` and status codes (400/401/402/403/404/409/429/500) | Supported | Stripe SDKs map them to their typed errors (`StripeCardError`, ...). See [errors](errors.md). |
| `Request-Id` response header | Supported | `req_...`, also logged by the API. |
| `Idempotency-Key` | Supported | Same semantics as Stripe, including concurrency (409) and parameter mismatch (400). Keys expire after 24 h. |
| `Idempotent-Replayed` response header | Supported | |
| Pagination (`limit`, `starting_after`, `ending_before`, `has_more`) | Supported | SDK auto-pagination works. |
| Unknown parameters | Supported | Rejected with `parameter_unknown` like Stripe (disable with `STRICT_PARAMS=false`). Commonly sent parameters LocalStripe doesn't model (e.g. `automatic_payment_methods`, `payment_method_options`, `setup_future_usage`, `statement_descriptor`) are accepted and ignored. |
| `expand[]` | Not supported | Accepted and ignored; related objects are returned as IDs. |
| `Stripe-Version` header / API versioning | Not supported | Accepted and ignored. Objects follow one fixed shape; events report `api_version: "localstripe-v1"`. |
| Search endpoints (`/v1/*/search`) | Not supported | List endpoints offer a few LocalStripe filters instead (see below). |
| `Stripe-Account` (Connect) | Not supported | |
| Test clocks | Not supported | |
| `livemode` | Always `false` | |

## Resources

### Customers — Supported

`POST /v1/customers`, `GET /v1/customers/:id`, `POST /v1/customers/:id`, `DELETE /v1/customers/:id`,
`GET /v1/customers` (`email` filter), `GET /v1/customers/:id/payment_methods`.

Fields: `email`, `name`, `phone`, `description`, `address`, `metadata`,
`invoice_settings.default_payment_method`. Deleted customers are returned as
`{ id, object: "customer", deleted: true }`, like Stripe.
Not modeled: `balance`, `tax`, `shipping`, `sources`, `preferred_locales`, `test_clock`, cash balance.
Extension: `GET /v1/customers?query=` matches id, email or name.

### Payment Methods — Partially supported

`POST /v1/payment_methods` (`type=card` only), `GET`, `POST /v1/payment_methods/:id`,
`GET /v1/payment_methods`, `attach`, `detach`.

- Only card numbers from the [test card catalog](../README.md#test-cards) are accepted; anything else
  fails with `card_error` / `incorrect_number`. The number and CVC are validated and discarded.
- Stripe test tokens like `pm_card_visa`, `pm_card_chargeDeclined`,
  `pm_card_authenticationRequired` can be used wherever a `payment_method` is expected.
- Differences: `GET /v1/payment_methods` does not require `customer` (so the dashboard can list
  everything). No `wallet`, `networks`, `three_d_secure_usage`, `checks`. `card.country` is always `US`.
- Not supported: other types (SEPA, ACH, wallets, BNPL...), Setup Intents, legacy Tokens/Sources/Cards.

### Payment Intents — Partially supported

`POST /v1/payment_intents` (with optional `confirm=true`), `GET`, `POST /v1/payment_intents/:id`
(update), `confirm`, `cancel`, `GET /v1/payment_intents` (`customer` filter).

- Statuses: `requires_payment_method`, `requires_confirmation`, `requires_action`, `processing`,
  `succeeded`, `canceled` — with the transitions enforced by an explicit state machine.
- Declines return HTTP 402 with the updated PaymentIntent in `error.payment_intent`; the
  PaymentIntent returns to `requires_payment_method` with `last_payment_error` (and its
  `payment_method` detached), as in Stripe.
- 3D Secure is simulated with `next_action.type = "redirect_to_url"` pointing to a LocalStripe page
  where you choose to complete or fail the challenge (or call
  `POST /v1/localstripe/payment_intents/:id/authenticate`). `use_stripe_sdk` flows are not supported,
  so Stripe.js `handleNextAction` will not work — follow the redirect URL instead.
- `processing` is reached with dedicated test cards and settles asynchronously.
- Not supported: `capture_method=manual` / `requires_capture` / `capture`, `amount_capturable`,
  `setup_future_usage`, `off_session` semantics, `transfer_data`, `application_fee_amount`,
  `payment_method_options`, `automatic_payment_methods` (accepted and ignored), `increment_authorization`,
  `apply_customer_balance`, `verify_microdeposits`.
- Extension: `GET /v1/payment_intents?status=` filter; `LocalStripe-Delay-Ms` request header.

### Charges — Partially supported (read-only)

`GET /v1/charges/:id`, `GET /v1/charges` (`payment_intent`, `customer` filters). Charges are created by
confirmations (successful and failed ones). Direct `POST /v1/charges` and `capture` are not supported.
`balance_transaction`, `receipt_url`, `billing_details`, `outcome.risk_*` are not modeled.

### Refunds — Supported

`POST /v1/refunds` (`payment_intent` or `charge`, optional `amount`, `reason`, `metadata`),
`GET /v1/refunds/:id`, `POST /v1/refunds/:id`, `GET /v1/refunds`.
Partial and multiple refunds are supported and can never exceed the charged amount (even under
concurrency). Refunds succeed immediately. Not supported: `cancel`, `refund.updated`/`refund.failed`
flows, `reverse_transfer`, `refund_application_fee`.

### Checkout Sessions — Partially supported

`POST /v1/checkout/sessions`, `GET /v1/checkout/sessions/:id`, `GET /v1/checkout/sessions`,
`GET /v1/checkout/sessions/:id/line_items`, `POST /v1/checkout/sessions/:id/expire`.

- `mode=payment` only, with inline `line_items[].price_data` (`currency`, `unit_amount`,
  `product_data.name/description`) and `quantity`. `success_url` supports `{CHECKOUT_SESSION_ID}`.
- `url` opens a simple LocalStripe-hosted checkout page (test cards only).
- Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `checkout.session.expired`.
- Not supported: `mode=subscription|setup`, `price` IDs (there are no Products/Prices), discounts,
  tax, shipping, custom fields, `ui_mode=embedded`, adjustable quantities, customer creation.
- Extension: `POST /v1/localstripe/checkout/sessions/:id/complete` pays a session without a browser.

### Events — Supported

`GET /v1/events/:id`, `GET /v1/events` (`type`, `types[]`, `created` filters). Events contain a
snapshot of the object (`data.object`) and `previous_attributes` for customer updates.
Extension: `object_id` filter. Events are kept forever (Stripe keeps 30 days).

Event types emitted: `customer.created|updated|deleted`, `payment_method.attached|detached`,
`payment_intent.created|processing|requires_action|succeeded|payment_failed|canceled`,
`charge.succeeded|failed|refunded`, `refund.created`,
`checkout.session.completed|async_payment_succeeded|async_payment_failed|expired`.

### Webhook Endpoints — Supported

`POST /v1/webhook_endpoints` (returns `secret` once), `GET`, `POST` (update, incl. `disabled`),
`DELETE`, list. `enabled_events` accepts `*`.
Deliveries are signed with Stripe's scheme and sent with both `Stripe-Signature` and
`LocalStripe-Signature` headers, so `stripe.webhooks.constructEvent` works unchanged.
Retries use exponential backoff (configurable). Not supported: `api_version` pinning (ignored),
Connect endpoints.

## Not supported at all

Products, Prices, Subscriptions, Invoices, Quotes, Coupons/Promotion codes, Tax, Disputes, Payouts,
Balance and balance transactions, Transfers, Connect (accounts, application fees), Issuing, Terminal,
Radar, Identity, Sigma, Financial Connections, Setup Intents, Sources/Tokens, Apple Pay / Google Pay,
Stripe.js / Elements, File uploads, Reporting.

The codebase is organized so that these can be added as new modules without touching existing ones —
see [architecture](architecture.md#adding-a-resource).

## LocalStripe extensions (`/v1/localstripe/*`)

These endpoints do not exist in Stripe and are documented in the OpenAPI spec (`/docs`):
test card catalog, stats, runtime config, API key management, 3DS completion, checkout completion,
event triggers (`stripe trigger`-like), demo data, reset, webhook delivery inspection/retry and
event re-sending.
