/** The previous values of the top-level fields that changed (Stripe's `previous_attributes`). */
export function diff<T extends object>(before: T, after: T): Record<string, unknown> {
  const changed: Record<string, unknown> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changed[key as string] = before[key];
    }
  }
  return changed;
}

export const escapeLike = (value: string): string =>
  value.replace(/[\\%_]/g, (char) => '\\' + char);
