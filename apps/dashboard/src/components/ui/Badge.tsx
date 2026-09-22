import type { ReactNode } from 'react';
import clsx from 'clsx';
import { humanize, statusTone, type Tone } from '../../lib/status';

const TONES: Record<Tone, string> = {
  neutral: 'bg-zinc-100 text-zinc-700 ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-300',
  success:
    'bg-emerald-50 text-emerald-800 ring-emerald-600/25 dark:bg-emerald-950 dark:text-emerald-300',
  warning: 'bg-amber-50 text-amber-800 ring-amber-600/25 dark:bg-amber-950 dark:text-amber-300',
  danger: 'bg-red-50 text-red-800 ring-red-600/25 dark:bg-red-950 dark:text-red-300',
  info: 'bg-sky-50 text-sky-800 ring-sky-600/25 dark:bg-sky-950 dark:text-sky-300',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={statusTone(status)}>{label ?? humanize(status)}</Badge>;
}
