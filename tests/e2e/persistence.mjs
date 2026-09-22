// Verifies that data survives restarting the containers (Postgres volume + API restart).
// Run against the e2e stack: pnpm e2e:up && pnpm test:e2e:persistence
import { execFileSync } from 'node:child_process';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:19901';
const KEY = process.env.E2E_SECRET_KEY ?? 'sk_test_local_e2e_fixture_key_000000000000';
const compose = [
  'compose',
  '--env-file',
  'tests/e2e/e2e.env',
  '-f',
  'docker-compose.yml',
  '-f',
  'docker-compose.e2e.yml',
];

async function request(method, path, body) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

async function waitUntilReady() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${API_URL}/ready`)).ok) return;
    } catch {
      // Still restarting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('API did not become ready after restart');
}

const marker = `persistence-${Date.now()}`;
const customer = await request('POST', '/v1/customers', { name: marker, metadata: { marker } });
const payment = await request('POST', '/v1/payment_intents', {
  amount: 4200,
  currency: 'pen',
  customer: customer.body.id,
  payment_method: 'pm_card_visa',
  confirm: true,
});
if (payment.body.status !== 'succeeded') throw new Error(`unexpected status ${payment.body.status}`);

console.log('Restarting postgres and api containers...');
execFileSync('docker', [...compose, 'restart', 'postgres', 'api'], { stdio: 'inherit' });
await waitUntilReady();

const customerAfter = await request('GET', `/v1/customers/${customer.body.id}`);
const paymentAfter = await request('GET', `/v1/payment_intents/${payment.body.id}`);
if (customerAfter.body.metadata?.marker !== marker) throw new Error('customer was not persisted');
if (paymentAfter.body.status !== 'succeeded') throw new Error('payment intent was not persisted');
console.log(`Data persisted across restart: ${customer.body.id}, ${payment.body.id}`);
