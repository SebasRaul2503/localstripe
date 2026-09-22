import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import pino from 'pino';
import { type Services, createServices } from '../../../src/app/services.js';
import { type Config, loadConfig } from '../../../src/config/config.js';
import { type Db, createDatabase } from '../../../src/infrastructure/database.js';
import { Metrics } from '../../../src/infrastructure/metrics.js';
import { buildServer } from '../../../src/http/server.js';
import { Worker } from '../../../src/worker/worker.js';
import { TEST_DATABASE_URL, assertTestDatabase } from './env.js';

/** Response bodies are asserted field by field, so they are deliberately loosely typed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Loose = any;

export interface TestResponse {
  status: number;
  body: Loose;
  text: string;
  headers: Record<string, string | string[] | number | undefined>;
}

export type Headers = Record<string, string | undefined>;

export interface TestApp {
  app: FastifyInstance;
  services: Services;
  worker: Worker;
  db: Db;
  config: Config;
  secretKey: string;
  secretKeyId: string;
  publishableKey: string;
  /** JSON bodies by default; a string body is sent as application/x-www-form-urlencoded. */
  request(method: string, path: string, body?: unknown, headers?: Headers): Promise<TestResponse>;
  close(): Promise<void>;
}

export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  DATABASE_POOL_MAX: '20',
  LOG_LEVEL: 'silent',
  PUBLIC_API_URL: 'http://localstripe.test',
  PAYMENT_SCENARIO_DELAYS: 'processing=0',
  WEBHOOK_RETRY_BASE_DELAY_MS: '0',
  WEBHOOK_TIMEOUT_MS: '2000',
  RATE_LIMIT_MAX: '1000000',
};

export async function createTestApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  assertTestDatabase(TEST_DATABASE_URL);
  const config = loadConfig({ ...TEST_ENV, ...overrides });
  const logger = pino({ level: 'silent' });
  const db = createDatabase(config.database.url, config.database.poolMax);
  const metrics = new Metrics();
  const services = createServices({ config, db, logger, metrics });
  const app = await buildServer({ config, db, logger, metrics, services });
  await app.ready();
  const worker = new Worker(services, config, logger);

  const secret = await services.apiKeys.create('secret', 'Integration tests');
  const publishable = await services.apiKeys.create('publishable', 'Integration tests');

  async function request(
    method: string,
    path: string,
    body?: unknown,
    headers: Headers = {},
  ): Promise<TestResponse> {
    const form = typeof body === 'string';
    const merged: Headers = {
      authorization: `Bearer ${secret.secret}`,
      ...(body !== undefined && {
        'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json',
      }),
      ...headers,
    };
    const response = await app.inject({
      method: method as 'GET',
      url: path,
      headers: Object.fromEntries(
        Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
      ...(body !== undefined && { payload: form ? body : JSON.stringify(body) }),
    });
    const isJson = String(response.headers['content-type'] ?? '').includes('application/json');
    return {
      status: response.statusCode,
      body: isJson ? response.json() : response.body,
      text: response.body,
      headers: response.headers,
    };
  }

  return {
    app,
    services,
    worker,
    db,
    config,
    secretKey: secret.secret!,
    secretKeyId: secret.id,
    publishableKey: publishable.secret!,
    request,
    async close() {
      await worker.stop();
      await app.close();
      await db.destroy();
    },
  };
}

/**
 * Deletes all payment data and webhook endpoints; API keys are kept. Equivalent to
 * `services.fixtures.reset()` (covered by the reset endpoint test), but plain DELETEs on these
 * tiny tables take ~2 ms where TRUNCATE takes ~150 ms, which matters before every test.
 */
export async function resetDatabase(testApp: TestApp): Promise<void> {
  await sql`
    DELETE FROM webhook_delivery_attempts;
    DELETE FROM webhook_deliveries;
    DELETE FROM webhook_endpoints;
    DELETE FROM events;
    DELETE FROM refunds;
    UPDATE payment_intents SET latest_charge_id = NULL, checkout_session_id = NULL;
    DELETE FROM charges;
    DELETE FROM checkout_sessions;
    DELETE FROM payment_intents;
    DELETE FROM payment_methods;
    DELETE FROM customers;
    DELETE FROM idempotency_keys;
    DELETE FROM jobs;
  `.execute(testApp.db);
}

export async function countRows(db: Db, table: string): Promise<number> {
  const result = await sql<{
    count: string;
  }>`SELECT count(*) AS count FROM ${sql.table(table)}`.execute(db);
  return Number(result.rows[0]!.count);
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
