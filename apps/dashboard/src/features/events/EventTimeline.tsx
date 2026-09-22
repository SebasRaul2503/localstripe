import { Link } from 'react-router';
import { useQueries } from '@tanstack/react-query';
import type { List, LocalStripeEvent } from '@localstripe/contracts';
import { RelativeTime } from '../../components/ui/Display';
import { SkeletonBlock } from '../../components/ui/Skeleton';
import { EmptyState, ErrorState } from '../../components/ui/States';
import { apiClient } from '../../lib/api-client';

/** Merged, newest-first list of the events that reference any of the given objects. */
export function EventTimeline({ objectIds }: { objectIds: string[] }) {
  const results = useQueries({
    queries: objectIds.map((objectId) => ({
      queryKey: ['events', 'list', { object_id: objectId, limit: 50 }],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        apiClient.get<List<LocalStripeEvent>>('/events', {
          query: { object_id: objectId, limit: 50 },
          signal,
        }),
    })),
  });

  if (results.some((result) => result.isPending)) return <SkeletonBlock lines={4} />;
  const failed = results.find((result) => result.isError);
  if (failed) {
    return (
      <ErrorState
        error={failed.error}
        onRetry={() => results.forEach((result) => void result.refetch())}
      />
    );
  }

  const byId = new Map<string, LocalStripeEvent>();
  for (const result of results)
    for (const event of result.data?.data ?? []) byId.set(event.id, event);
  const events = [...byId.values()].sort(
    (a, b) => b.created - a.created || b.id.localeCompare(a.id),
  );

  if (events.length === 0) return <EmptyState title="No events yet" />;

  return (
    <ol className="relative space-y-4 border-l border-zinc-200 pl-5 dark:border-zinc-700">
      {events.map((event) => (
        <li key={event.id} className="relative">
          <span
            aria-hidden
            className="absolute top-1.5 -left-[1.4rem] size-2.5 rounded-full border-2 border-white bg-indigo-500 dark:border-zinc-900"
          />
          <Link
            to={`/events/${event.id}`}
            className="font-mono text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400"
          >
            {event.type}
          </Link>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            <RelativeTime timestamp={event.created} />
          </p>
        </li>
      ))}
    </ol>
  );
}
