import { existsSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { ApiKeyProvider } from './api-key.js';
import { registerApiProxy } from './proxy.js';

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};

export interface AppOptions {
  apiInternalUrl: string;
  publicApiUrl: string;
  apiKey: ApiKeyProvider;
  /** Directory with the built SPA. Static serving is skipped when it does not exist. */
  staticDir?: string;
  logger?: FastifyServerOptions['logger'];
  upstreamTimeoutMs?: number;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: false,
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) reply.header(name, value);
    return payload;
  });

  app.get('/healthz', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return { status: 'ok' };
  });

  const publicApiUrl = options.publicApiUrl.replace(/\/+$/, '');
  app.get('/config.json', async (_request, reply) => {
    reply.header('cache-control', 'no-cache');
    return { apiUrl: publicApiUrl, docsUrl: `${publicApiUrl}/docs` };
  });

  await registerApiProxy(app, {
    upstreamUrl: options.apiInternalUrl,
    apiKey: options.apiKey,
    ...(options.upstreamTimeoutMs ? { timeoutMs: options.upstreamTimeoutMs } : {}),
  });

  const staticDir = options.staticDir ? path.resolve(options.staticDir) : undefined;
  const hasSpa = staticDir !== undefined && existsSync(path.join(staticDir, 'index.html'));

  if (hasSpa) {
    await app.register(fastifyStatic, {
      root: staticDir,
      wildcard: false,
      index: false,
      cacheControl: false,
      setHeaders: (res, filePath) => {
        const isHashedAsset = filePath.split(path.sep).includes('assets');
        const cacheControl = filePath.endsWith('index.html')
          ? 'no-cache'
          : isHashedAsset
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=3600';
        res.setHeader('cache-control', cacheControl);
      },
    });
  }

  app.setNotFoundHandler(async (request, reply) => {
    const isPageRequest =
      (request.method === 'GET' || request.method === 'HEAD') &&
      !request.url.startsWith('/api/') &&
      !path.extname(request.url.split('?')[0] ?? '');
    if (hasSpa && isPageRequest) {
      reply.header('cache-control', 'no-cache');
      return reply.type('text/html; charset=utf-8').sendFile('index.html', { cacheControl: false });
    }
    return reply
      .code(404)
      .send({ error: { type: 'invalid_request_error', message: 'Not found.' } });
  });

  return app;
}
