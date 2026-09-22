export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<string, Tone> = {
  succeeded: 'success',
  paid: 'success',
  complete: 'success',
  enabled: 'success',
  active: 'success',
  processing: 'info',
  requires_action: 'warning',
  requires_confirmation: 'warning',
  pending: 'warning',
  open: 'info',
  unpaid: 'warning',
  requires_payment_method: 'neutral',
  failed: 'danger',
  declined: 'danger',
  revoked: 'danger',
  canceled: 'neutral',
  expired: 'neutral',
  disabled: 'neutral',
  no_payment_required: 'neutral',
};

export function statusTone(status: string): Tone {
  return TONES[status] ?? 'neutral';
}

export function humanize(value: string): string {
  const text = value.replace(/[_.]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
