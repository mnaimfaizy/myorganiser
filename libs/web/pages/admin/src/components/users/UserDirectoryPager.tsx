'use client';

import { Button } from '@myorganiser/web-ui';
import { useCallback } from 'react';

import { formatShowingRange } from '../../lib/userDirectory';

export interface UserDirectoryPagerProps {
  page: number;
  pageSize: number;
  /** Rows on the current page. */
  shownCount: number;
  total: number;
  onPageChange: (page: number) => void;
}

/** The desktop footer: the range, then Previous and Next. */
export function UserDirectoryPager({
  page,
  pageSize,
  shownCount,
  total,
  onPageChange,
}: UserDirectoryPagerProps) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  const handlePrevious = useCallback(
    () => onPageChange(page - 1),
    [onPageChange, page],
  );

  const handleNext = useCallback(
    () => onPageChange(page + 1),
    [onPageChange, page],
  );

  return (
    <nav aria-label="Pages" className="flex items-center gap-2 px-5 py-3">
      <span className="flex-1 text-body-sm text-muted-foreground">
        {formatShowingRange(page, pageSize, shownCount, total)}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handlePrevious}
        disabled={page <= 1}
      >
        Previous
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleNext}
        disabled={page >= lastPage}
      >
        Next
      </Button>
    </nav>
  );
}
