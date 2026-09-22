import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { SkeletonRows } from './Skeleton';
import { ErrorState } from './States';

interface QueryViewProps<T> {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
  skeleton?: ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  errorTitle?: string;
}

/** Standard loading / error (with Retry) / empty handling around a TanStack query. */
export function QueryView<T>({
  query,
  children,
  skeleton,
  isEmpty,
  empty,
  errorTitle,
}: QueryViewProps<T>) {
  if (query.isPending) return <>{skeleton ?? <SkeletonRows />}</>;
  if (query.isError) {
    return (
      <ErrorState
        error={query.error}
        {...(errorTitle ? { title: errorTitle } : {})}
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (isEmpty?.(query.data) && empty) return <>{empty}</>;
  return <>{children(query.data)}</>;
}
