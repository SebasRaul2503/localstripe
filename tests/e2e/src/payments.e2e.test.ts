import { beforeAll, describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { LocalStripe } from '@localstripe/sdk';
import {
  API_URL,
  createCardPaymentMethod,
  findEvent,
  http,
  registerSinkEndpoint,
  stripe,
  waitFor,
  waitForDelivery,
} from './support.js';

let webhookSecret: string;

beforeAll(async () => {
  ({ secret: webhookSecret } = await registerSinkEndpoint('payments'));
});

describe('successful payment', () => {
  it('customer → payment method → payment intent → confirm → succeeded → event → signed webhook', async () => {
    const customer = await stripe.customers.create({ email: 'e2e-success@example.test', name: 'E2E' });
    const paymentMethod = await createCardPaymentMethod('4242 4242 4242 4242');
    expect(paymentMethod.card?.last4).toBe('4242');

    await stripe.paymentMethods.attach(paymentMethod.id, { customer: customer.id });
    const created = await stripe.paymentIntents.create({
      amount: 1990,
      currency: 'pen',
      customer: customer.id,
      payment_method: paymentMethod.id,
    });
    expect(created.status).toBe('requires_confirmation');

    const confirmed = await stripe.paymentIntents.confirm(created.id);
    expect(confirmed.status).toBe('succeeded');
    expect(confirmed.amount_received).toBe(1990);
    expect(confirmed.latest_charge).toMatch(/^ch_local_/);

    const event = await findEvent(created.id, 'payment_intent.succeeded');
    const delivery = await waitForDelivery(event.id);

    // Both SDKs accept the same signature.
    const viaLocalStripe = LocalStripe.webhooks.constructEvent(
      delivery.body,
      delivery.headers['localstripe-signature']!,
      webhookSecret,
    );
    const viaStripe = stripe.webhooks.constructEvent(
      delivery.body,
      delivery.headers['stripe-signature']!,
      webhookSecret,
    );
    expect(viaLocalStripe.id).toBe(event.id);
    expect(viaStripe.type).toBe('payment_intent.succeeded');
    expect((viaStripe.data.object as Stripe.PaymentIntent).id).toBe(created.id);
  });
});

describe('declined payment', () => {
  it('confirm → card_error → payment_failed event → webhook', async () => {
    const paymentMethod = await createCardPaymentMethod('4000000000009995');
    const created = await stripe.paymentIntents.create({
      amount: 5000,
      currency: 'usd',
      payment_method: paymentMethod.id,
    });

    const error = await stripe.paymentIntents.confirm(created.id).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Stripe.errors.StripeCardError);
    const cardError = error as Stripe.errors.StripeCardError;
    expect(cardError.code).toBe('card_declined');
    expect(cardError.decline_code).toBe('insufficient_funds');
    expect(cardError.payment_intent?.status).toBe('requires_payment_method');

    const paymentIntent = await stripe.paymentIntents.retrieve(created.id);
    expect(paymentIntent.last_payment_error?.decline_code).toBe('insufficient_funds');

    const event = await findEvent(created.id, 'payment_intent.payment_failed');
    await waitForDelivery(event.id);
  });

  it('rejects any card number outside the test catalog', async () => {
    const error = await createCardPaymentMethod('4111111111111111').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Stripe.errors.StripeCardError);
    expect((error as Stripe.errors.StripeCardError).code).toBe('incorrect_number');
  });
});

describe('3D Secure (requires_action)', () => {
  it('confirm → requires_action → simulated challenge → succeeded', async () => {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 2500,
      currency: 'eur',
      payment_method: 'pm_card_authenticationRequired',
      confirm: true,
      return_url: 'http://localhost:3000/return',
    });
    expect(paymentIntent.status).toBe('requires_action');
    const challengeUrl = paymentIntent.next_action?.redirect_to_url?.url;
    expect(challengeUrl).toBeTruthy();

    const challenge = await fetch(challengeUrl!);
    expect(challenge.status).toBe(200);
    expect(await challenge.text()).toContain('Complete authentication');

    const submit = await fetch(`${API_URL}/3ds/${paymentIntent.id}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_secret: paymentIntent.client_secret!, outcome: 'succeed' }),
    });
    expect(submit.status).toBe(303);
    const location = new URL(submit.headers.get('location')!);
    expect(location.origin + location.pathname).toBe('http://localhost:3000/return');
    expect(location.searchParams.get('redirect_status')).toBe('succeeded');

    expect((await stripe.paymentIntents.retrieve(paymentIntent.id)).status).toBe('succeeded');
    await waitForDelivery((await findEvent(paymentIntent.id, 'payment_intent.succeeded')).id);
  });

  it('a failed challenge declines the payment', async () => {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 2500,
      currency: 'eur',
      payment_method: 'pm_card_authenticationRequired',
      confirm: true,
    });
    const failed = await http('POST', `/v1/localstripe/payment_intents/${paymentIntent.id}/authenticate`, {
      body: { outcome: 'fail' },
    });
    expect(failed.body['status']).toBe('requires_payment_method');
    await findEvent(paymentIntent.id, 'payment_intent.payment_failed');
  });
});

describe('asynchronous processing and artificial delay', () => {
  it('processing settles in the background worker', async () => {
    const paymentMethod = await createCardPaymentMethod('4242424242420004');
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 1000,
      currency: 'usd',
      payment_method: paymentMethod.id,
      confirm: true,
    });
    expect(paymentIntent.status).toBe('processing');
    await findEvent(paymentIntent.id, 'payment_intent.processing');

    const settled = await waitFor(
      async () => {
        const current = await stripe.paymentIntents.retrieve(paymentIntent.id);
        return current.status === 'succeeded' && current;
      },
      { message: 'processing payment to settle' },
    );
    expect(settled.latest_charge).toBeTruthy();
    await waitForDelivery((await findEvent(paymentIntent.id, 'payment_intent.succeeded')).id);
  });

  it('LocalStripe-Delay-Ms slows the confirmation without breaking the lifecycle', async () => {
    const started = Date.now();
    const response = await http('POST', '/v1/payment_intents', {
      body: { amount: 700, currency: 'usd', payment_method: 'pm_card_visa', confirm: true },
      headers: { 'localstripe-delay-ms': '800' },
    });
    const elapsed = Date.now() - started;
    expect(response.status).toBe(200);
    expect(response.body['status']).toBe('succeeded');
    expect(elapsed).toBeGreaterThanOrEqual(750);
  });

  it('delays do not block concurrent requests', async () => {
    const started = Date.now();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        http('POST', '/v1/payment_intents', {
          body: { amount: 700, currency: 'usd', payment_method: 'pm_card_visa', confirm: true },
          headers: { 'localstripe-delay-ms': '1000' },
        }),
      ),
    );
    expect(results.every((result) => result.body['status'] === 'succeeded')).toBe(true);
    expect(Date.now() - started).toBeLessThan(2500);
  });

  it('cancels an unconfirmed payment', async () => {
    const paymentIntent = await stripe.paymentIntents.create({ amount: 900, currency: 'usd' });
    const canceled = await stripe.paymentIntents.cancel(paymentIntent.id, {
      cancellation_reason: 'requested_by_customer',
    });
    expect(canceled.status).toBe('canceled');
    await findEvent(paymentIntent.id, 'payment_intent.canceled');
  });
});

