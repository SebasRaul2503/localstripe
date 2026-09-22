import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_API_URL = 'http://localhost:9001';
export const DEFAULT_SHARED_DIR = '/var/lib/localstripe/shared';

export interface GlobalOptions {
  apiUrl?: string;
  apiKey?: string;
  json?: boolean;
}

export type Env = Record<string, string | undefined>;
export type ReadFile = (path: string) => string | undefined;

export const readFileIfExists: ReadFile = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

export const credentialsPath = (env: Env) =>
  join(env['LOCALSTRIPE_SHARED_DIR'] || DEFAULT_SHARED_DIR, 'credentials.json');

export function resolveApiUrl(options: GlobalOptions, env: Env): string {
  return options.apiUrl || env['LOCALSTRIPE_API_URL'] || DEFAULT_API_URL;
}

/**
 * Flag, then `LOCALSTRIPE_API_KEY`, then the credentials file the API writes to its shared
 * directory on first start (so `docker compose exec api localstripe ...` needs no setup).
 */
export function resolveApiKey(
  options: GlobalOptions,
  env: Env,
  readFile: ReadFile = readFileIfExists,
): string | undefined {
  if (options.apiKey) return options.apiKey;
  if (env['LOCALSTRIPE_API_KEY']) return env['LOCALSTRIPE_API_KEY'];
  const contents = readFile(credentialsPath(env));
  if (!contents) return undefined;
  try {
    const parsed = JSON.parse(contents) as { secret_key?: unknown };
    return typeof parsed.secret_key === 'string' && parsed.secret_key
      ? parsed.secret_key
      : undefined;
  } catch {
    return undefined;
  }
}
