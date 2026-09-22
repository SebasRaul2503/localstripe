import { useSearchParams } from 'react-router';
import { CheckCircle2, XCircle } from 'lucide-react';
import { StatusBadge } from '../../components/ui/Badge';
import { ButtonLink } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { Money } from '../../components/ui/Display';
import { useCheckoutSession } from './api';

export function CheckoutResultPage({ outcome }: { outcome: 'success' | 'cancel' }) {
  const [params] = useSearchParams();
  const sessionId = params.get('session_id') ?? '';
  const session = useCheckoutSession(sessionId);
  const success = outcome === 'success';
  const Icon = success ? CheckCircle2 : XCircle;

  return (
    <div className="mx-auto max-w-lg py-10">
      <Card>
        <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
          <Icon
            className={success ? 'size-12 text-emerald-600' : 'size-12 text-zinc-400'}
            aria-hidden
          />
          <h1 className="text-xl font-semibold">
            {success ? 'Thanks — checkout complete!' : 'Checkout canceled'}
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {success
              ? 'The hosted checkout redirected here after a (simulated) payment.'
              : 'The customer left the hosted checkout page without paying.'}
          </p>
          {session.data ? (
            <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
              <Money amount={session.data.amount_total} currency={session.data.currency} />
              <StatusBadge status={session.data.payment_status} />
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {sessionId ? (
              <ButtonLink
                variant="primary"
                to={`/checkout-sessions/${encodeURIComponent(sessionId)}`}
              >
                View session
              </ButtonLink>
            ) : null}
            <ButtonLink to="/checkout-sessions">All sessions</ButtonLink>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
