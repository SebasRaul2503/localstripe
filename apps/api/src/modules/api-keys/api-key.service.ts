import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { ApiKey, ApiKeyType, List } from '@localstripe/contracts';
import type { Db } from '../../infrastructure/database.js';
import { newId, randomToken } from '../../shared/ids.js';
import { forbidden, notFound } from '../../shared/errors.js';
import type { AuthenticatedKey } from '../../shared/context.js';
import { toUnix, toUnixOrNull } from '../../shared/time.js';

const PREFIX: Record<ApiKeyType, string> = {
  secret: 'sk_test_local_',
  publishable: 'pk_test_local_',
};
const LAST_USED_WRITE_INTERVAL_MS = 60_000;
export const DASHBOARD_KEY_FILE = 'dashboard.key';
export const CREDENTIALS_FILE = 'credentials.json';

export const hashKey = (key: string): string =>
  createHash('sha256').update(key, 'utf8').digest('hex');

export const generateKey = (type: ApiKeyType): string => `${PREFIX[type]}${randomToken(32)}`;

export const keyTypeOf = (key: string): ApiKeyType | null =>
  key.startsWith('sk_test_') ? 'secret' : key.startsWith('pk_test_') ? 'publishable' : null;

export const redactKey = (prefix: string, last4: string): string => `${prefix}...${last4}`;

interface ApiKeyRow {
  id: string;
  type: 'secret' | 'publishable';
  name: string;
  keyPrefix: string;
  keyLast4: string;
  publishablePlaintext: string | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

function toResource(row: ApiKeyRow, secret?: string): ApiKey {
  return {
    id: row.id,
    object: 'api_key',
    created: toUnix(row.createdAt),
    last_used_at: toUnixOrNull(row.lastUsedAt),
    livemode: false,
    name: row.name,
    // Publishable keys are public by design; secret keys are only ever shown once.
    redacted_key: row.publishablePlaintext ?? redactKey(row.keyPrefix, row.keyLast4),
    revoked: row.revokedAt !== null,
    ...((secret ?? row.publishablePlaintext) && { secret: secret ?? row.publishablePlaintext! }),
    type: row.type,
  };
}

interface StoredCredentials {
  secret_key: string;
  publishable_key: string;
}

/**
 * Local API keys. Only SHA-256 hashes of secret keys are stored. No key is ever hardcoded:
 * keys come from the environment or are generated on first start.
 */
export class ApiKeyService {
  private readonly lastUsedWrites = new Map<string, number>();

  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  async authenticate(rawKey: string): Promise<AuthenticatedKey | null> {
    if (!keyTypeOf(rawKey)) return null;
    const row = await this.db
      .selectFrom('apiKeys')
      .select(['id', 'type', 'internal'])
      .where('keyHash', '=', hashKey(rawKey))
      .where('revokedAt', 'is', null)
      .executeTakeFirst();
    if (!row) return null;
    this.touch(row.id);
    return { id: row.id, type: row.type, internal: row.internal };
  }

  private touch(id: string) {
    const now = Date.now();
    if (now - (this.lastUsedWrites.get(id) ?? 0) < LAST_USED_WRITE_INTERVAL_MS) return;
    this.lastUsedWrites.set(id, now);
    void this.db
      .updateTable('apiKeys')
      .set({ lastUsedAt: new Date(now) })
      .where('id', '=', id)
      .execute()
      .catch((error: unknown) =>
        this.logger.warn({ err: error }, 'could not update api key last_used_at'),
      );
  }

