import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import clsx from 'clsx';

export function Table({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm" aria-label={label}>
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-zinc-200 bg-zinc-50/80 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
      <tr>{children}</tr>
    </thead>
  );
}

export function TH({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={clsx('px-4 py-2.5 font-medium whitespace-nowrap', className)}
      {...props}
    />
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{children}</tbody>;
}

export function TR({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <tr className={clsx('hover:bg-zinc-50 dark:hover:bg-zinc-800/40', className)}>{children}</tr>
  );
}

export function TD({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={clsx('px-4 py-2.5 align-middle', className)} {...props} />;
}
