import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, RotateCw } from 'lucide-react';
import { ApiError, errorMessage } from '../../lib/api-client';
import { Button } from './Button';

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 rounded-full bg-zinc-100 p-3 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
        {icon ?? <Inbox className="size-5" aria-hidden />}
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-zinc-600 dark:text-zinc-400">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  title = 'Could not load data',
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const detail =
    error instanceof ApiError && error.status === 404
      ? 'This object does not exist (or was deleted).'
      : errorMessage(error);
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 rounded-full bg-red-50 p-3 text-red-600 dark:bg-red-950 dark:text-red-400">
        <AlertTriangle className="size-5" aria-hidden />
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-sm break-words text-zinc-600 dark:text-zinc-400">{detail}</p>
      {onRetry ? (
        <Button
          className="mt-4"
          size="sm"
          icon={<RotateCw className="size-3.5" aria-hidden />}
          onClick={onRetry}
        >
          Retry
        </Button>
      ) : null}
    </div>
  );
}
