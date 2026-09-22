#!/usr/bin/env node
import { loadConfig } from './config/config.js';
import { createLogger } from './infrastructure/logger.js';
import { runMigrations } from './infrastructure/migrations.js';

const config = loadConfig();
const logger = createLogger(config);

runMigrations(config.database.url, logger)
  .then((count) => {
    logger.info({ applied: count }, count ? 'migrations applied' : 'database schema is up to date');
    process.exit(0);
  })
  .catch((error: unknown) => {
    logger.error({ err: error }, 'migration failed');
    process.exit(1);
  });
