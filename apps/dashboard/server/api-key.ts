import { readFile } from 'node:fs/promises';

export interface ApiKeyProvider {
  /** Returns the cached key, loading it on first use. `null` when no key is available yet. */
  get(): Promise<string | null>;
  /** Re-reads the key file (no-op for keys pinned via the environment). */
  refresh(): Promise<string | null>;
}

export interface ApiKeyProviderOptions {
  envKey?: string | undefined;
  filePath: string;
}

export function createApiKeyProvider({ envKey, filePath }: ApiKeyProviderOptions): ApiKeyProvider {
  const pinned = envKey?.trim();
  if (pinned) {
    return { get: () => Promise.resolve(pinned), refresh: () => Promise.resolve(pinned) };
  }

  let cached: string | null = null;

  const load = async (): Promise<string | null> => {
    try {
      const value = (await readFile(filePath, 'utf8')).trim();
      cached = value.length > 0 ? value : null;
    } catch {
      cached = null;
    }
    return cached;
  };

  return {
    get: () => (cached ? Promise.resolve(cached) : load()),
    refresh: load,
  };
}
