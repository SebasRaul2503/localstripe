import { Database } from 'lucide-react';
import { Button, type ButtonVariant } from '../../components/ui/Button';
import { useToast } from '../../components/ui/toast';
import { errorMessage } from '../../lib/api-client';
import { useSeed } from './api';

export function SeedButton({ variant = 'secondary' }: { variant?: ButtonVariant }) {
  const seed = useSeed();
  const notify = useToast();
  return (
    <Button
      variant={variant}
      loading={seed.isPending}
      icon={<Database className="size-4" aria-hidden />}
      onClick={() =>
        seed.mutate(undefined, {
          onSuccess: (result) =>
            notify(
              `Demo data loaded: ${result.customers ?? 0} customers, ${result.payment_intents ?? 0} payments.`,
            ),
          onError: (error) => notify(`Could not load demo data: ${errorMessage(error)}`, 'error'),
        })
      }
    >
      Load demo data
    </Button>
  );
}
