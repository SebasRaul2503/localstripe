# Webhook receiver

A minimal `node:http` server (no framework) on port 4242 that verifies LocalStripe webhook
signatures with `LocalStripe.webhooks.constructEvent`, logs each event type and answers `200`.

## Run it

```bash
pnpm install && pnpm --filter @localstripe/sdk build   # from the repository root
cd examples/webhook-receiver
npm install
LOCALSTRIPE_WEBHOOK_SECRET=whsec_... npm start
```

## Where the secret comes from

### Option A: a webhook endpoint

Register the receiver with LocalStripe. When LocalStripe runs in Docker, `localhost` is the
container itself, so use `host.docker.internal` to reach your machine:

```bash
curl http://localhost:9001/v1/webhook_endpoints \
  -H "Authorization: Bearer $LOCALSTRIPE_API_KEY" \
  -d url=http://host.docker.internal:4242/webhooks \
  -d "enabled_events[]=*"
```

The response contains the signing `secret` (`whsec_...`) once; it can be revealed again from the
dashboard or with `GET /v1/localstripe/webhook_endpoints/:id/secret`. Deliveries are retried with
backoff until the receiver answers `2xx`, and every attempt is visible with
`localstripe webhooks list`.

### Option B: `localstripe listen`

No endpoint to register: the CLI polls new events and forwards them, signed, to your URL (like
`stripe listen`). It prints the `whsec_` secret it signs with, or use your own with `--secret`:

```bash
localstripe listen --forward-to http://localhost:4242/webhooks --secret whsec_dev_secret_123
LOCALSTRIPE_WEBHOOK_SECRET=whsec_dev_secret_123 npm start
localstripe trigger payment_intent.succeeded
```

Inside Docker: `docker compose exec api localstripe listen --forward-to http://host.docker.internal:4242/webhooks`.

## Verifying with stripe-node instead

LocalStripe signs with Stripe's scheme and sends the same value in `Stripe-Signature`, so the
official library works unchanged:

```js
import Stripe from 'stripe';
const stripe = new Stripe(process.env.LOCALSTRIPE_API_KEY);
const event = stripe.webhooks.constructEvent(rawBody, req.headers['stripe-signature'], secret);
```

Always verify the **raw** request body: parsing and re-serializing JSON changes the bytes and the
signature no longer matches.
