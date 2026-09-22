import type { LocalStripeEvent } from '@localstripe/contracts';
import {
  DEFAULT_SIGNATURE_TOLERANCE_SECONDS,
  buildSignatureHeader,
  verifySignature,
  type SignatureVerificationFailure,
} from '@localstripe/contracts/signature';
import { LocalStripeError } from './errors.js';

export const SIGNATURE_HEADER = 'localstripe-signature';
/** The API also sends the signature under Stripe's header name so stripe-node works unchanged. */
export const STRIPE_SIGNATURE_HEADER = 'stripe-signature';

export type WebhookVerificationFailureReason =
  SignatureVerificationFailure | 'missing_header' | 'invalid_payload';

export class WebhookSignatureVerificationError extends LocalStripeError {
  readonly reason: WebhookVerificationFailureReason;

  constructor(reason: WebhookVerificationFailureReason, message: string) {
    super({ type: 'signature_verification_error', code: reason, message });
    this.reason = reason;
  }
}

const MESSAGES: Record<WebhookVerificationFailureReason, string> = {
  missing_header: 'No signature header was provided (expected `LocalStripe-Signature`).',
  malformed_header: 'Unable to extract a timestamp and v1 signature from the signature header.',
  no_matching_signature:
    'No signature matches the expected signature for the payload. Are you passing the raw request body and the right whsec_ secret?',
  timestamp_outside_tolerance: 'The signature timestamp is outside the tolerance window.',
  invalid_payload: 'The webhook payload is not valid JSON.',
};

export type WebhookPayload = string | Uint8Array;

const toText = (payload: WebhookPayload) =>
  typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf8');

export interface GenerateTestHeaderOptions {
  payload: WebhookPayload;
  secret: string;
  /** Unix seconds; defaults to now. */
  timestamp?: number;
}

export const webhooks = {
  /**
   * Verifies the signature of a webhook request and returns the parsed event. `payload` must be
   * the raw request body, exactly as received.
   */
  constructEvent(
    payload: WebhookPayload,
    header: string | string[] | undefined,
    secret: string,
    toleranceSeconds: number = DEFAULT_SIGNATURE_TOLERANCE_SECONDS,
  ): LocalStripeEvent {
    const headerValue = Array.isArray(header) ? header.join(',') : header;
    if (!headerValue) {
      throw new WebhookSignatureVerificationError('missing_header', MESSAGES.missing_header);
    }
    const text = toText(payload);
    const result = verifySignature(text, headerValue, secret, { toleranceSeconds });
    if (!result.ok)
      throw new WebhookSignatureVerificationError(result.reason, MESSAGES[result.reason]);
    try {
      return JSON.parse(text) as LocalStripeEvent;
    } catch {
      throw new WebhookSignatureVerificationError('invalid_payload', MESSAGES.invalid_payload);
    }
  },

  /** Builds a valid signature header, for testing webhook handlers. */
  generateTestHeaderString({ payload, secret, timestamp }: GenerateTestHeaderOptions): string {
    return buildSignatureHeader(
      toText(payload),
      secret,
      timestamp ?? Math.floor(Date.now() / 1000),
    );
  },
};

export type Webhooks = typeof webhooks;
