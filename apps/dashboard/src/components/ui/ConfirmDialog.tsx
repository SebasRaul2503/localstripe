import { useState, type ReactNode } from 'react';
import { errorMessage } from '../../lib/api-client';
import { Alert } from './Alert';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Field, Input } from './Field';

interface ConfirmDialogProps {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** When set, the user must type this text before confirming. */
  typeToConfirm?: string;
  pending: boolean;
  error: unknown;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  title,
  description,
  children,
  confirmLabel,
  danger = false,
  typeToConfirm,
  pending,
  error,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const blocked = typeToConfirm !== undefined && typed.trim() !== typeToConfirm;

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description={description}
      onSubmit={() => {
        if (!blocked) onConfirm();
      }}
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant={danger ? 'danger' : 'primary'}
            loading={pending}
            disabled={blocked}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {children}
        {typeToConfirm !== undefined ? (
          <Field label={`Type "${typeToConfirm}" to confirm`}>
            <Input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              autoFocus
            />
          </Field>
        ) : null}
        {error ? <Alert tone="danger">{errorMessage(error)}</Alert> : null}
      </div>
    </Dialog>
  );
}
