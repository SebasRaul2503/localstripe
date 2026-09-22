import { useState } from 'react';
import { EVENT_TYPES, type WebhookEndpoint } from '@localstripe/contracts';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { CopyButton } from '../../components/ui/CopyButton';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input } from '../../components/ui/Field';
import { errorMessage } from '../../lib/api-client';
import { useCreateWebhookEndpoint } from './api';

function SecretOnce({ endpoint }: { endpoint: WebhookEndpoint }) {
  return (
    <div className="space-y-4">
      <Alert tone="success" title="Endpoint created">
        <span className="font-mono text-xs break-all">{endpoint.url}</span>
      </Alert>
      <div>
        <p className="mb-1.5 text-sm font-medium">Signing secret</p>
        <div className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
          <code className="min-w-0 flex-1 font-mono text-xs break-all">{endpoint.secret}</code>
          {endpoint.secret ? (
            <CopyButton value={endpoint.secret} label="Copy secret" showLabel />
          ) : null}
        </div>
        <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-400">
          Use it to verify the <code>Stripe-Signature</code> header. You can reveal it again later
          from the endpoints table.
        </p>
      </div>
    </div>
  );
}

export function CreateEndpointDialog({ onClose }: { onClose: () => void }) {
  const mutation = useCreateWebhookEndpoint();
  const [url, setUrl] = useState('http://host.docker.internal:4242/webhooks');
  const [events, setEvents] = useState<string[]>(['*']);
  const [submitted, setSubmitted] = useState(false);
  const allEvents = events.includes('*');

  const toggle = (type: string) =>
    setEvents((current) =>
      current.includes(type) ? current.filter((value) => value !== type) : [...current, type],
    );

  const urlError = url.trim() ? null : 'Enter the URL that should receive events.';
  const eventsError = events.length === 0 ? 'Select at least one event (or all events).' : null;

  if (mutation.data) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Save your signing secret"
        footer={
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        }
      >
        <SecretOnce endpoint={mutation.data} />
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add webhook endpoint"
      size="lg"
      onSubmit={() => {
        setSubmitted(true);
        if (urlError || eventsError) return;
        mutation.mutate({ url: url.trim(), enabled_events: allEvents ? ['*'] : events });
      }}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={mutation.isPending}>
            Add endpoint
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Endpoint URL"
          error={submitted ? urlError : null}
          hint={
            <>
              From inside Docker use <code>http://host.docker.internal:&lt;port&gt;</code> to reach
              an app running on your machine.
            </>
          }
        >
          <Input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="font-mono text-xs"
            autoFocus
          />
        </Field>
        <fieldset>
          <legend className="text-sm font-medium">Events to send</legend>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allEvents}
              onChange={() => setEvents(allEvents ? [] : ['*'])}
              className="size-4 accent-indigo-600"
            />
            All events (<code>*</code>)
          </label>
          <div className="mt-2 grid max-h-56 gap-1.5 overflow-y-auto rounded-md border border-zinc-200 p-3 sm:grid-cols-2 dark:border-zinc-800">
            {EVENT_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-2 font-mono text-xs">
                <input
                  type="checkbox"
                  checked={allEvents || events.includes(type)}
                  disabled={allEvents}
                  onChange={() => toggle(type)}
                  className="size-4 accent-indigo-600"
                />
                {type}
              </label>
            ))}
          </div>
          {submitted && eventsError ? (
            <p className="mt-1.5 text-xs font-medium text-red-700 dark:text-red-400">
              {eventsError}
            </p>
          ) : null}
        </fieldset>
        {mutation.isError ? <Alert tone="danger">{errorMessage(mutation.error)}</Alert> : null}
      </div>
    </Dialog>
  );
}
