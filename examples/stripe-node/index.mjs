// The official stripe-node library talking to LocalStripe instead of api.stripe.com.
// LocalStripe is a local mock: no real card is charged and no money moves.
import Stripe from 'stripe';

const apiUrl = new URL(process.env.LOCALSTRIPE_API_URL ?? 'http://localhost:9001');
const apiKey = process.env.LOCALSTRIPE_API_KEY;
if (!apiKey) {
  console.error('Set LOCALSTRIPE_API_KEY to your LocalStripe secret key (sk_test_local_...).');
  process.exit(1);
}

// The only LocalStripe-specific part: where the API lives.
const stripe = new Stripe(apiKey, {
  host: apiUrl.hostname,
  port: Number(apiUrl.port || (apiUrl.protocol === 'https:' ? 443 : 80)),
  protocol: apiUrl.protocol.replace(':', ''),
  maxNetworkRetries: 2,
});

const formatAmount = (amount, currency) => `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;

// 1. A customer.
const customer = await stripe.customers.create({
  email: 'ada@example.test',
  name: 'Ada Lovelace',
  metadata: { source: 'stripe-node-example' },
});
console.log(`1. Customer        ${customer.id} (${customer.email})`);

// 2. A PaymentIntent paid with the `pm_card_visa` test token (a Visa that succeeds).
//    The idempotency key makes retrying this request safe.
const created = await stripe.paymentIntents.create(
  {
    amount: 1990,
    currency: 'pen',
    customer: customer.id,
    payment_method: 'pm_card_visa',
    description: 'Order #1001',
  },
  { idempotencyKey: `order-1001-${customer.id}` },
);
const paymentMethod = await stripe.paymentMethods.retrieve(created.payment_method);
console.log(
  `2. Payment intent  ${created.id} → ${created.status} (${paymentMethod.card.brand} •••• ${paymentMethod.card.last4})`,
);

// 3. Confirm it: the test card decides the outcome.
const paymentIntent = await stripe.paymentIntents.confirm(created.id);
console.log(
  `3. Confirmed       ${paymentIntent.id} ${formatAmount(paymentIntent.amount, paymentIntent.currency)} → ${paymentIntent.status}`,
);

// 4. A partial refund.
const refund = await stripe.refunds.create({
  payment_intent: paymentIntent.id,
  amount: 500,
  reason: 'requested_by_customer',
});
console.log(
  `4. Refund          ${refund.id} ${formatAmount(refund.amount, refund.currency)} → ${refund.status}`,
);

// 5. A declined card: stripe-node throws StripeCardError (HTTP 402).
try {
  await stripe.paymentIntents.create({
    amount: 4200,
    currency: 'usd',
    payment_method: 'pm_card_chargeDeclinedInsufficientFunds',
    confirm: true,
  });
  console.log('5. Unexpected: the declined card succeeded');
} catch (error) {
  if (!(error instanceof Stripe.errors.StripeCardError)) throw error;
  console.log(
    `5. Declined        ${error.code}/${error.decline_code}: ${error.message} (payment ${error.payment_intent?.id} → ${error.payment_intent?.status})`,
  );
}

// 6. A Checkout Session: open `session.url` in a browser to pay on the hosted test page.
const session = await stripe.checkout.sessions.create({
  mode: 'payment',
  line_items: [
    {
      price_data: {
        currency: 'usd',
        unit_amount: 2500,
        product_data: { name: 'LocalStripe T-shirt' },
      },
      quantity: 2,
    },
  ],
  success_url: 'http://localhost:3000/success?session_id={CHECKOUT_SESSION_ID}',
  cancel_url: 'http://localhost:3000/cart',
});
console.log(
  `6. Checkout        ${session.id} ${formatAmount(session.amount_total, session.currency)} → ${session.status}`,
);
console.log(`   Pay it at        ${session.url}`);
