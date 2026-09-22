import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseScenarioDelays } from '../../src/config/config.js';

describe('loadConfig', () => {
  it('applies defaults for an empty environment', () => {
    const config = loadConfig({});
    expect(config.env).toBe('development');
    expect(config.role).toBe('all');
    expect(config.http).toMatchObject({
      host: '0.0.0.0',
      port: 9001,
      publicUrl: 'http://localhost:9001',
      dashboardUrl: 'http://localhost:3002',
      corsOrigins: ['http://localhost:3002'],
      rateLimit: { max: 1000, windowMs: 60_000 },
      bodyLimitBytes: 1024 * 1024,
      strictParams: true,
      metricsEnabled: true,
    });
    expect(config.database.poolMax).toBe(10);
    expect(config.payments).toEqual({
      globalDelayMs: 0,
      scenarioDelays: { processing: 5000 },
      maxDelayMs: 60_000,
      catalogPath: undefined,
    });
    expect(config.webhooks).toEqual({
      maxAttempts: 5,
      retryBaseDelayMs: 10_000,
      timeoutMs: 10_000,
    });
    expect(config.keys).toEqual({
      secret: undefined,
      publishable: undefined,
      sharedDir: undefined,
    });
    expect(config.seedDemoData).toBe(false);
  });

  it('parses overrides, booleans, lists and strips trailing slashes', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      API_PORT: '8080',
      PUBLIC_API_URL: 'http://api.local:8080///',
      CORS_ORIGINS: 'http://a.test, http://b.test ,',
      STRICT_PARAMS: 'false',
      METRICS_ENABLED: '0',
      SEED_DEMO_DATA: 'yes',
      PAYMENT_PROCESSING_DELAY_MS: '250',
      PAYMENT_SCENARIO_DELAYS: 'succeeded=10,processing=0',
      LOCALSTRIPE_SECRET_KEY: 'sk_test_abcdefghijklmnop',
    });
    expect(config.env).toBe('test');
    expect(config.http.port).toBe(8080);
    expect(config.http.publicUrl).toBe('http://api.local:8080');
    expect(config.http.corsOrigins).toEqual(['http://a.test', 'http://b.test']);
    expect(config.http.strictParams).toBe(false);
    expect(config.http.metricsEnabled).toBe(false);
    expect(config.seedDemoData).toBe(true);
    expect(config.payments.globalDelayMs).toBe(250);
    expect(config.payments.scenarioDelays).toEqual({ succeeded: 10, processing: 0 });
    expect(config.keys.secret).toBe('sk_test_abcdefghijklmnop');
  });

  it('treats empty strings as unset', () => {
    expect(loadConfig({ API_PORT: '', LOG_LEVEL: '' }).http.port).toBe(9001);
  });

  it.each([
    ['API_PORT', 'abc'],
    ['API_PORT', '70000'],
    ['NODE_ENV', 'staging'],
    ['LOG_LEVEL', 'verbose'],
    ['STRICT_PARAMS', 'maybe'],
    ['BODY_LIMIT_BYTES', '10'],
    ['PUBLIC_API_URL', 'not a url'],
    ['LOCALSTRIPE_SECRET_KEY', `sk_live_${'x'.repeat(26)}`],
    ['LOCALSTRIPE_SECRET_KEY', 'sk_test_short'],
    ['LOCALSTRIPE_PUBLISHABLE_KEY', 'sk_test_abcdefghijklmnop'],
    ['WEBHOOK_MAX_ATTEMPTS', '0'],
  ])('rejects %s=%s with a ConfigError naming the variable', (name, value) => {
    expect(() => loadConfig({ [name]: value })).toThrow(ConfigError);
    expect(() => loadConfig({ [name]: value })).toThrow(name);
  });

  it('rejects an invalid PAYMENT_SCENARIO_DELAYS value', () => {
    expect(() => loadConfig({ PAYMENT_SCENARIO_DELAYS: 'bogus=1' })).toThrow(ConfigError);
  });
});

describe('parseScenarioDelays', () => {
  it('parses a comma separated list with whitespace', () => {
    expect(parseScenarioDelays(' succeeded = 500 , processing=5000 ,')).toEqual({
      succeeded: 500,
      processing: 5000,
    });
  });

  it('returns an empty map for an empty string', () => {
    expect(parseScenarioDelays('')).toEqual({});
  });

  it('lets later entries win', () => {
    expect(parseScenarioDelays('declined=1,declined=2')).toEqual({ declined: 2 });
  });

  it.each(['bogus=1', '=1', 'processing', 'processing=', 'processing=-1', 'processing=1.5'])(
    'rejects %j',
    (raw) => {
      expect(() => parseScenarioDelays(raw)).toThrow(ConfigError);
    },
  );

  it.each(['processing=abc', 'processing=0x10', 'processing=1e3', 'processing= '])(
    'rejects non-decimal milliseconds %j',
    (raw) => {
      expect(() => parseScenarioDelays(raw)).toThrow(ConfigError);
    },
  );
});
