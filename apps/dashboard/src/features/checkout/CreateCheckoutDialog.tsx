import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, Select } from '../../components/ui/Field';
import { useToast } from '../../components/ui/toast';
import { ApiError, errorMessage } from '../../lib/api-client';
import { COMMON_CURRENCIES, toMinorUnits } from '../../lib/money';
import { useCreateCheckoutSession } from './api';

function defaultUrl(path: string) {
  return `${window.location.origin}${path}?session_id={CHECKOUT_SESSION_ID}`;
}

export function CreateCheckoutDialog({ onClose }: { onClose: () => void }) {
  const mutation = useCreateCheckoutSession();
  const navigate = useNavigate();
  const notify = useToast();
  const [name, setName] = useState('LocalStripe T-shirt');
  const [unitAmount, setUnitAmount] = useState('25.00');
  const [quantity, setQuantity] = useState('1');
  const [currency, setCurrency] = useState('usd');
  const [successUrl, setSuccessUrl] = useState(() => defaultUrl('/checkout/success'));
  const [cancelUrl, setCancelUrl] = useState(() => defaultUrl('/checkout/cancel'));
  const [submitted, setSubmitted] = useState(false);

  const minor = toMinorUnits(unitAmount, currency);
  const qty = Number(quantity);
  const errors = {
    name: name.trim() ? null : 'Enter a product name.',
    unitAmount: minor === null ? 'Enter a valid amount.' : null,
    quantity: Number.isInteger(qty) && qty >= 1 ? null : 'Quantity must be a whole number ≥ 1.',
    successUrl: successUrl.trim() ? null : 'A success URL is required.',
  };
  const apiParam = mutation.error instanceof ApiError ? mutation.error.param : undefined;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Create Checkout Session"
      description="A one-item payment session with a hosted checkout page."
      size="lg"
      onSubmit={() => {
        setSubmitted(true);
        if (Object.values(errors).some(Boolean) || minor === null) return;
        mutation.mutate(
          {
            name: name.trim(),
            unitAmount: minor,
            quantity: qty,
            currency,
            successUrl: successUrl.trim(),
            cancelUrl: cancelUrl.trim() || undefined,
          },
          {
            onSuccess: (session) => {
              notify(`Checkout Session ${session.id} created.`);
              onClose();
              void navigate(`/checkout-sessions/${session.id}`);
            },
          },
        );
      }}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={mutation.isPending}>
            Create session
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Product name"
          className="sm:col-span-2"
          error={submitted ? errors.name : null}
        >
          <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </Field>
        <Field
          label="Unit amount"
          hint="In major units"
          error={submitted ? errors.unitAmount : null}
        >
          <Input
            inputMode="decimal"
            value={unitAmount}
            onChange={(event) => setUnitAmount(event.target.value)}
          />
        </Field>
        <Field label="Currency">
          <Select value={currency} onChange={(event) => setCurrency(event.target.value)}>
            {COMMON_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code.toUpperCase()}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quantity" error={submitted ? errors.quantity : null}>
          <Input
            inputMode="numeric"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </Field>
        <div />
        <Field
          label="Success URL"
          className="sm:col-span-2"
          hint="{CHECKOUT_SESSION_ID} is replaced with the session ID."
          error={
            submitted
              ? errors.successUrl
              : apiParam === 'success_url'
                ? errorMessage(mutation.error)
                : null
          }
        >
          <Input
            value={successUrl}
            onChange={(event) => setSuccessUrl(event.target.value)}
            className="font-mono text-xs"
          />
        </Field>
        <Field label="Cancel URL" optional className="sm:col-span-2">
          <Input
            value={cancelUrl}
            onChange={(event) => setCancelUrl(event.target.value)}
            className="font-mono text-xs"
          />
        </Field>
        {mutation.isError && apiParam !== 'success_url' ? (
          <Alert tone="danger" className="sm:col-span-2">
            {errorMessage(mutation.error)}
          </Alert>
        ) : null}
      </div>
    </Dialog>
  );
}
