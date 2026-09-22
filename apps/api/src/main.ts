#!/usr/bin/env node
import { ConfigError, loadConfig } from './config/config.js';
import { createDatabase } from './infrastructure/database.js';
import { createLogger } from './infrastructure/logger.js';
import { Metrics } from './infrastructure/metrics.js';
import { runMigrations } from './infrastructure/migrations.js';
import { createServices } from './app/services.js';
import { buildServer } from './http/server.js';
import { Worker } from './worker/worker.js';
import { SYSTEM_ORIGIN } from './shared/context.js';

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger(config);
  logger.warn(
    'LocalStripe is a payment MOCK for development and testing. It does not process real payments.',
  );

  if (process.argv.includes('--migrate')) await runMigrations(config.database.url, logger);

  const db = createDatabase(config.database.url, config.database.poolMax);
  const metrics = new Metrics({ collectDefaults: true });
  const services = createServices({ config, db, logger, metrics });

  const runsApi = config.role === 'all' || config.role === 'api';
  const runsWorker = config.role === 'all' || config.role === 'worker';

  if (runsApi) {
    await services.apiKeys.bootstrap(config.keys);
    if (config.seedDemoData && !(await services.fixtures.hasAnyCustomer())) {
      const seeded = await services.fixtures.seedDemoData({ ...SYSTEM_ORIGIN, delayOverrideMs: 0 });
      logger.info(seeded, 'demo data created (SEED_DEMO_DATA=true)');
    }
  }

  const worker = runsWorker
    ? new Worker(services, config, logger.child({ component: 'worker' }))
    : undefined;
  worker?.start();

  const app = runsApi
    ? await buildServer({
        config,
        db,
        logger,
        metrics,
        services,
        workerHealthy: worker ? () => worker.isHealthy() : undefined,
      })
    : undefined;
  if (app) {
    await app.listen({ host: config.http.host, port: config.http.port });
    logger.info(
      {
        api: config.http.publicUrl,
        docs: `${config.http.publicUrl}/docs`,
        dashboard: config.http.dashboardUrl,
      },
      'LocalStripe API ready',
    );
  }

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    const timeout = setTimeout(() => process.exit(1), 10_000);
    timeout.unref();
    await app?.close();
    await worker?.stop();
    await db.destroy();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  process.stderr.write(`Fatal: ${(error as Error).stack ?? String(error)}\n`);
  process.exit(1);
});
