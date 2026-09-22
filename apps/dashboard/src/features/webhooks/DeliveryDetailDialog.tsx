import { Link } from 'react-router';
import { StatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { DescriptionList, IdLabel, RelativeTime } from '../../components/ui/Display';
import { QueryView } from '../../components/ui/QueryView';
import { SkeletonBlock } from '../../components/ui/Skeleton';
import { useWebhookDelivery } from './api';

export function DeliveryDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useWebhookDelivery(id);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Webhook delivery"
      size="lg"
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <QueryView query={query} skeleton={<SkeletonBlock lines={6} />}>
        {(delivery) => (
          <div className="space-y-5">
            <DescriptionList
              items={[
                { label: 'ID', value: <IdLabel id={delivery.id} truncate={false} /> },
                { label: 'Status', value: <StatusBadge status={delivery.status} /> },
                {
                  label: 'Event',
                  value: (
                    <Link
                      to={`/events/${delivery.event}`}
                      onClick={onClose}
                      className="font-mono text-xs underline"
                    >
                      {delivery.event_type} ({delivery.event})
                    </Link>
                  ),
                },
                {
                  label: 'Endpoint URL',
                  value: <span className="font-mono text-xs break-all">{delivery.url}</span>,
                },
                { label: 'Attempts', value: delivery.attempts },
                {
                  label: 'Next attempt',
                  value: <RelativeTime timestamp={delivery.next_attempt_at} />,
                },
              ]}
            />
            <div>
              <h3 className="mb-2 text-sm font-semibold">Attempt history</h3>
              {delivery.attempt_history.length === 0 ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">No attempts yet.</p>
              ) : (
                <ol className="space-y-3">
                  {delivery.attempt_history.map((attempt) => (
                    <li
                      key={attempt.id}
                      className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">Attempt {attempt.attempt}</span>
                        <StatusBadge status={attempt.succeeded ? 'succeeded' : 'failed'} />
                        <span className="font-mono text-xs">
                          {attempt.response_status !== null
                            ? `HTTP ${attempt.response_status}`
                            : 'no response'}
                        </span>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          {attempt.duration_ms} ms · <RelativeTime timestamp={attempt.created} />
                        </span>
                      </div>
                      {attempt.error ? (
                        <p className="mt-1.5 text-xs text-red-700 dark:text-red-400">
                          {attempt.error}
                        </p>
                      ) : null}
                      {attempt.response_body ? (
                        <pre className="mt-2 max-h-40 overflow-auto rounded bg-zinc-50 p-2 font-mono text-xs dark:bg-zinc-950">
                          {attempt.response_body}
                        </pre>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </QueryView>
    </Dialog>
  );
}
