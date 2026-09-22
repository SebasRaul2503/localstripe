import { z } from 'zod';

/**
 * Stripe clients send `application/x-www-form-urlencoded` bodies, so every scalar can arrive as a
 * string. These helpers accept both native JSON values and their string encodings.
 */
export const integer = (options: { min?: number; max?: number } = {}) =>
  z
    .union([z.number(), z.string().regex(/^-?\d+$/, 'must be an integer')])
    .transform(Number)
    .pipe(
      z
        .number()
        .int()
        .min(options.min ?? Number.MIN_SAFE_INTEGER)
        .max(options.max ?? Number.MAX_SAFE_INTEGER),
    );

export const boolean = () =>
  z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true');

/** A settable string where `""` means "unset" (Stripe convention). */
export const nullableString = (max = 5000) =>
  z
    .string()
    .max(max)
    .transform((value) => (value === '' ? null : value));

export const email = () =>
  z.union([z.literal(''), z.email().max(512)]).transform((value) => (value === '' ? null : value));

export const httpUrl = () => z.url({ protocol: /^https?$/ }).max(2048);

export const currency = () =>
  z
    .string()
    .regex(/^[a-zA-Z]{3}$/, 'must be a three-letter ISO currency code')
    .transform((value) => value.toLowerCase());

export const amount = () => integer({ min: 1, max: 99_999_999 });

export const MAX_METADATA_KEYS = 50;

/**
 * `metadata[key]=""` deletes a key and `metadata=""` clears all keys (Stripe semantics).
 * `null` values in the parsed result mean "delete this key".
 */
export const metadata = () =>
  z.union([
    z.literal('').transform(() => null),
    z
      .record(z.string().min(1).max(40), z.union([z.string().max(500), z.number(), z.boolean()]))
      .refine((value) => Object.keys(value).length <= MAX_METADATA_KEYS, {
        message: `cannot have more than ${MAX_METADATA_KEYS} keys`,
      })
      .transform(
        (value) =>
          Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, entry === '' ? null : String(entry)]),
          ) as Record<string, string | null>,
      ),
  ]);

export type MetadataInput = Record<string, string | null> | null | undefined;

export function applyMetadata(
  current: Record<string, string>,
  update: MetadataInput,
): Record<string, string> {
  if (update === undefined) return current;
  if (update === null) return {};
  const next = { ...current };
  for (const [key, value] of Object.entries(update)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

export const createMetadata = (update: MetadataInput): Record<string, string> =>
  applyMetadata({}, update);

export const expandParam = z.union([z.array(z.string()), z.string()]).optional();

export const addressInput = () =>
  z.strictObject({
    city: nullableString(200).optional(),
    country: nullableString(2).optional(),
    line1: nullableString(200).optional(),
    line2: nullableString(200).optional(),
    postal_code: nullableString(20).optional(),
    state: nullableString(200).optional(),
  });

export const idParam = z.object({ id: z.string().min(1).max(255) });
