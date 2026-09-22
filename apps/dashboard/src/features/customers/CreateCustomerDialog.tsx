import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, Textarea } from '../../components/ui/Field';
import { useToast } from '../../components/ui/toast';
import { ApiError, errorMessage } from '../../lib/api-client';
import { useCreateCustomer } from './api';

export function CreateCustomerDialog({ onClose }: { onClose: () => void }) {
  const mutation = useCreateCustomer();
  const navigate = useNavigate();
  const notify = useToast();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const fieldError = (param: string) =>
    mutation.error instanceof ApiError && mutation.error.param === param
      ? mutation.error.message
      : null;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Create customer"
      onSubmit={() =>
        mutation.mutate(
          {
            ...(email.trim() ? { email: email.trim() } : {}),
            ...(name.trim() ? { name: name.trim() } : {}),
            ...(description.trim() ? { description: description.trim() } : {}),
          },
          {
            onSuccess: (customer) => {
              notify(`Customer ${customer.id} created.`);
              onClose();
              void navigate(`/customers/${customer.id}`);
            },
          },
        )
      }
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={mutation.isPending}>
            Create customer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Email" optional error={fieldError('email')}>
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="jenny@example.com"
            autoFocus
          />
        </Field>
        <Field label="Name" optional error={fieldError('name')}>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Description" optional error={fieldError('description')}>
          <Textarea
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        {mutation.isError && !(mutation.error instanceof ApiError && mutation.error.param) ? (
          <Alert tone="danger">{errorMessage(mutation.error)}</Alert>
        ) : null}
      </div>
    </Dialog>
  );
}
