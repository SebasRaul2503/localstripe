import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApiKeyProvider, type ApiKeyProvider } from './api-key.js';
import { buildApp, SECURITY_HEADERS } from './app.js';
import { toUpstreamUrl } from './proxy.js';

interface Seen {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

let upstream: Server;
let upstreamUrl: string;
let seen: Seen[] = [];
let acceptedKey = 'sk_test_valid';

beforeAll(async () => {
  upstream = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      seen.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      if (req.headers.authorization !== `Bearer ${acceptedKey}`) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { type: 'authentication_error', message: 'bad key' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'a=b' });
      res.end(JSON.stringify({ ok: true, url: req.url }));
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

const apps: FastifyInstance[] = [];
afterEach(async () => {
  seen = [];
  acceptedKey = 'sk_test_valid';
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function makeApp(apiKey: ApiKeyProvider, staticDir?: string) {
  const app = await buildApp({
    apiInternalUrl: upstreamUrl,
    publicApiUrl: 'http://localhost:9001/',
    apiKey,
    ...(staticDir ? { staticDir } : {}),
  });
  apps.push(app);
  return app;
}

const fixedKey = (key: string) => createApiKeyProvider({ envKey: key, filePath: '/nonexistent' });

async function withTempDir(prefix: string, run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('BFF proxy', () => {
  it('injects the server-side key and strips client credentials', async () => {
    const app = await makeApp(fixedKey('sk_test_valid'));
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/customers?expand=x',
      headers: {
        authorization: 'Bearer sk_test_attacker',
        cookie: 'session=1',
        'content-type': 'application/json',
        'localstripe-delay-ms': '10',
      },
      payload: { email: 'a@example.com' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers['cache-control']).toBe('no-store');
    expect(seen).toHaveLength(1);
    const [request] = seen;
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe('/v1/customers?expand=x');
    expect(request?.headers.authorization).toBe('Bearer sk_test_valid');
    expect(request?.headers.cookie).toBeUndefined();
    expect(request?.headers['localstripe-delay-ms']).toBe('10');
    expect(JSON.parse(request?.body ?? '{}')).toEqual({ email: 'a@example.com' });
  });

  it('only proxies /api/v1/*', async () => {
    const app = await makeApp(fixedKey('sk_test_valid'));
    const urls = [
      '/api/v2/customers',
      '/api/openapi.json',
      '/api/v1/%2e%2e/ready',
      '/v1/customers',
    ];
    for (const url of urls) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(404);
    }
    // light-my-request normalises dot segments, so this one resolves to /healthz locally.
    await app.inject({ method: 'GET', url: '/api/v1/../../healthz' });
    expect(seen).toHaveLength(0);
  });

  it('returns a clear 503 while the key file is missing, then picks it up lazily', async () => {
    await withTempDir('ls-dash-', async (dir) => {
      const provider = createApiKeyProvider({ filePath: path.join(dir, 'dashboard.key') });
      const app = await makeApp(provider);

      const missing = await app.inject({ method: 'GET', url: '/api/v1/customers' });
      expect(missing.statusCode).toBe(503);
      expect(missing.json().error.code).toBe('dashboard_key_unavailable');

      await writeFile(path.join(dir, 'dashboard.key'), 'sk_test_valid\n');
      const ok = await app.inject({ method: 'GET', url: '/api/v1/customers' });
      expect(ok.statusCode).toBe(200);
    });
  });

  it('re-reads the key file once when the API answers 401', async () => {
    await withTempDir('ls-dash-', async (dir) => {
      const file = path.join(dir, 'dashboard.key');
      await writeFile(file, 'sk_test_valid');
      const app = await makeApp(createApiKeyProvider({ filePath: file }));
      expect((await app.inject({ method: 'GET', url: '/api/v1/events' })).statusCode).toBe(200);

      acceptedKey = 'sk_test_rotated';
      await writeFile(file, 'sk_test_rotated');
      seen = [];
      const response = await app.inject({ method: 'GET', url: '/api/v1/events' });
      expect(response.statusCode).toBe(200);
      expect(seen.map((s) => s.headers.authorization)).toEqual([
        'Bearer sk_test_valid',
        'Bearer sk_test_rotated',
      ]);
    });
  });

  it('returns 502 when the API is unreachable', async () => {
    const app = await buildApp({
      apiInternalUrl: 'http://127.0.0.1:1',
      publicApiUrl: 'http://localhost:9001',
      apiKey: fixedKey('sk_test_valid'),
    });
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/api/v1/events' });
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('upstream_unavailable');
  });

  it('maps request URLs onto the upstream /v1 prefix', () => {
    expect(toUpstreamUrl('/api/v1/events?limit=2', 'http://api:9001')?.toString()).toBe(
      'http://api:9001/v1/events?limit=2',
    );
    expect(toUpstreamUrl('/api/v1//evil.example/x', 'http://api:9001')?.host).toBe('api:9001');
    expect(toUpstreamUrl('/healthz', 'http://api:9001')).toBeNull();
  });
});

describe('BFF server routes', () => {
  it('answers /healthz and /config.json with security headers', async () => {
    const app = await makeApp(fixedKey('sk_test_valid'));
    const health = await app.inject({ method: 'GET', url: '/healthz' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(health.headers[name]).toBe(value);
    }

    const config = await app.inject({ method: 'GET', url: '/config.json' });
    expect(config.json()).toEqual({
      apiUrl: 'http://localhost:9001',
      docsUrl: 'http://localhost:9001/docs',
    });
  });

  it('serves the SPA with an index.html fallback for deep links', async () => {
    await withTempDir('ls-dash-spa-', async (dir) => {
      await writeFile(path.join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
      await mkdir(path.join(dir, 'assets'));
      await writeFile(path.join(dir, 'assets', 'app-abc123.js'), 'export {};');
      const app = await makeApp(fixedKey('sk_test_valid'), dir);

      const deepLink = await app.inject({ method: 'GET', url: '/payments/pi_123' });
      expect(deepLink.statusCode).toBe(200);
      expect(deepLink.body).toContain('id="root"');
      expect(deepLink.headers['cache-control']).toBe('no-cache');
      expect(deepLink.headers['x-frame-options']).toBe('DENY');

      const asset = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
      expect(asset.statusCode).toBe(200);
      expect(asset.headers['cache-control']).toContain('immutable');

      const missingAsset = await app.inject({ method: 'GET', url: '/assets/missing.js' });
      expect(missingAsset.statusCode).toBe(404);
    });
  });
});
