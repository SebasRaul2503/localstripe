import { Monitor, Moon, Sun } from 'lucide-react';
import clsx from 'clsx';
import { useTheme } from '../../hooks/useTheme';
import type { ThemePreference } from '../../lib/theme';

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light theme', icon: Sun },
  { value: 'dark', label: 'Dark theme', icon: Moon },
  { value: 'system', label: 'System theme', icon: Monitor },
];

export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className="flex rounded-md border border-zinc-200 p-0.5 dark:border-zinc-700"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={preference === value}
          aria-label={label}
          title={label}
          onClick={() => setPreference(value)}
          className={clsx(
            'rounded p-1.5',
            preference === value
              ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white'
              : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white',
          )}
        >
          <Icon className="size-3.5" aria-hidden />
        </button>
      ))}
    </div>
  );
}
