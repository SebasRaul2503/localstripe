import { useQuery } from '@tanstack/react-query';

export interface AppConfig {
  apiUrl: string;
  docsUrl: string;
}

const FALLBACK: AppConfig = {
  apiUrl: 'http://localhost:9001',
  docsUrl: 'http://localhost:9001/docs',
};

async function fetchConfig(): Promise<AppConfig> {
  const response = await fetch('/config.json', { headers: { accept: 'application/json' } });
  if (!response.ok) return FALLBACK;
  return (await response.json()) as AppConfig;
}

/** Public, display-only URLs served by the dashboard server. */
export function useAppConfig(): AppConfig {
  const { data } = useQuery({
    queryKey: ['app-config'],
    queryFn: fetchConfig,
    staleTime: Infinity,
  });
  return data ?? FALLBACK;
}
