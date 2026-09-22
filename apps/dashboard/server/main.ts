import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiKeyProvider } from './api-key.js';
import { buildApp } from './app.js';

const env = process.env;
const sharedDir = env['LOCALSTRIPE_SHARED_DIR'] ?? '/var/lib/localstripe/shared';
const host = env['DASHBOARD_HOST'] ?? '0.0.0.0';
const port = Number(env['DASHBOARD_PORT'] ?? 3002);
const here = path.dirname(fileURLToPath(import.meta.url));

const app = await buildApp({
  apiInternalUrl: env['LOCALSTRIPE_API_INTERNAL_URL'] ?? 'http://localhost:9001',
  publicApiUrl: env['PUBLIC_API_URL'] ?? 'http://localhost:9001',
  apiKey: createApiKeyProvider({
    envKey: env['DASHBOARD_API_KEY'],
    filePath: path.join(sharedDir, 'dashboard.key'),
  }),
  staticDir: env['DASHBOARD_STATIC_DIR'] ?? path.resolve(here, '../dist'),
  logger: {
    level: env['LOG_LEVEL'] ?? 'info',
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  },
});

let closing = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutting down');
    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        app.log.error({ err: error }, 'error during shutdown');
        process.exit(1);
      },
    );
  });
}

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error({ err: error }, 'failed to start the dashboard server');
  process.exit(1);
}
