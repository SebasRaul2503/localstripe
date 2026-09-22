import clsx from 'clsx';
import { humanize } from '../../lib/status';

/** Segmented status filter; '' means "All". */
export function FilterTabs({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const all = ['', ...options];
  return (
    <div
      role="group"
      aria-label={label}
      className="flex gap-1 overflow-x-auto border-b border-zinc-200 px-3 dark:border-zinc-800"
    >
      {all.map((option) => {
        const active = option === value;
        return (
          <button
            key={option || 'all'}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option)}
            className={clsx(
              '-mb-px border-b-2 px-2.5 py-2.5 text-sm whitespace-nowrap',
              active
                ? 'border-indigo-600 font-medium text-indigo-700 dark:border-indigo-400 dark:text-indigo-300'
                : 'border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white',
            )}
          >
            {option ? humanize(option) : 'All'}
          </button>
        );
      })}
    </div>
  );
}
