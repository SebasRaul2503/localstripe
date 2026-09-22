export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'localstripe.theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

export function readThemePreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    // Storage can be unavailable (private mode); fall back to the system theme.
  }
  return 'system';
}

export function storeThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Ignore: the preference simply won't persist.
  }
}

export function applyTheme(preference: ThemePreference): void {
  const dark = preference === 'dark' || (preference === 'system' && media().matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function subscribeToSystemTheme(callback: () => void): () => void {
  const query = media();
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}
