import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Send } from 'lucide-react';
import type { LocalStripeEvent } from '@localstripe/contracts';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { DescriptionList, IdLabel, RelativeTime } from '../../components/ui/Display';
import { JsonViewer } from '../../components/ui/JsonViewer';
import { PageHeader } from '../../components/ui/PageHeader';
import { QueryView } from '../../components/ui/QueryView';
import { SkeletonBlock } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/States';
import { useToast } from '../../components/ui/toast';
import { errorMessage } from '../../lib/api-client';
import { useWebhookDeliveries } from '../webhooks/api';
import { DeliveriesTable } from '../webhooks/DeliveriesTable';
import { DeliveryDetailDialog } from '../webhooks/DeliveryDetailDialog';
import { objectPath, useEvent, useResendEvent } from './api';

function EventDeliveries({ eventId }: { eventId: string }) {
  const query = useWebhookDeliveries({ event: eventId, limit: 100 });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader title="Webhook deliveries" />
      <QueryView
        query={query}
        isEmpty={(list) => list.data.length === 0}
        empty={
          <EmptyState
            title="Not delivered to any endpoint"
            description="No enabled webhook endpoint was subscribed to this event type when it happened."
          />
        }
      >
        {(list) => <DeliveriesTable deliveries={list.data} onOpen={setOpen} />}
      </QueryView>
      {open ? <DeliveryDetailDialog id={open} onClose={() => setOpen(null)} /> : null}
    </Card>
  );
}

function EventDetail({ event }: { event: LocalStripeEvent }) {
  const resend = useResendEvent(event.id);
  const notify = useToast();
  const object = event.data.object;
  const objectId = typeof object['id'] === 'string' ? object['id'] : null;
  const path = objectPath(object);

  return (
    <>
      <PageHeader
        back={{ to: '/events', label: 'Events' }}
        title={<span className="font-mono">{event.type}</span>}
        meta={<IdLabel id={event.id} truncate={false} />}
        actions={
          <Button
            icon={<Send className="size-4" aria-hidden />}
            loading={resend.isPending}
            onClick={() =>
              resend.mutate(undefined, {
                onSuccess: (list) =>
                  notify(
                    list.data.length > 0
                      ? `Resent to ${list.data.length} endpoint${list.data.length === 1 ? '' : 's'}.`
                      : 'No enabled endpoint is subscribed to this event type.',
                  ),
                onError: (error) => notify(errorMessage(error), 'error'),
              })
            }
          >
            Resend to webhooks
          </Button>
        }
      />
      <div className="space-y-4">
        <Card>
          <CardBody className="py-1">
            <DescriptionList
              items={[
                {
                  label: 'Object',
                  value: objectId ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="text-xs text-zinc-500">{String(object['object'])}</span>
                      <IdLabel id={objectId} {...(path ? { to: path } : {})} truncate={false} />
                    </span>
                  ) : (
                    String(object['object'])
                  ),
                },
                { label: 'Created', value: <RelativeTime timestamp={event.created} /> },
                {
                  label: 'API version',
                  value: <code className="text-xs">{event.api_version}</code>,
                },
                { label: 'Pending webhooks', value: event.pending_webhooks },
                {
                  label: 'Request',
                  value: event.request.id ? (
                    <code className="text-xs">{event.request.id}</code>
                  ) : (
                    'Automatic (no API request)'
                  ),
                },
              ]}
            />
          </CardBody>
        </Card>
        <EventDeliveries eventId={event.id} />
        <Card>
          <CardHeader
            title="Event data"
            actions={
              path ? (
                <Link
                  to={path}
                  className="text-sm text-indigo-700 hover:underline dark:text-indigo-400"
                >
                  View object
                </Link>
              ) : null
            }
          />
          <CardBody>
            <JsonViewer value={event} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}

export function EventDetailPage() {
  const { id = '' } = useParams();
  const query = useEvent(id);
  return (
    <QueryView
      query={query}
      skeleton={<SkeletonBlock lines={8} />}
      errorTitle="Could not load event"
    >
      {(event) => <EventDetail event={event} />}
    </QueryView>
  );
}
