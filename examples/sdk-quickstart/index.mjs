// @localstripe/sdk quickstart. LocalStripe is a local mock: no real card is charged.
import { CardError, LocalStripe } from '@localstripe/sdk';

if (!process.env.LOCALSTRIPE_API_KEY) {
  console.error('Set LOCALSTRIPE_API_KEY to your LocalStripe secret key (sk_test_local_...).');
  process.exit(1);
}
const localstripe = new LocalStripe({
  apiKey: process.env.LOCALSTRIPE_API_KEY,
  baseUrl: process.env.LOCALSTRIPE_API_URL ?? 'http://localhost:9001',
  maxNetworkRetries: 2,
});

const formatAmount = (amount, currency) => `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;

console.log(`0. Health          ${(await localstripe.health()).status}`);

// 1. A customer.
const customer = await localstripe.customers.create({
  email: 'grace@example.test',
  name: 'Grace Hopper',
});
console.log(`1. Customer        ${customer.id} (${customer.email})`);

// 2. A PaymentIntent with the `pm_card_visa` test token. `delayMs: 0` skips the simulated
//    processing delay for this request.
const created = await localstripe.paymentIntents.create(
  { amount: 1990, currency: 'pen', customer: customer.id, payment_method: 'pm_card_visa' },
  { idempotencyKey: `order-2001-${customer.id}` },
);
console.log(`2. Payment intent  ${created.id} → ${created.status}`);

// 3. Confirm it.
const paymentIntent = await localstripe.paymentIntents.confirm(created.id, {}, { delayMs: 0 });
console.log(
  `3. Confirmed       ${paymentIntent.id} ${formatAmount(paymentIntent.amount, paymentIntent.currency)} → ${paymentIntent.status}`,
);

// 4. A partial refund.
const refund = await localstripe.refunds.create({ payment_intent: paymentIntent.id, amount: 500 });
console.log(
  `4. Refund          ${refund.id} ${formatAmount(refund.amount, refund.currency)} → ${refund.status}`,
);

// 5. A decline rejects with CardError; the failed PaymentIntent comes with it.
try {
  await localstripe.paymentIntents.create({
    amount: 4200,
    currency: 'usd',
    payment_method: 'pm_card_chargeDeclined',
    confirm: true,
  });
} catch (error) {
  if (!(error instanceof CardError)) throw error;
  console.log(
    `5. Declined        ${error.code}/${error.declineCode} (payment ${error.paymentIntent?.id} → ${error.paymentIntent?.status}, request ${error.requestId})`,
  );
}

// 6. 3D Secure: the payment waits in requires_action until the (simulated) challenge completes.
const challenged = await localstripe.paymentIntents.create({
  amount: 3000,
  currency: 'eur',
  payment_method: 'pm_card_authenticationRequired',
  confirm: true,
  return_url: 'http://localhost:3000/after-3ds',
});
const authenticated = await localstripe.localstripe.authenticatePaymentIntent(
  challenged.id,
  'succeed',
);
console.log(`6. 3D Secure       ${challenged.status} → ${authenticated.status}`);

// 7. A Checkout Session, paid without the browser through a LocalStripe extension.
const session = await localstripe.checkout.sessions.create({
  line_items: [
    {
      price_data: { currency: 'usd', unit_amount: 2500, product_data: { name: 'Mug' } },
      quantity: 2,
    },
  ],
  success_url: 'http://localhost:3000/success?session_id={CHECKOUT_SESSION_ID}',
});
const completion = await localstripe.localstripe.completeCheckoutSession(session.id, {
  payment_method: 'pm_card_visa',
});
console.log(
  `7. Checkout        ${session.id} ${formatAmount(session.amount_total, session.currency)} → ${completion.checkout_session.status} (${completion.checkout_session.payment_status})`,
);

// 8. Iterate over every event of this customer's payment, across pages.
let count = 0;
for await (const event of localstripe.events.listAll({ object_id: paymentIntent.id, limit: 1 })) {
  count++;
  if (count === 1) console.log(`8. Events          newest: ${event.type}`);
}
console.log(`                   ${count} events for ${paymentIntent.id}`);
