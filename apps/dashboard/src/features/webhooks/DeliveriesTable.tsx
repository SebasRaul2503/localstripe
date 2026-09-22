import { Link } from 'react-router';
import { RotateCw } from 'lucide-react';
import type { WebhookDelivery } from '@localstripe/contracts';
import { StatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Dash, RelativeTime } from '../../components/ui/Display';
import { Table, TBody, TD, TH, THead, TR } from '../../components/ui/Table';
import { useToast } from '../../components/ui/toast';
import { errorMessage } from '../../lib/api-client';
import { useRetryWebhookDelivery } from './api';

export function DeliveriesTable({
  deliveries,
  onOpen,
}: {
  deliveries: WebhookDelivery[];
  onOpen: (id: string) => void;
}) {
  const retry = useRetryWebhookDelivery();
  const notify = useToast();

  return (
    <Table label="Webhook deliveries">
      <THead>
        <TH>Event</TH>
        <TH>Status</TH>
        <TH>Endpoint</TH>
        <TH className="text-right">Attempts</TH>
        <TH>Last attempt</TH>
        <TH>Response</TH>
        <TH>Next attempt</TH>
        <TH>
          <span className="sr-only">Actions</span>
        </TH>
      </THead>
      <TBody>
        {deliveries.map((delivery) => (
          <TR key={delivery.id}>
            <TD>
              <Link
                to={`/events/${delivery.event}`}
                className="font-mono text-xs text-indigo-700 hover:underline dark:text-indigo-400"
              >
                {delivery.event_type}
              </Link>
            </TD>
            <TD>
              <StatusBadge status={delivery.status} />
            </TD>
            <TD className="max-w-[16rem] truncate font-mono text-xs" title={delivery.url}>
              {delivery.url}
            </TD>
            <TD className="text-right tabular-nums">{delivery.attempts}</TD>
            <TD className="text-zinc-600 dark:text-zinc-400">
              <RelativeTime timestamp={delivery.last_attempt_at} />
            </TD>
            <TD className="font-mono text-xs" title={delivery.last_error ?? undefined}>
              {delivery.last_response_status ?? (delivery.last_error ? 'error' : <Dash />)}
            </TD>
            <TD className="text-zinc-600 dark:text-zinc-400">
              <RelativeTime timestamp={delivery.next_attempt_at} />
            </TD>
            <TD className="text-right">
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => onOpen(delivery.id)}>
                  Details
                </Button>
                <Button
                  size="sm"
                  icon={<RotateCw className="size-3.5" aria-hidden />}
                  loading={retry.isPending && retry.variables === delivery.id}
                  aria-label={`Retry delivery ${delivery.id}`}
                  onClick={() =>
                    retry.mutate(delivery.id, {
                      onSuccess: (result) =>
                        notify(
                          `Delivery retried: ${result.status}${result.last_response_status ? ` (HTTP ${result.last_response_status})` : ''}.`,
                        ),
                      onError: (error) => notify(errorMessage(error), 'error'),
                    })
                  }
                >
                  Retry
                </Button>
              </div>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
