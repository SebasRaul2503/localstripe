import { z } from 'zod';
import { CARD_SCENARIOS, type CardScenario } from '@localstripe/contracts';

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((value) => value === 'true' || value === '1' || value === 'yes');

const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

const csv = z.string().transform((value) =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOCALSTRIPE_ROLE: z.enum(['all', 'api', 'worker']).default('all'),

  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: int(1, 65535).default(9001),
  PUBLIC_API_URL: z.url().default('http://localhost:9001'),
  DASHBOARD_URL: z.url().default('http://localhost:3002'),

  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgres://localstripe:localstripe@localhost:5432/localstripe'),
  DATABASE_POOL_MAX: int(1, 100).default(10),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: bool.default(false),

  CORS_ORIGINS: csv.optional(),
  RATE_LIMIT_MAX: int(1, 1_000_000).default(1000),
  RATE_LIMIT_WINDOW_MS: int(1000, 3_600_000).default(60_000),
  BODY_LIMIT_BYTES: int(1024, 10 * 1024 * 1024).default(1024 * 1024),
  STRICT_PARAMS: bool.default(true),
  METRICS_ENABLED: bool.default(true),

  LOCALSTRIPE_SECRET_KEY: z
    .string()
    .regex(/^sk_test_[A-Za-z0-9_]{16,128}$/, 'must look like sk_test_<at least 16 characters>')
    .optional(),
  LOCALSTRIPE_PUBLISHABLE_KEY: z
    .string()
    .regex(/^pk_test_[A-Za-z0-9_]{16,128}$/, 'must look like pk_test_<at least 16 characters>')
    .optional(),
  LOCALSTRIPE_SHARED_DIR: z.string().optional(),

  PAYMENT_PROCESSING_DELAY_MS: int(0, 600_000).default(0),
  PAYMENT_SCENARIO_DELAYS: z.string().default('processing=5000'),
  MAX_DELAY_MS: int(0, 600_000).default(60_000),
  TEST_CARD_CATALOG_PATH: z.string().optional(),

  WEBHOOK_MAX_ATTEMPTS: int(1, 50).default(5),
  WEBHOOK_RETRY_BASE_DELAY_MS: int(0, 3_600_000).default(10_000),
  WEBHOOK_TIMEOUT_MS: int(100, 60_000).default(10_000),
  WORKER_POLL_INTERVAL_MS: int(10, 60_000).default(500),

  IDEMPOTENCY_TTL_HOURS: int(1, 24 * 30).default(24),
  CHECKOUT_SESSION_TTL_MINUTES: int(1, 60 * 24).default(60 * 24),
  SEED_DEMO_DATA: bool.default(false),
});

export type Env = z.infer<typeof envSchema>;

export interface Config {
  env: Env['NODE_ENV'];
  role: Env['LOCALSTRIPE_ROLE'];
  http: {
    host: string;
    port: number;
    publicUrl: string;
    dashboardUrl: string;
    corsOrigins: string[];
    rateLimit: { max: number; windowMs: number };
    bodyLimitBytes: number;
    strictParams: boolean;
    metricsEnabled: boolean;
  };
  database: { url: string; poolMax: number };
  log: { level: Env['LOG_LEVEL']; pretty: boolean };
  keys: { secret?: string; publishable?: string; sharedDir?: string };
  payments: {
    globalDelayMs: number;
    scenarioDelays: Partial<Record<CardScenario, number>>;
    maxDelayMs: number;
    catalogPath?: string;
  };
  webhooks: { maxAttempts: number; retryBaseDelayMs: number; timeoutMs: number };
  worker: { pollIntervalMs: number };
  idempotency: { ttlHours: number };
  checkout: { sessionTtlMinutes: number };
  seedDemoData: boolean;
}

export class ConfigError extends Error {}

/** Parses `succeeded=500,processing=5000` into a per-scenario delay map. */
export function parseScenarioDelays(raw: string): Partial<Record<CardScenario, number>> {
  const delays: Partial<Record<CardScenario, number>> = {};
  for (const entry of raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)) {
    const [name, value] = entry.split('=').map((part) => part?.trim());
    if (!name || !(CARD_SCENARIOS as readonly string[]).includes(name)) {
      throw new ConfigError(
        `PAYMENT_SCENARIO_DELAYS: unknown scenario "${name ?? ''}" (expected one of ${CARD_SCENARIOS.join(', ')})`,
      );
    }
    const ms = Number(value);
    if (!Number.isInteger(ms) || ms < 0) {
      throw new ConfigError(
        `PAYMENT_SCENARIO_DELAYS: "${entry}" must be <scenario>=<milliseconds>`,
      );
    }
    delays[name as CardScenario] = ms;
  }
  return delays;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Invalid configuration:\n${details}`);
  }
  const env = parsed.data;

  return {
    env: env.NODE_ENV,
    role: env.LOCALSTRIPE_ROLE,
    http: {
      host: env.API_HOST,
      port: env.API_PORT,
      publicUrl: env.PUBLIC_API_URL.replace(/\/+$/, ''),
      dashboardUrl: env.DASHBOARD_URL.replace(/\/+$/, ''),
      corsOrigins: env.CORS_ORIGINS ?? [env.DASHBOARD_URL.replace(/\/+$/, '')],
      rateLimit: { max: env.RATE_LIMIT_MAX, windowMs: env.RATE_LIMIT_WINDOW_MS },
      bodyLimitBytes: env.BODY_LIMIT_BYTES,
      strictParams: env.STRICT_PARAMS,
      metricsEnabled: env.METRICS_ENABLED,
    },
    database: { url: env.DATABASE_URL, poolMax: env.DATABASE_POOL_MAX },
    log: { level: env.LOG_LEVEL, pretty: env.LOG_PRETTY },
    keys: {
      secret: env.LOCALSTRIPE_SECRET_KEY,
      publishable: env.LOCALSTRIPE_PUBLISHABLE_KEY,
      sharedDir: env.LOCALSTRIPE_SHARED_DIR,
    },
    payments: {
      globalDelayMs: env.PAYMENT_PROCESSING_DELAY_MS,
      scenarioDelays: parseScenarioDelays(env.PAYMENT_SCENARIO_DELAYS),
      maxDelayMs: env.MAX_DELAY_MS,
      catalogPath: env.TEST_CARD_CATALOG_PATH,
    },
    webhooks: {
      maxAttempts: env.WEBHOOK_MAX_ATTEMPTS,
      retryBaseDelayMs: env.WEBHOOK_RETRY_BASE_DELAY_MS,
      timeoutMs: env.WEBHOOK_TIMEOUT_MS,
    },
    worker: { pollIntervalMs: env.WORKER_POLL_INTERVAL_MS },
    idempotency: { ttlHours: env.IDEMPOTENCY_TTL_HOURS },
    checkout: { sessionTtlMinutes: env.CHECKOUT_SESSION_TTL_MINUTES },
    seedDemoData: env.SEED_DEMO_DATA,
  };
}
