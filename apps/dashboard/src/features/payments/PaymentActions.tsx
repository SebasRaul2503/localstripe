import { useState } from 'react';
import { RotateCcw, ShieldCheck, ShieldX, XCircle } from 'lucide-react';
import type { PaymentIntent } from '@localstripe/contracts';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/toast';
import { errorMessage } from '../../lib/api-client';
import { humanize } from '../../lib/status';
import { useAuthenticatePaymentIntent, useCancelPaymentIntent } from './api';
import { RefundDialog } from './RefundDialog';

const CANCELABLE: readonly string[] = [
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
];

export function PaymentActions({
  payment,
  refundable,
}: {
  payment: PaymentIntent;
  /** Remaining refundable amount in minor units (from the latest charge), if known. */
  refundable: number | null;
}) {
  const [dialog, setDialog] = useState<'refund' | 'cancel' | null>(null);
  const cancel = useCancelPaymentIntent(payment.id);
  const authenticate = useAuthenticatePaymentIntent(payment.id);
  const notify = useToast();

  const runAuthentication = (outcome: 'succeed' | 'fail') =>
    authenticate.mutate(outcome, {
      onSuccess: (result) =>
        notify(
          `3D Secure ${outcome === 'succeed' ? 'completed' : 'failed'}: payment is now ${humanize(result.status).toLowerCase()}.`,
        ),
      onError: (error) => notify(errorMessage(error), 'error'),
    });

  return (
    <>
      {payment.status === 'requires_action' ? (
        <>
          <Button
            variant="primary"
            icon={<ShieldCheck className="size-4" aria-hidden />}
            loading={authenticate.isPending && authenticate.variables === 'succeed'}
            disabled={authenticate.isPending}
            onClick={() => runAuthentication('succeed')}
          >
            Complete 3DS
          </Button>
          <Button
            icon={<ShieldX className="size-4" aria-hidden />}
            loading={authenticate.isPending && authenticate.variables === 'fail'}
            disabled={authenticate.isPending}
            onClick={() => runAuthentication('fail')}
          >
            Fail 3DS
          </Button>
        </>
      ) : null}
      {refundable !== null && refundable > 0 ? (
        <Button
          icon={<RotateCcw className="size-4" aria-hidden />}
          onClick={() => setDialog('refund')}
        >
          Refund
        </Button>
      ) : null}
      {CANCELABLE.includes(payment.status) ? (
        <Button
          variant="danger"
          icon={<XCircle className="size-4" aria-hidden />}
          onClick={() => setDialog('cancel')}
        >
          Cancel payment
        </Button>
      ) : null}

      {dialog === 'refund' && refundable !== null ? (
        <RefundDialog
          paymentIntentId={payment.id}
          remaining={refundable}
          currency={payment.currency}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'cancel' ? (
        <ConfirmDialog
          title="Cancel this payment?"
          description="The PaymentIntent moves to canceled and can no longer be confirmed."
          confirmLabel="Cancel payment"
          danger
          pending={cancel.isPending}
          error={cancel.error}
          onClose={() => setDialog(null)}
          onConfirm={() =>
            cancel.mutate(undefined, {
              onSuccess: () => {
                notify('Payment canceled.');
                setDialog(null);
              },
            })
          }
        />
      ) : null}
    </>
  );
}
