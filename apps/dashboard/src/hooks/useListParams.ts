import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { List } from '@localstripe/contracts';

export const PAGE_SIZE = 20;

export interface PageState {
  hasPrevious: boolean;
  hasNext: boolean;
  goPrevious: () => void;
  goNext: () => void;
}

/**
 * List filters and Stripe-style cursors (`starting_after` / `ending_before`) kept in the URL,
 * so pages are linkable and survive reloads. Changing a filter resets the cursor.
 */
export function useListParams<const F extends readonly string[]>(filterKeys: F) {
  const [searchParams, setSearchParams] = useSearchParams();
  const startingAfter = searchParams.get('starting_after') ?? undefined;
  const endingBefore = searchParams.get('ending_before') ?? undefined;

  const filters = useMemo(() => {
    const values = {} as Record<F[number], string>;
    for (const key of filterKeys as readonly F[number][]) values[key] = searchParams.get(key) ?? '';
    return values;
  }, [filterKeys, searchParams]);

  const setFilter = useCallback(
    (key: F[number], value: string) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        next.delete('starting_after');
        next.delete('ending_before');
        return next;
      });
    },
    [setSearchParams],
  );

  const setCursor = useCallback(
    (cursor: { starting_after?: string; ending_before?: string }) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete('starting_after');
        next.delete('ending_before');
        if (cursor.starting_after) next.set('starting_after', cursor.starting_after);
        if (cursor.ending_before) next.set('ending_before', cursor.ending_before);
        return next;
      });
    },
    [setSearchParams],
  );

  const cursor = { limit: PAGE_SIZE, starting_after: startingAfter, ending_before: endingBefore };

  const pageState = (list: List<{ id: string }> | undefined): PageState => {
    const data = list?.data ?? [];
    const first = data[0]?.id;
    const last = data[data.length - 1]?.id;
    const hasMore = list?.has_more ?? false;
    const movingBack = Boolean(endingBefore);
    return {
      hasPrevious: Boolean(first) && (movingBack ? hasMore : Boolean(startingAfter)),
      hasNext: Boolean(last) && (movingBack ? true : hasMore),
      goPrevious: () => (first ? setCursor({ ending_before: first }) : undefined),
      goNext: () => (last ? setCursor({ starting_after: last }) : undefined),
    };
  };

  return { filters, setFilter, cursor, pageState };
}
