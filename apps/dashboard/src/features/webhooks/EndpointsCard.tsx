import { useState } from 'react';
import { Eye, Plus, Trash2, Webhook } from 'lucide-react';
import type { WebhookEndpoint } from '@localstripe/contracts';
import { StatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { CopyButton } from '../../components/ui/CopyButton';
import { IdLabel, RelativeTime } from '../../components/ui/Display';
import { QueryView } from '../../components/ui/QueryView';
import { EmptyState } from '../../components/ui/States';
import { Table, TBody, TD, TH, THead, TR } from '../../components/ui/Table';
import { useToast } from '../../components/ui/toast';
import { errorMessage } from '../../lib/api-client';
import {
  useDeleteWebhookEndpoint,
  useRevealWebhookSecret,
  useToggleWebhookEndpoint,
  useWebhookEndpoints,
} from './api';
import { CreateEndpointDialog } from './CreateEndpointDialog';

function SecretCell({ endpointId }: { endpointId: string }) {
  const reveal = useRevealWebhookSecret();
  const notify = useToast();
  if (reveal.data) {
    return (
      <span className="inline-flex items-center gap-1">
        <code className="max-w-[12rem] truncate font-mono text-xs" title={reveal.data.secret}>
          {reveal.data.secret}
        </code>
        <CopyButton value={reveal.data.secret} label="Copy secret" />
      </span>
    );
  }
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={<Eye className="size-3.5" aria-hidden />}
      loading={reveal.isPending}
      onClick={() =>
        reveal.mutate(endpointId, { onError: (error) => notify(errorMessage(error), 'error') })
      }
    >
      Reveal secret
    </Button>
  );
}

function EndpointRow({ endpoint, onDelete }: { endpoint: WebhookEndpoint; onDelete: () => void }) {
  const toggle = useToggleWebhookEndpoint();
  const notify = useToast();
  const disabled = endpoint.status === 'disabled';
  return (
    <TR>
      <TD>
        <p className="max-w-[18rem] truncate font-mono text-xs" title={endpoint.url}>
          {endpoint.url}
        </p>
        <IdLabel id={endpoint.id} />
      </TD>
      <TD>
        <StatusBadge status={endpoint.status} />
      </TD>
      <TD className="max-w-[16rem]">
        <span className="line-clamp-2 font-mono text-xs" title={endpoint.enabled_events.join(', ')}>
          {endpoint.enabled_events.includes('*')
            ? 'All events (*)'
            : endpoint.enabled_events.join(', ')}
        </span>
      </TD>
      <TD>
        <SecretCell endpointId={endpoint.id} />
      </TD>
      <TD className="text-zinc-600 dark:text-zinc-400">
        <RelativeTime timestamp={endpoint.created} />
      </TD>
      <TD>
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            loading={toggle.isPending}
            onClick={() =>
              toggle.mutate(
                { id: endpoint.id, disabled: !disabled },
                {
                  onSuccess: () => notify(`Endpoint ${disabled ? 'enabled' : 'disabled'}.`),
                  onError: (error) => notify(errorMessage(error), 'error'),
                },
              )
            }
          >
            {disabled ? 'Enable' : 'Disable'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Delete endpoint ${endpoint.url}`}
            icon={<Trash2 className="size-3.5 text-red-600" aria-hidden />}
            onClick={onDelete}
          />
        </div>
      </TD>
    </TR>
  );
}

export function EndpointsCard() {
  const query = useWebhookEndpoints();
  const remove = useDeleteWebhookEndpoint();
  const notify = useToast();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<WebhookEndpoint | null>(null);

  return (
    <Card>
      <CardHeader
        title="Endpoints"
        description="LocalStripe signs every delivery with the endpoint's whsec_ secret, just like Stripe."
        actions={
          <Button
            size="sm"
            variant="primary"
            icon={<Plus className="size-3.5" aria-hidden />}
            onClick={() => setCreating(true)}
          >
            Add endpoint
          </Button>
        }
      />
      <QueryView
        query={query}
        isEmpty={(list) => list.data.length === 0}
        empty={
          <EmptyState
            icon={<Webhook className="size-5" aria-hidden />}
            title="No webhook endpoints"
            description="Add an endpoint to receive signed events at your app."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                Add endpoint
              </Button>
            }
          />
        }
      >
        {(list) => (
          <Table label="Webhook endpoints">
            <THead>
              <TH>URL</TH>
              <TH>Status</TH>
              <TH>Events</TH>
              <TH>Signing secret</TH>
              <TH>Created</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </THead>
            <TBody>
              {list.data.map((endpoint) => (
                <EndpointRow
                  key={endpoint.id}
                  endpoint={endpoint}
                  onDelete={() => setDeleting(endpoint)}
                />
              ))}
            </TBody>
          </Table>
        )}
      </QueryView>
      {creating ? <CreateEndpointDialog onClose={() => setCreating(false)} /> : null}
      {deleting ? (
        <ConfirmDialog
          title="Delete webhook endpoint?"
          description={`Events will no longer be sent to ${deleting.url}.`}
          confirmLabel="Delete endpoint"
          danger
          pending={remove.isPending}
          error={remove.error}
          onClose={() => {
            remove.reset();
            setDeleting(null);
          }}
          onConfirm={() =>
            remove.mutate(deleting.id, {
              onSuccess: () => {
                notify('Endpoint deleted.');
                setDeleting(null);
              },
            })
          }
        />
      ) : null}
    </Card>
  );
}
