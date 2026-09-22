import { useState } from 'react';
import { REFUND_REASONS, type RefundReason } from '@localstripe/contracts';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, Select } from '../../components/ui/Field';
import { useToast } from '../../components/ui/toast';
import { errorMessage } from '../../lib/api-client';
import { formatMoney, toMajorUnits, toMinorUnits, currencyExponent } from '../../lib/money';
import { humanize } from '../../lib/status';
import { useCreateRefund } from './api';

export function RefundDialog({
  paymentIntentId,
  remaining,
  currency,
  onClose,
}: {
  paymentIntentId: string;
  remaining: number;
  currency: string;
  onClose: () => void;
}) {
  const mutation = useCreateRefund(paymentIntentId);
  const notify = useToast();
  const [amount, setAmount] = useState(
    toMajorUnits(remaining, currency).toFixed(currencyExponent(currency)),
  );
  const [reason, setReason] = useState<RefundReason | ''>('');
  const minor = toMinorUnits(amount, currency);
  const amountError = minor === null || minor <= 0 ? 'Enter a valid amount greater than 0.' : null;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Refund payment"
      description={`Up to ${formatMoney(remaining, currency)} can still be refunded.`}
      onSubmit={() => {
        if (minor === null || amountError) return;
        mutation.mutate(
          { amount: minor, reason: reason || undefined },
          {
            onSuccess: (refund) => {
              notify(
                `Refund ${refund.id} created (${formatMoney(refund.amount, refund.currency)}).`,
              );
              onClose();
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
            Refund {minor && !amountError ? formatMoney(minor, currency) : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={`Amount (${currency.toUpperCase()})`} error={amountError}>
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Reason" optional>
          <Select
            value={reason}
            onChange={(event) => setReason(event.target.value as RefundReason | '')}
          >
            <option value="">No reason</option>
            {REFUND_REASONS.map((value) => (
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