  private async insert(
    type: ApiKeyType,
    name: string,
    key: string,
    internal = false,
  ): Promise<ApiKeyRow> {
    return this.db
      .insertInto('apiKeys')
      .values({
        id: newId('apiKey'),
        type,
        name,
        keyHash: hashKey(key),
        keyPrefix: key.slice(0, PREFIX[type].length),
        keyLast4: key.slice(-4),
        publishablePlaintext: type === 'publishable' ? key : null,
        internal,
      })
      .onConflict((oc) => oc.column('keyHash').doUpdateSet({ revokedAt: null }))
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async create(type: ApiKeyType, name: string): Promise<ApiKey> {
    const key = generateKey(type);
    return toResource(await this.insert(type, name, key), key);
  }

  async list(): Promise<List<ApiKey>> {
    const rows = await this.db
      .selectFrom('apiKeys')
      .selectAll()
      .where('internal', '=', false)
      .orderBy('createdAt', 'desc')
      .execute();
    return {
      object: 'list',
      data: rows.map((row) => toResource(row)),
      has_more: false,
      url: '/v1/localstripe/api_keys',
    };
  }

  async revoke(id: string, requester: AuthenticatedKey): Promise<ApiKey> {
    const row = await this.db
      .selectFrom('apiKeys')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row || row.internal) throw notFound('api_key', id);
    if (row.id === requester.id) throw forbidden('An API key cannot revoke itself.');
    const updated = await this.db
      .updateTable('apiKeys')
      .set({ revokedAt: row.revokedAt ?? new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return toResource(updated);
  }

  /**
   * Ensures usable credentials exist at startup:
   * 1. keys pinned through LOCALSTRIPE_SECRET_KEY / LOCALSTRIPE_PUBLISHABLE_KEY are registered;
   * 2. otherwise a default key pair is generated once (and persisted in the shared directory);
   * 3. an internal key for the dashboard backend is written to the shared directory.
   */
  async bootstrap(options: {
    secret?: string;
    publishable?: string;
    sharedDir?: string;
  }): Promise<void> {
    if (options.secret)
      await this.insert('secret', 'Secret key (LOCALSTRIPE_SECRET_KEY)', options.secret);
    if (options.publishable) {
      await this.insert(
        'publishable',
        'Publishable key (LOCALSTRIPE_PUBLISHABLE_KEY)',
        options.publishable,
      );
    }

    const stored = options.sharedDir ? await this.readCredentials(options.sharedDir) : null;
    let credentials: StoredCredentials | null = null;
    if (!options.secret) {
      if (stored && (await this.authenticate(stored.secret_key))) {
        credentials = stored;
      } else if (!(await this.hasActiveKey('secret'))) {
        credentials = {
          secret_key: generateKey('secret'),
          publishable_key: generateKey('publishable'),
        };
        await this.insert('secret', 'Default secret key', credentials.secret_key);
        await this.insert('publishable', 'Default publishable key', credentials.publishable_key);
        if (options.sharedDir)
          await this.writeShared(
            options.sharedDir,
            CREDENTIALS_FILE,
            JSON.stringify(credentials, null, 2),
          );
      }
    }

    if (options.sharedDir) await this.ensureDashboardKey(options.sharedDir);
    this.announce(options, credentials);
  }

  private announce(
    options: { secret?: string; publishable?: string },
    credentials: StoredCredentials | null,
  ) {
    const secret = options.secret ?? credentials?.secret_key;
    const publishable = options.publishable ?? credentials?.publishable_key;
    if (!secret) {
      this.logger.info(
        'API keys: using previously created keys (manage them in the dashboard → API keys).',
      );
      return;
    }
    const lines = [
      '',
      '┌──────────────────────────────────────────────────────────────────────────┐',
      '│ LocalStripe local API keys (test mode only — no real payments, ever)     │',
      '└──────────────────────────────────────────────────────────────────────────┘',
      `  Secret key:      ${secret}`,
      ...(publishable ? [`  Publishable key: ${publishable}`] : []),
      '',
    ];
    // Printed on purpose: these keys only unlock this local mock and are the documented way to get started.
    for (const line of lines) process.stdout.write(`${line}\n`);
  }

  private async hasActiveKey(type: ApiKeyType): Promise<boolean> {
    const row = await this.db
      .selectFrom('apiKeys')
      .select('id')
      .where('type', '=', type)
      .where('internal', '=', false)
      .where('revokedAt', 'is', null)
      .executeTakeFirst();
    return row !== undefined;
  }

  private async ensureDashboardKey(sharedDir: string) {
    const path = join(sharedDir, DASHBOARD_KEY_FILE);
    const existing = await readFile(path, 'utf8')
      .then((content) => content.trim())
      .catch(() => null);
    if (existing && (await this.authenticate(existing))) return;
    const key = generateKey('secret');
    await this.insert('secret', 'Dashboard (internal)', key, true);
    await this.writeShared(sharedDir, DASHBOARD_KEY_FILE, key);
    this.logger.info({ path }, 'wrote internal dashboard API key');
  }

  private async readCredentials(sharedDir: string): Promise<StoredCredentials | null> {
    try {
      return JSON.parse(
        await readFile(join(sharedDir, CREDENTIALS_FILE), 'utf8'),
      ) as StoredCredentials;
    } catch {
      return null;
    }
  }

  private async writeShared(sharedDir: string, file: string, content: string) {
    await mkdir(sharedDir, { recursive: true });
    await writeFile(join(sharedDir, file), content, { mode: 0o600 });
  }
}
