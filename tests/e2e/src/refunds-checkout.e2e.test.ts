import { beforeAll, describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { API_URL, findEvent, registerSinkEndpoint, stripe, waitForDelivery } from './support.js';

beforeAll(async () => {
  await registerSinkEndpoint('refunds-checkout');
});

describe('refunds', () => {
  it('successful payment → partial refund → remaining refund → charge.refunded webhook', async () => {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 10_000,
      currency: 'pen',
      payment_method: 'pm_card_visa',
      confirm: true,
    });
    expect(paymentIntent.status).toBe('succeeded');

    const partial = await stripe.refunds.create({ payment_intent: paymentIntent.id, amount: 3000 });
    expect(partial.status).toBe('succeeded');
    expect(partial.amount).toBe(3000);

    let charge = await stripe.charges.retrieve(paymentIntent.latest_charge as string);
    expect(charge.amount_refunded).toBe(3000);
    expect(charge.refunded).toBe(false);

    const overRefund = await stripe.refunds
      .create({ payment_intent: paymentIntent.id, amount: 8000 })
      .catch((caught: unknown) => caught);
    expect(overRefund).toBeInstanceOf(Stripe.errors.StripeInvalidRequestError);
    expect((overRefund as Stripe.errors.StripeInvalidRequestError).code).toBe('amount_too_large');

    const rest = await stripe.refunds.create({ payment_intent: paymentIntent.id });
    expect(rest.amount).toBe(7000);
    charge = await stripe.charges.retrieve(paymentIntent.latest_charge as string);
    expect(charge.refunded).toBe(true);

    const refunds = await stripe.refunds.list({ payment_intent: paymentIntent.id });
    expect(refunds.data.map((refund) => refund.amount).sort()).toEqual([3000, 7000]);

    await waitForDelivery((await findEvent(rest.id, 'refund.created')).id);
    await waitForDelivery((await findEvent(charge.id, 'charge.refunded')).id);
  });
});

describe('checkout sessions', () => {
  it('hosted checkout page pays the session and redirects to success_url', async () => {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: 'http://localhost:3000/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'http://localhost:3000/cancel',
      line_items: [
        {
          price_data: { currency: 'usd', unit_amount: 1500, product_data: { name: 'T-shirt' } },
          quantity: 2,
        },
      ],
    });
    expect(session.amount_total).toBe(3000);
    expect(session.url).toContain(`/checkout/${session.id}`);

    const page = await fetch(`${API_URL}/checkout/${session.id}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");

    const submit = await fetch(`${API_URL}/checkout/${session.id}/pay`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ test_card: 'visa_success', expiry: '12/40', cvc: '123' }),
    });
    expect(submit.status).toBe(303);
    expect(submit.headers.get('location')).toBe(
      `http://localhost:3000/success?session_id=${session.id}`,
    );

    const completed = await stripe.checkout.sessions.retrieve(session.id);
    expect(completed.status).toBe('complete');
    expect(completed.payment_status).toBe('paid');
    expect((await stripe.paymentIntents.retrieve(completed.payment_intent as string)).status).toBe(
      'succeeded',
    );

    const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
    expect(lineItems.data[0]?.quantity).toBe(2);
    await waitForDelivery((await findEvent(session.id, 'checkout.session.completed')).id);
  });

  it('a declined card keeps the session open', async () => {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: 'http://localhost:3000/success',
      line_items: [
        {
          price_data: { currency: 'usd', unit_amount: 900, product_data: { name: 'Mug' } },
          quantity: 1,
        },
      ],
    });
    const submit = await fetch(`${API_URL}/checkout/${session.id}/pay`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ test_card: 'generic_decline', expiry: '12/40', cvc: '123' }),
    });
    expect(submit.status).toBe(402);
    expect(await submit.text()).toContain('Your card was declined');
    expect((await stripe.checkout.sessions.retrieve(session.id)).status).toBe('open');
  });
});
