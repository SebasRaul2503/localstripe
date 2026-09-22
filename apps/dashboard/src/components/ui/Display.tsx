import type { ReactNode } from 'react';
import { Link } from 'react-router';
import clsx from 'clsx';
import { formatAbsolute, formatRelative } from '../../lib/dates';
import { formatMoney } from '../../lib/money';
import { useNow } from '../../hooks/useNow';
import { CopyButton } from './CopyButton';

export function RelativeTime({ timestamp }: { timestamp: number | null | undefined }) {
  const now = useNow();
  if (timestamp === null || timestamp === undefined) {
    return <span className="text-zinc-400">—</span>;
  }
  const absolute = formatAbsolute(timestamp);
  return (
    <time
      dateTime={new Date(timestamp * 1000).toISOString()}
      title={absolute}
      className="whitespace-nowrap"
    >
      {formatRelative(timestamp, now)}
    </time>
  );
}

export function Money({
  amount,
  currency,
  className,
}: {
  amount: number;
  currency: string;
  className?: string;
}) {
  return (
    <span className={clsx('tabular-nums whitespace-nowrap', className)}>
      {formatMoney(amount, currency)}
    </span>
  );
}

/** Monospace object id with a copy button, optionally linking to its detail page. */
export function IdLabel({
  id,
  to,
  truncate = true,
}: {
  id: string;
  to?: string;
  truncate?: boolean;
}) {
  const text = (
    <span
      className={clsx('font-mono text-xs', truncate && 'block max-w-[14rem] truncate')}
      title={id}
    >
      {id}
    </span>
  );
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-0.5">
      {to ? (
        <Link to={to} className="min-w-0 text-indigo-700 hover:underline dark:text-indigo-400">
          {text}
        </Link>
      ) : (
        text
      )}
      <CopyButton value={id} label="Copy ID" />
    </span>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <span className="text-zinc-500 dark:text-zinc-400">{children}</span>;
}

export function Dash() {
  return <span className="text-zinc-400 dark:text-zinc-500">—</span>;
}

export interface DescriptionItem {
  label: string;
  value: ReactNode;
}

export function DescriptionList({ items }: { items: DescriptionItem[] }) {
  return (
    <dl className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {items.map((item) => (
        <div key={item.label} className="grid gap-1 py-2.5 sm:grid-cols-3 sm:gap-4">
          <dt className="text-sm text-zinc-600 dark:text-zinc-400">{item.label}</dt>
          <dd className="min-w-0 text-sm break-words sm:col-span-2">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CardBrand({ brand, last4 }: { brand: string; last4: string }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="rounded border border-zinc-300 px-1.5 py-px text-[10px] font-semibold tracking-wide text-zinc-700 uppercase dark:border-zinc-600 dark:text-zinc-300">
        {brand}
      </span>
      <span className="font-mono text-sm">•••• {last4}</span>
    </span>
  );
}
