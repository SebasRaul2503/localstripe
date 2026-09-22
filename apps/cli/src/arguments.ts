import { InvalidArgumentError } from 'commander';

export function parseLimit(value: string): number {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new InvalidArgumentError('must be an integer between 1 and 100.');
  }
  return limit;
}

export const choice =
  <T extends string>(allowed: readonly T[]) =>
  (value: string): T => {
    if (!(allowed as readonly string[]).includes(value)) {
      throw new InvalidArgumentError(`must be one of: ${allowed.join(', ')}.`);
    }
    return value as T;
  };

export function parseEventList(value: string): string[] {
  const events = value
    .split(',')
    .map((event) => event.trim())
    .filter(Boolean);
  if (events.length === 0) throw new InvalidArgumentError('expected a comma-separated list.');
  return events;
}

export function parseHttpUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InvalidArgumentError('must be an http(s) URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InvalidArgumentError('must be an http(s) URL.');
  }
  return url.toString();
}

export function parseWebhookSecret(value: string): string {
  if (!value.startsWith('whsec_')) throw new InvalidArgumentError('must start with whsec_.');
  return value;
}
