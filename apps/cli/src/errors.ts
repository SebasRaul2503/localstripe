import { LocalStripeError } from '@localstripe/sdk';

/** `type/code: message`, as printed to stderr for failed commands. */
export function formatError(error: unknown): string {
  if (error instanceof LocalStripeError) {
    const kind = error.code ? `${error.type}/${error.code}` : error.type;
    const extras = [
      error.declineCode && `decline_code=${error.declineCode}`,
      error.param && `param=${error.param}`,
      error.requestId && `request_id=${error.requestId}`,
    ].filter(Boolean);
    return `${kind}: ${error.message}${extras.length ? ` (${extras.join(', ')})` : ''}`;
  }
  return `error: ${error instanceof Error ? error.message : String(error)}`;
}
