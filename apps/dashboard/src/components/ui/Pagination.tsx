import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PageState } from '../../hooks/useListParams';
import { Button } from './Button';

export function Pagination({ page, count }: { page: PageState; count: number }) {
  if (!page.hasNext && !page.hasPrevious) {
    return count > 0 ? (
      <p className="border-t border-zinc-200 px-4 py-2.5 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        {count} {count === 1 ? 'result' : 'results'}
      </p>
    ) : null;
  }
  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-2 border-t border-zinc-200 px-4 py-2.5 dark:border-zinc-800"
    >
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Showing {count} {count === 1 ? 'result' : 'results'}
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={page.goPrevious}
          disabled={!page.hasPrevious}
          icon={<ChevronLeft className="size-3.5" aria-hidden />}
        >
          Previous
        </Button>
        <Button size="sm" onClick={page.goNext} disabled={!page.hasNext}>
          Next
          <ChevronRight className="size-3.5" aria-hidden />
        </Button>
      </div>
    </nav>
  );
}
