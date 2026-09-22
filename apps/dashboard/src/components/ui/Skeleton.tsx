import clsx from 'clsx';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={clsx(
        'animate-pulse rounded bg-zinc-200 dark:bg-zinc-800',
        className ?? 'h-4 w-full',
      )}
    />
  );
}

export function SkeletonRows({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="divide-y divide-zinc-100 dark:divide-zinc-800"
    >
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-4 px-4 py-3.5">
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton key={column} className={clsx('h-4', column === 0 ? 'w-40' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonBlock({ lines = 4 }: { lines?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-3">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={clsx('h-4', index % 2 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}
