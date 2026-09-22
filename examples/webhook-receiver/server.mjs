// Minimal webhook receiver (node:http, no framework) that verifies LocalStripe signatures.
import { createServer } from 'node:http';
import { LocalStripe } from '@localstripe/sdk';

const port = Number(process.env.PORT ?? 4242);
const secret = process.env.LOCALSTRIPE_WEBHOOK_SECRET;
if (!secret?.startsWith('whsec_')) {
  console.error('Set LOCALSTRIPE_WEBHOOK_SECRET to the endpoint signing secret (whsec_...).');
  process.exit(1);
}

const readBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
};

const handlers = {
  'payment_intent.succeeded': (paymentIntent) =>
    console.log(
      `  fulfil order for ${paymentIntent.id} (${paymentIntent.amount} ${paymentIntent.currency})`,
    ),
  'payment_intent.payment_failed': (paymentIntent) =>
    console.log(`  payment failed: ${paymentIntent.last_payment_error?.message}`),
  'checkout.session.completed': (session) =>
    console.log(`  checkout ${session.id} paid by ${session.customer_email ?? 'guest'}`),
};

const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/webhooks') {
    response.writeHead(404).end();
    return;
  }
  // Verify against the RAW body: re-serialized JSON would not match the signature.
  const payload = await readBody(request);
  let event;
  try {
    event = LocalStripe.webhooks.constructEvent(
      payload,
      request.headers['localstripe-signature'],
      secret,
    );
    // stripe-node alternative (LocalStripe also sends the same value as `Stripe-Signature`):
    //   event = stripe.webhooks.constructEvent(payload, request.headers['stripe-signature'], secret);
  } catch (error) {
    console.log(`✗ rejected: ${error.message}`);
    response
      .writeHead(400, { 'content-type': 'text/plain' })
      .end(`Webhook error: ${error.message}`);
    return;
  }

  console.log(`✓ ${event.type} ${event.id}`);
  handlers[event.type]?.(event.data.object);
  // Answer 2xx quickly; anything else makes LocalStripe retry the delivery.
  response.writeHead(200, { 'content-type': 'application/json' }).end('{"received":true}');
});

server.listen(port, () => {
  console.log(`Listening on http://localhost:${port}/webhooks`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
