# @localstripe/sdk quickstart

The same payment flow as [`stripe-node`](../stripe-node), written with the typed
[`@localstripe/sdk`](../../packages/sdk), plus the LocalStripe-only helpers (simulated 3D Secure,
paying a Checkout Session without a browser, auto-pagination). LocalStripe is a local mock: nothing
is charged.

## Run it

The example depends on the SDK in this repository (`"@localstripe/sdk": "file:../../packages/sdk"`),
so build it first:

```bash
pnpm install && pnpm --filter @localstripe/sdk build   # from the repository root
docker compose up -d
export LOCALSTRIPE_API_KEY=sk_test_local_...           # docker compose logs api | grep "Secret key"
cd examples/sdk-quickstart
npm install
npm start
```

`LOCALSTRIPE_API_URL` (default `http://localhost:9001`) points the example at another address.

## What it does

```text
0. Health          ok
1. Customer        cus_local_01M35BP2AWRHR414G5P8VDG8YE (grace@example.test)
2. Payment intent  pi_local_01M35BP2BSM2Q3TNPZZSN08CHM → requires_confirmation
3. Confirmed       pi_local_01M35BP2BSM2Q3TNPZZSN08CHM 19.90 PEN → succeeded
4. Refund          re_local_01M35BP2E38NWV8WC9JD4C8TKJ 5.00 PEN → succeeded
5. Declined        card_declined/generic_decline (payment pi_local_... → requires_payment_method, request req_...)
6. 3D Secure       requires_action → succeeded
7. Checkout        cs_local_01M35BP2J7KECDMKNJYCZ1MMRD 50.00 USD → complete (paid)
8. Events          newest: payment_intent.succeeded
                   2 events for pi_local_01M35BP2BSM2Q3TNPZZSN08CHM
```

- Declines reject with `CardError`; `error.paymentIntent` holds the failed PaymentIntent.
- `{ idempotencyKey }` and `{ delayMs }` are per-request options available on every method.
- `localstripe.localstripe.*` are LocalStripe extensions with no Stripe equivalent.
- `listAll()` iterates across pages with `for await`.
