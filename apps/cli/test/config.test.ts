import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SHARED_DIR, resolveApiKey, resolveApiUrl } from '../src/config.js';

const files = (entries: Record<string, string>) => (path: string) => entries[path];

describe('resolveApiUrl', () => {
  it('prefers the flag, then the env var, then the default', () => {
    expect(resolveApiUrl({ apiUrl: 'http://a' }, { LOCALSTRIPE_API_URL: 'http://b' })).toBe(
      'http://a',
    );
    expect(resolveApiUrl({}, { LOCALSTRIPE_API_URL: 'http://b' })).toBe('http://b');
    expect(resolveApiUrl({}, {})).toBe('http://localhost:9001');
  });
});

describe('resolveApiKey', () => {
  const credentials = JSON.stringify({ secret_key: 'sk_from_file', publishable_key: 'pk_x' });

  it('prefers the flag, then LOCALSTRIPE_API_KEY', () => {
    const read = files({ [join(DEFAULT_SHARED_DIR, 'credentials.json')]: credentials });
    expect(resolveApiKey({ apiKey: 'sk_flag' }, { LOCALSTRIPE_API_KEY: 'sk_env' }, read)).toBe(
      'sk_flag',
    );
    expect(resolveApiKey({}, { LOCALSTRIPE_API_KEY: 'sk_env' }, read)).toBe('sk_env');
  });

  it('falls back to the default shared credentials file', () => {
    const read = files({ [join(DEFAULT_SHARED_DIR, 'credentials.json')]: credentials });
    expect(resolveApiKey({}, {}, read)).toBe('sk_from_file');
  });

  it('honours LOCALSTRIPE_SHARED_DIR', () => {
    const read = files({ [join('/tmp/shared', 'credentials.json')]: credentials });
    expect(resolveApiKey({}, { LOCALSTRIPE_SHARED_DIR: '/tmp/shared' }, read)).toBe('sk_from_file');
    expect(resolveApiKey({}, {}, read)).toBeUndefined();
  });

  it('ignores missing or invalid credentials files', () => {
    expect(resolveApiKey({}, {}, () => undefined)).toBeUndefined();
    expect(resolveApiKey({}, {}, () => 'not json')).toBeUndefined();
    expect(resolveApiKey({}, {}, () => '{"secret_key": 42}')).toBeUndefined();
  });
});
