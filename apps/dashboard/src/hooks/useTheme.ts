import { useCallback, useEffect, useState } from 'react';
import {
  applyTheme,
  readThemePreference,
  storeThemePreference,
  subscribeToSystemTheme,
  type ThemePreference,
} from '../lib/theme';

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference);

  useEffect(() => {
    applyTheme(preference);
    if (preference !== 'system') return undefined;
    return subscribeToSystemTheme(() => applyTheme('system'));
  }, [preference]);

  const update = useCallback((next: ThemePreference) => {
    storeThemePreference(next);
    setPreference(next);
  }, []);

  return { preference, setPreference: update };
}
