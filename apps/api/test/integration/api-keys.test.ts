import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type Loose,
  type TestApp,
  countRows,
  createTestApp,
  resetDatabase,
} from './helpers/app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => resetDatabase(t));

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

describe('API key management', () => {
  it('creates a secret key that is shown once and works immediately', async () => {
    const created = await t.request('POST', '/v1/localstripe/api_keys', {
      type: 'secret',
      name: 'CI',
    });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      object: 'api_key',
      type: 'secret',
      name: 'CI',
      revoked: false,
    });
    expect(created.body.secret).toMatch(/^sk_test_local_[A-Za-z0-9]{32}$/);
    expect(created.body.redacted_key).toBe(`sk_test_local_...${created.body.secret.slice(-4)}`);

    const list = await t.request('GET', '/v1/localstripe/api_keys');
    const listed = list.body.data.find((key: Loose) => key.id === created.body.id);
    expect(listed).toBeDefined();
    expect(listed).not.toHaveProperty('secret');
    expect(JSON.stringify(list.body)).not.toContain(created.body.secret);

    const stored = await sql<{
      row: unknown;
    }>`SELECT row_to_json(k) AS row FROM api_keys k`.execute(t.db);
    expect(JSON.stringify(stored.rows)).not.toContain(created.body.secret);

    const used = await t.request('GET', '/v1/customers', undefined, bearer(created.body.secret));
    expect(used.status).toBe(200);
  });

  it('shows publishable keys in full', async () => {
    const created = await t.request('POST', '/v1/localstripe/api_keys', {
      type: 'publishable',
      name: 'Web',
    });
    expect(created.body.secret).toMatch(/^pk_test_local_/);
    const list = await t.request('GET', '/v1/localstripe/api_keys');
    const listed = list.body.data.find((key: Loose) => key.id === created.body.id);
    expect(listed.redacted_key).toBe(created.body.secret);
  });

  it('revokes keys, but not the key making the request', async () => {
    const created = (
      await t.request('POST', '/v1/localstripe/api_keys', { type: 'secret', name: 'Temp' })
    ).body;
    const revoked = await t.request('POST', `/v1/localstripe/api_keys/${created.id}/revoke`);
    expect(revoked.status).toBe(200);
    expect(revoked.body.revoked).toBe(true);
    expect(
      (await t.request('GET', '/v1/customers', undefined, bearer(created.secret))).status,
    ).toBe(401);

    const self = await t.request('POST', `/v1/localstripe/api_keys/${t.secretKeyId}/revoke`);
    expect(self.status).toBe(403);
    expect((await t.request('GET', '/v1/customers')).status).toBe(200);

    const unknown = await t.request('POST', '/v1/localstripe/api_keys/key_local_missing/revoke');
    expect(unknown.status).toBe(404);
  });

  it('validates the key type', async () => {
    const response = await t.request('POST', '/v1/localstripe/api_keys', {
      type: 'root',
      name: 'x',
    });
    expect(response.status).toBe(400);
  });
});

describe('bootstrap', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'localstripe-shared-'));
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it('registers LOCALSTRIPE_SECRET_KEY and LOCALSTRIPE_PUBLISHABLE_KEY', async () => {
    const secret = `sk_test_pinned_${Date.now()}_abcdefgh`;
    const publishable = `pk_test_pinned_${Date.now()}_abcdefgh`;
    await t.services.apiKeys.bootstrap({ secret, publishable });
    expect((await t.request('GET', '/v1/customers', undefined, bearer(secret))).status).toBe(200);
    expect(
      (await t.request('GET', '/v1/localstripe/test_cards', undefined, bearer(publishable))).status,
    ).toBe(200);
    expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining(secret));

    const count = await countRows(t.db, 'api_keys');
    await t.services.apiKeys.bootstrap({ secret, publishable });
    expect(await countRows(t.db, 'api_keys')).toBe(count);
  });

  it('writes credentials.json and dashboard.key once and is idempotent', async () => {
    await sql`UPDATE api_keys SET revoked_at = now() WHERE type = 'secret' AND internal = false`.execute(
      t.db,
    );
    try {
      await t.services.apiKeys.bootstrap({ sharedDir: dir });
      const credentials = JSON.parse(await readFile(join(dir, 'credentials.json'), 'utf8'));
      const dashboardKey = (await readFile(join(dir, 'dashboard.key'), 'utf8')).trim();
      expect(credentials.secret_key).toMatch(/^sk_test_local_/);
      expect(credentials.publishable_key).toMatch(/^pk_test_local_/);
      expect(dashboardKey).toMatch(/^sk_test_local_/);

      for (const key of [credentials.secret_key, dashboardKey]) {
        expect((await t.request('GET', '/v1/customers', undefined, bearer(key))).status).toBe(200);
      }
      const listed = await t.request(
        'GET',
        '/v1/localstripe/api_keys',
        undefined,
        bearer(dashboardKey),
      );
      expect(listed.body.data.some((key: Loose) => key.name === 'Dashboard (internal)')).toBe(
        false,
      );

      const count = await countRows(t.db, 'api_keys');
      await t.services.apiKeys.bootstrap({ sharedDir: dir });
      expect(await countRows(t.db, 'api_keys')).toBe(count);
      expect(JSON.parse(await readFile(join(dir, 'credentials.json'), 'utf8'))).toEqual(
        credentials,
      );
      expect((await readFile(join(dir, 'dashboard.key'), 'utf8')).trim()).toBe(dashboardKey);

      const internal = await t.db
        .selectFrom('apiKeys')
        .select('id')
        .where('internal', '=', true)
        .where('revokedAt', 'is', null)
        .execute();
      const revokeInternal = await t.request(
        'POST',
        `/v1/localstripe/api_keys/${internal[0]!.id}/revoke`,
        undefined,
        bearer(credentials.secret_key),
      );
      expect(revokeInternal.status).toBe(404);
    } finally {
      await sql`UPDATE api_keys SET revoked_at = NULL WHERE id = ${t.secretKeyId}`.execute(t.db);
    }
  });

  it('does not generate default keys when an active secret key exists', async () => {
    await t.services.apiKeys.bootstrap({ sharedDir: dir });
    await expect(readFile(join(dir, 'credentials.json'), 'utf8')).rejects.toThrow();
    expect((await readFile(join(dir, 'dashboard.key'), 'utf8')).trim()).toMatch(/^sk_test_local_/);
  });
});
