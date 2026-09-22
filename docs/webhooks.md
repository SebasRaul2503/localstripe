# Webhooks

LocalStripe delivers events to your HTTP endpoints like Stripe does: signed, retried, and inspectable.

## Registering an endpoint

```bash
curl http://localhost:9001/v1/webhook_endpoints \
  -u "$LOCALSTRIPE_SECRET_KEY:" \
  -d url=http://host.docker.internal:3000/webhooks/stripe \
  -d "enabled_events[]=payment_intent.succeeded" \
  -d "enabled_events[]=payment_intent.payment_failed"
```

The response contains the signing secret (`whsec_...`) **once**. You can reveal it again from the
dashboard (Webhooks → Reveal secret) or with `GET /v1/localstripe/webhook_endpoints/:id/secret`.
Use `"*"` to subscribe to every event type.

> **Reaching your app from Docker.** Inside the API container `localhost` is the container itself.
> Use `http://host.docker.internal:<port>` for an app running on your machine (the compose file maps
> it on Linux too), or the service name if your app runs in the same Docker network.

## Delivery

For each event, LocalStripe creates one delivery per subscribed, enabled endpoint **in the same
database transaction as the event**, then the worker sends it:

```http
POST /webhooks/stripe HTTP/1.1
Content-Type: application/json; charset=utf-8
User-Agent: LocalStripe/1.0 (+https://github.com/SebasRaul2503/localstripe)
Stripe-Signature: t=1790000000,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd
LocalStripe-Signature: t=1790000000,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd
LocalStripe-Event-Id: evt_local_01...
LocalStripe-Delivery-Id: wd_local_01...

{ "id": "evt_local_01...", "object": "event", "type": "payment_intent.succeeded", "data": { "object": { ... } }, ... }
```

- Any `2xx` response marks the delivery `succeeded`. Redirects are not followed.
- Anything else (non-2xx, connection error, timeout after `WEBHOOK_TIMEOUT_MS`) is a failed attempt.
- The response status and the first 2 KB of the body are stored for every attempt.

## Retries

Failed deliveries are retried with exponential backoff: `WEBHOOK_RETRY_BASE_DELAY_MS × 3^(attempt-1)`,
capped at one hour, up to `WEBHOOK_MAX_ATTEMPTS` attempts (defaults: 10 s, 30 s, 90 s, 270 s — 5
attempts). After that the delivery is `failed`.

Manual retries:

- Dashboard → Webhooks → **Retry** on a delivery, or Events → **Resend**.
- `POST /v1/localstripe/webhook_deliveries/:id/retry` — one more attempt now.
- `POST /v1/localstripe/events/:id/resend` — re-send an event to every endpoint subscribed to it,
  including endpoints created after the event happened.
- CLI: `localstripe webhooks retry <event-id>`.

## Signature verification

The signature scheme is identical to Stripe's:

1. Take the timestamp `t` and the `v1` signature(s) from the header.
2. Compute `HMAC-SHA256(key = endpoint secret (the full "whsec_..." string), message = "<t>.<raw body>")`, hex-encoded.
3. Compare with each `v1` value in constant time.
4. Reject timestamps older than your tolerance (default 300 s) to prevent replays.

Always verify against the **raw request body**, before any JSON parsing.

With the LocalStripe SDK:

```ts
import { LocalStripe } from '@localstripe/sdk';

const event = LocalStripe.webhooks.constructEvent(
  rawBody,
  req.headers['localstripe-signature'],
  secret,
);
```

With the official Stripe SDK (works unchanged, because the scheme and the `Stripe-Signature` header match):

```ts
const event = stripe.webhooks.constructEvent(rawBody, req.headers['stripe-signature'], secret);
```

Without an SDK (Node.js):

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody: string, header: string, secret: string, toleranceSeconds = 300) {
  const parts = header.split(',').map((part) => part.split('='));
  const timestamp = parts.find(([key]) => key === 't')?.[1];
  const signatures = parts
    .filter(([key]) => key === 'v1')
    .map(([, value]) => Buffer.from(value ?? ''));
  const expected = Buffer.from(
    createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex'),
  );
  const valid = signatures.some(
    (sig) => sig.length === expected.length && timingSafeEqual(sig, expected),
  );
  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) <= toleranceSeconds;
  return valid && fresh;
}
```

## Forwarding without exposing a port

`localstripe listen --forward-to http://localhost:3000/webhooks` (like `stripe listen`) polls the
event stream and forwards each event, signed, to your local URL. It prints the signing secret to use.
