import { useState } from 'react';
import { KeyRound, Plus } from 'lucide-react';
import type { ApiKey } from '@localstripe/contracts';
import { Alert } from '../../components/ui/Alert';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { CopyButton } from '../../components/ui/CopyButton';
import { RelativeTime } from '../../components/ui/Display';
import { PageHeader } from '../../components/ui/PageHeader';
import { QueryView } from '../../components/ui/QueryView';
import { EmptyState } from '../../components/ui/States';
import { Table, TBody, TD, TH, THead, TR } from '../../components/ui/Table';
import { useToast } from '../../components/ui/toast';
import { humanize } from '../../lib/status';
import { useApiKeys, useRevokeApiKey } from './api';
import { CreateApiKeyDialog } from './CreateApiKeyDialog';

function KeyValue({ apiKey }: { apiKey: ApiKey }) {
  // Publishable keys are public by design, so the API returns them in full.
  const value =
    apiKey.type === 'publishable' && apiKey.secret ? apiKey.secret : apiKey.redacted_key;
  return (
    <span className="inline-flex items-center gap-1">
      <code className="font-mono text-xs break-all">{value}</code>
      {value === apiKey.secret ? <CopyButton value={value} label="Copy key" /> : null}
    </span>
  );
}

export function ApiKeysPage() {
  const query = useApiKeys();
  const revoke = useRevokeApiKey();
  const notify = useToast();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);

  return (
    <>
      <PageHeader
        title="API keys"
        description="Keys authenticate requests to the LocalStripe API. They only work against this local mock."
        actions={
          <Button
            variant="primary"
            icon={<Plus className="size-4" aria-hidden />}
            onClick={() => setCreating(true)}
          >
            Create key
          </Button>
        }
      />
      <Alert tone="info" title="Where is the default secret key?" className="mb-4">
        It is printed in the API logs on first start:{' '}
        <code className="font-mono text-xs">docker compose logs api | grep "Secret key"</code>. You
        can also pin it with the <code className="font-mono text-xs">LOCALSTRIPE_SECRET_KEY</code>{' '}
        environment variable. The dashboard itself uses a separate internal key that never reaches
        your browser.
      </Alert>
      <Card>
        <QueryView
          query={query}
          isEmpty={(list) => list.data.length === 0}
          empty={
            <EmptyState
              icon={<KeyRound className="size-5" aria-hidden />}
              title="No API keys"
              action={
                <Button variant="primary" onClick={() => setCreating(true)}>
                  Create key
                </Button>
              }
            />
          }
        >
          {(list) => (
            <Table label="API keys">
              <THead>
                <TH>Name</TH>
                <TH>Type</TH>
                <TH>Key</TH>
                <TH>Created</TH>
                <TH>Last used</TH>
                <TH>Status</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </THead>
              <TBody>
                {list.data.map((apiKey) => (
                  <TR key={apiKey.id}>
                    <TD className="font-medium">{apiKey.name}</TD>
                    <TD>
                      <Badge tone={apiKey.type === 'secret' ? 'info' : 'neutral'}>
                        {humanize(apiKey.type)}
                      </Badge>
                    </TD>
                    <TD>
                      <KeyValue apiKey={apiKey} />
                    </TD>
                    <TD className="text-zinc-600 dark:text-zinc-400">
                      <RelativeTime timestamp={apiKey.created} />
                    </TD>
                    <TD className="text-zinc-600 dark:text-zinc-400">
                      <RelativeTime timestamp={apiKey.last_used_at} />
                    </TD>
                    <TD>
                      <StatusBadge status={apiKey.revoked ? 'revoked' : 'active'} />
                    </TD>
                    <TD className="text-right">
                      {apiKey.revoked ? null : (
                        <Button size="sm" variant="ghost" onClick={() => setRevoking(apiKey)}>
                          Revoke
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </QueryView>
      </Card>
      {creating ? <CreateApiKeyDialog onClose={() => setCreating(false)} /> : null}
      {revoking ? (
        <ConfirmDialog
          title={`Revoke "${revoking.name}"?`}
          description="Requests using this key will be rejected immediately. This cannot be undone."
          confirmLabel="Revoke key"
          danger
          pending={revoke.isPending}
          error={revoke.error}
          onClose={() => {
            revoke.reset();
            setRevoking(null);
          }}
          onConfirm={() =>
            revoke.mutate(revoking.id, {
              onSuccess: () => {
                notify('API key revoked.');
                setRevoking(null);
              },
            })
          }
        />
      ) : null}
    </>
  );
}
