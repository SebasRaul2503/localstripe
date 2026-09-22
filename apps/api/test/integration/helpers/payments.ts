import { expect } from 'vitest';
import type { Loose, TestApp } from './app.js';

export const CARDS = {
  visa: '4242424242424242',
  mastercard: '5555555555554444',
  amex: '378282246310005',
  genericDecline: '4000000000000002',
  insufficientFunds: '4000000000009995',
  expiredCard: '4000000000000069',
  threeDS: '4000002500003155',
  processing: '4242424242420004',
  processingDeclined: '4242424242420007',
  localSucceeded: '4242424242420001',
} as const;

export const EXP_YEAR = new Date().getUTCFullYear() + 3;

export async function createPaymentMethod(
  testApp: TestApp,
  number: string = CARDS.visa,
  extra: Record<string, unknown> = {},
): Promise<Loose> {
  const response = await testApp.request('POST', '/v1/payment_methods', {
    type: 'card',
    card: { number, exp_month: 12, exp_year: EXP_YEAR, cvc: number.length === 15 ? '1234' : '123' },
    ...extra,
  });
  expect(response.status, response.text).toBe(200);
  return response.body;
}

export async function createPaymentIntent(
  testApp: TestApp,
  params: Record<string, unknown> = {},
): Promise<Loose> {
  const response = await testApp.request('POST', '/v1/payment_intents', {
    amount: 2000,
    currency: 'usd',
    ...params,
  });
  expect(response.status, response.text).toBe(200);
  return response.body;
}

/** Creates and confirms a PaymentIntent with the given card; returns the final response. */
export async function pay(
  testApp: TestApp,
  number: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  const paymentMethod = await createPaymentMethod(testApp, number);
  const paymentIntent = await createPaymentIntent(testApp, {
    payment_method: paymentMethod.id,
    ...params,
  });
  return testApp.request('POST', `/v1/payment_intents/${paymentIntent.id}/confirm`, {}, headers);
}

export async function succeededPayment(testApp: TestApp, amount = 2000): Promise<Loose> {
  const response = await pay(testApp, CARDS.visa, { amount });
  expect(response.status, response.text).toBe(200);
  expect(response.body.status).toBe('succeeded');
  return response.body;
}

export async function eventTypesFor(testApp: TestApp, objectId: string): Promise<string[]> {
  const response = await testApp.request('GET', `/v1/events?object_id=${objectId}&limit=100`);
  expect(response.status).toBe(200);
  return (response.body.data as { type: string }[]).map((event) => event.type).reverse();
}

export async function allEventTypes(testApp: TestApp): Promise<string[]> {
  const response = await testApp.request('GET', '/v1/events?limit=100');
  return (response.body.data as { type: string }[]).map((event) => event.type).reverse();
}
