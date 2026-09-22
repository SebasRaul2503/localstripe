import { useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, Select } from '../../components/ui/Field';
import { errorMessage } from '../../lib/api-client';
import { COMMON_CURRENCIES, formatMoney, isZeroDecimal, toMinorUnits } from '../../lib/money';
import { humanize } from '../../lib/status';
import { useTestCards } from '../test-cards/api';
import { useCreateTestPayment, type TestPaymentResult } from './api';

function ResultView({ result }: { result: TestPaymentResult }) {
  const pi = result.paymentIntent;
  const link = pi ? (
    <Link to={`/payments/${pi.id}`} className="font-mono text-xs underline">
      {pi.id}
    </Link>
  ) : null;

  if (result.outcome === 'declined') {
    return (
      <Alert tone="warning" title="Payment declined (expected test outcome)">
        <p>{result.error.message}</p>
        <p className="mt-1 text-xs">
          Code: <code>{result.error.code ?? 'n/a'}</code>
          {result.error.declineCode ? (
            <>
              {' '}
              · Decline code: <code>{result.error.declineCode}</code>
            </>
          ) : null}
        </p>
        {link ? <p className="mt-1">Payment intent: {link}</p> : null}
      </Alert>
    );
  }

  const tone = pi?.status === 'succeeded' ? 'success' : 'info';
  return (
    <Alert tone={tone} title={`Payment created — ${humanize(pi?.status ?? 'unknown')}`}>
      {pi?.status === 'requires_action' ? (
        <p>This card requires 3D Secure. Open the payment to complete or fail the challenge.</p>
      ) : null}
      {pi?.status === 'processing' ? (
        <p>The payment is processing and will settle asynchronously.</p>
      ) : null}
      {link ? <p className="mt-1">Payment intent: {link}</p> : null}
    </Alert>
  );
}

export function CreatePaymentDialog({
  onClose,
  defaultCustomer = '',
}: {
  onClose: () => void;
  defaultCustomer?: string;
}) {
  const cards = useTestCards();
  const mutation = useCreateTestPayment();
  const [amount, setAmount] = useState('20.00');
  const [currency, setCurrency] = useState('usd');
  const [cardId, setCardId] = useState('');
  const [customer, setCustomer] = useState(defaultCustomer);
  const [delay, setDelay] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const cardList = cards.data?.data ?? [];
  const selectedCard = cardList.find((card) => card.id === cardId) ?? cardList[0];
  const minor = toMinorUnits(amount, currency);
  const amountError =
    minor === null || minor <= 0
      ? isZeroDecimal(currency)
        ? 'Enter a whole amount greater than 0 (this currency has no decimals).'
        : 'Enter an amount greater than 0 with at most 2 decimals.'
      : null;
  const delayValue = delay.trim() === '' ? undefined : Number(delay);
  const delayError =
    delayValue !== undefined && (!Number.isInteger(delayValue) || delayValue < 0)
      ? 'Use a whole number of milliseconds.'
      : null;

  const submit = () => {
    setSubmitted(true);
    if (amountError || delayError || !selectedCard || minor === null) return;
    mutation.mutate({
      amount: minor,
      currency,
      cardNumber: selectedCard.number,
      customer: customer.trim() || undefined,
      delayMs: delayValue,
    });
  };

  const result = mutation.data;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Create test payment"
      description="Creates a card payment method from a test card and confirms a PaymentIntent with it."
      size="lg"
      onSubmit={submit}
      footer={
        result ? (
          <>
            <Button onClick={() => mutation.reset()}>Create another</Button>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={mutation.isPending}
              disabled={!selectedCard}
            >
              Create payment
              {minor && !amountError ? ` · ${formatMoney(minor, currency)}` : ''}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <ResultView result={result} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Amount"
            error={submitted ? amountError : null}
            hint="In major units, e.g. 20.00"
          >
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              autoFocus
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
          <Field
            label="Test card"
            className="sm:col-span-2"
            error={cards.isError ? `Could not load test cards: ${errorMessage(cards.error)}` : null}
            hint={
              selectedCard
                ? `${selectedCard.number} · ${humanize(selectedCard.scenario)} — ${selectedCard.description}`
                : undefined
            }
          >
            <Select
              value={selectedCard?.id ?? ''}
              onChange={(event) => setCardId(event.target.value)}
              disabled={cards.isPending}
            >
              {cards.isPending ? <option>Loading test cards…</option> : null}
              {cardList.map((card) => (
                <option key={card.id} value={card.id}>
                  {card.label} ({card.number.slice(-4)}) — {humanize(card.scenario)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Customer ID"
            optional
            hint="Attach the payment to an existing customer (cus_…)."
          >
            <Input
              value={customer}
              onChange={(event) => setCustomer(event.target.value)}
              placeholder="cus_…"
              className="font-mono text-xs"
            />
          </Field>
          <Field
            label="Processing delay (ms)"
            optional
            error={submitted ? delayError : null}
            hint="Sent as the LocalStripe-Delay-Ms header."
          >
            <Input
              inputMode="numeric"
              value={delay}
              onChange={(event) => setDelay(event.target.value)}
              placeholder="0"
            />
          </Field>
          {mutation.isError ? (
            <Alert tone="danger" className="sm:col-span-2">
              {errorMessage(mutation.error)}
            </Alert>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
