import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import type { Logger } from 'pino';

export const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations');

/** Applies pending migrations. node-pg-migrate holds an advisory lock, so concurrent runs are safe. */
export async function runMigrations(databaseUrl: string, logger: Logger): Promise<number> {
  const applied = await runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: 'up',
    migrationsTable: 'schema_migrations',
    checkOrder: true,
    log: (message) => logger.debug({ component: 'migrations' }, message),
  });
  for (const migration of applied) logger.info({ migration: migration.name }, 'migration applied');
  return applied.length;
}
