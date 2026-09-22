# stripe-node → LocalStripe

The **official [`stripe`](https://www.npmjs.com/package/stripe) npm package**, unchanged, talking to
LocalStripe instead of `api.stripe.com`. LocalStripe is a local mock: nothing is charged and no
money moves.

The only LocalStripe-specific code is the client configuration:

```js
import Stripe from 'stripe';

const stripe = new Stripe(process.env.LOCALSTRIPE_API_KEY, {
  host: 'localhost',
  port: 9001,
  protocol: 'http',
});
```

## Run it

```bash
docker compose up -d                                   # from the repository root
export LOCALSTRIPE_API_KEY=sk_test_local_...           # docker compose logs api | grep "Secret key"
cd examples/stripe-node
npm install
npm start
```

`LOCALSTRIPE_API_URL` (default `http://localhost:9001`) points the example at another address.

## What it does

1. Creates a customer.
2. Creates a PaymentIntent with the `pm_card_visa` test token.
3. Confirms it → `succeeded`.
4. Refunds 5.00 of it.
5. Pays with `pm_card_chargeDeclinedInsufficientFunds` and catches the `StripeCardError`
   (`card_declined` / `insufficient_funds`, HTTP 402, with the failed PaymentIntent attached).
6. Creates a Checkout Session and prints its hosted page URL: open it and pay with any test card.

```text
1. Customer        cus_local_01M35BM5EX6XXCA70E7D4GY82S (ada@example.test)
2. Payment intent  pi_local_01M35BM5FQ55V3YDJKKP8KF8ZG → requires_confirmation (visa •••• 4242)
3. Confirmed       pi_local_01M35BM5FQ55V3YDJKKP8KF8ZG 19.90 PEN → succeeded
4. Refund          re_local_01M35BM5HPQDKSE8C6FPK7KSPF 5.00 PEN → succeeded
5. Declined        card_declined/insufficient_funds: Your card has insufficient funds. ...
6. Checkout        cs_local_01M35BM5KQCP4MCNR39AZTNXEV 50.00 USD → open
   Pay it at        http://localhost:9001/checkout/cs_local_01M35BM5KQCP4MCNR39AZTNXEV
```

See every test card with `localstripe test-cards` or `GET /v1/localstripe/test_cards`, and
[docs/stripe-compatibility.md](../../docs/stripe-compatibility.md) for what is (and is not)
emulated.
