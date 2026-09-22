# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows
[Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-09-22

First public release.

### Added

- Stripe-compatible `/v1` API: customers, payment methods, payment intents (full lifecycle with a
  state machine, 3DS simulation, asynchronous processing), charges, refunds (partial, concurrent-safe),
  Checkout Sessions with a hosted test checkout page, events and webhook endpoints.
- Test card catalog (Stripe-familiar numbers, `pm_card_*` tokens and a LocalStripe-only series);
  any other card number is rejected. Configurable via a JSON file.
- Artificial processing delays: global, per scenario, per card and per request.
- Signed webhooks (Stripe-compatible scheme) with retries, attempt history, manual retry and resend.
- `Idempotency-Key` support, safe under concurrency.
- Local API keys (secret/publishable), generated on first start or pinned by environment variables.
- Web dashboard with a backend-for-frontend that keeps secret keys out of the browser.
- `@localstripe/sdk` TypeScript SDK and `localstripe` CLI (including `listen --forward-to` and `trigger`).
- OpenAPI 3.1 document (`/openapi.json`) and API reference (`/docs`), Prometheus metrics (`/metrics`).
- Docker Compose setup: `docker compose up -d` is all it takes.
