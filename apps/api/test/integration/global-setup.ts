import pg from 'pg';
import pino from 'pino';
import { runMigrations } from '../../src/infrastructure/migrations.js';
import { TEST_DATABASE_URL, assertTestDatabase } from './helpers/env.js';

/** Recreates a clean schema and applies the migrations once per run. */
export default async function setup(): Promise<void> {
  assertTestDatabase(TEST_DATABASE_URL);
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  } finally {
    await client.end();
  }
  await runMigrations(TEST_DATABASE_URL, pino({ level: 'silent' }));
}
