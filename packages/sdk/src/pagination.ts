import type { List } from '@localstripe/contracts';

export interface ListParams {
  limit?: number;
  starting_after?: string;
  ending_before?: string;
}

/**
 * Iterates over every item of a list endpoint, fetching pages lazily. Follows `starting_after`
 * (newest to oldest) unless `ending_before` is given, in which case it walks backwards.
 */
export async function* autoPaginate<T extends { id: string }, P extends ListParams>(
  fetchPage: (params: P) => Promise<List<T>>,
  params: P,
): AsyncGenerator<T, void, undefined> {
  const backwards = params.ending_before !== undefined && params.starting_after === undefined;
  let current: P = params;
  for (;;) {
    const page = await fetchPage(current);
    const items = backwards ? [...page.data].reverse() : page.data;
    for (const item of items) yield item;
    const last = items.at(-1);
    if (!page.has_more || !last) return;
    current = backwards
      ? { ...current, ending_before: last.id }
      : { ...current, starting_after: last.id };
  }
}
