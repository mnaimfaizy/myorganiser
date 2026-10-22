'use client';

import { Button } from '@myorganiser/web-ui';
import { useCallback } from 'react';

import { formatFeedbackShowingRange } from '../../../lib/feedbackInbox';

export interface FeedbackInboxPagerProps {
  page: number;
  pageSize: number;
  /** Rows on the current page. */
  shownCount: number;
  total: number;
  /** Changes the range wording to "matching reports". */
  filtered: boolean;
  onPageChange: (page: number) => void;
}

/** The desktop footer: the range, then Newer (the page before) and Older (the page after). */
export function FeedbackInboxPager({
  page,
  pageSize,
  shownCount,
  total,
  filtered,
  onPageChange,
}: FeedbackInboxPagerProps) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  const handleNewer = useCallback(
    () => onPageChange(page - 1),
    [onPageChange, page],
  );

  const handleOlder = useCallback(
    () => onPageChange(page + 1),
    [onPageChange, page],
  );

  return (
    <nav
      aria-label="Pages"
      className="flex items-center gap-2 border-t border-border-subtle px-5 py-3"
    >
      <span className="flex-1 text-body-sm text-muted-foreground">
        {formatFeedbackShowingRange(
          page,
          pageSize,
          shownCount,
          total,
          filtered,
        )}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleNewer}
        disabled={page <= 1}
      >
        Newer
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleOlder}
        disabled={page >= lastPage}
      >
        Older
      </Button>
    </nav>
  );
}
