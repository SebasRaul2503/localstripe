import { useState } from 'react';
import { API_KEY_TYPES, type ApiKeyType } from '@localstripe/contracts';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { CopyButton } from '../../components/ui/CopyButton';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, Select } from '../../components/ui/Field';
import { errorMessage } from '../../lib/api-client';
import { humanize } from '../../lib/status';
import { useCreateApiKey } from './api';

export function CreateApiKeyDialog({ onClose }: { onClose: () => void }) {
  const mutation = useCreateApiKey();
  const [type, setType] = useState<ApiKeyType>('secret');
  const [name, setName] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const nameError = name.trim() ? null : 'Give the key a name so you can recognise it later.';
  const created = mutation.data;

  if (created) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Copy your new key"
        footer={
          <Button variant="primary" onClick={onClose}>
            I have copied the key
          </Button>
        }
      >
        <div className="space-y-4">
          {created.type === 'secret' ? (
            <Alert tone="warning" title="This is the only time the full secret key is shown">
              Store it somewhere safe (e.g. your app's <code>.env</code>). If you lose it, revoke it
              and create a new one.
            </Alert>
          ) : null}
          <div className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
            <code className="min-w-0 flex-1 font-mono text-xs break-all">{created.secret}</code>
            {created.secret ? (
              <CopyButton value={created.secret} label="Copy key" showLabel />
            ) : null}
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Create API key"
      onSubmit={() => {
        setSubmitted(true);
        if (!nameError) mutation.mutate({ type, name: name.trim() });
      }}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={mutation.isPending}>
            Create key
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" error={submitted ? nameError : null}>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Backend integration tests"
            maxLength={100}
            autoFocus
          />
        </Field>
        <Field
          label="Type"
          hint="Secret keys (sk_test_…) are for servers; publishable keys (pk_test_…) are safe in browsers."
        >
          <Select value={type} onChange={(event) => setType(event.target.value as ApiKeyType)}>
            {API_KEY_TYPES.map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </Select>
        </Field>
        {mutation.isError ? <Alert tone="danger">{errorMessage(mutation.error)}</Alert> : null}
      </div>
    </Dialog>
  );
}
