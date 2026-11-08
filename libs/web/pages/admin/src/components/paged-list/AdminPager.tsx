'use client';

import { Button, cn } from '@myorganiser/web-ui';
import { useCallback } from 'react';

export interface AdminPagerProps {
  /** The 1-based page on screen. */
  page: number;
  pageSize: number;
  total: number;
  /** The range wording, computed by the caller for its noun. */
  range: string;
  /** Labels the page before. */
  previousLabel: string;
  /** Labels the page after. */
  nextLabel: string;
  /**
   * Extra classes for the nav. They sit between the base row classes and the
   * padding so each caller's class string keeps its existing order.
   */
  className?: string;
  onPageChange: (page: number) => void;
}

/** The desktop footer: the range, then the previous and next page buttons. */
export function AdminPager({
  page,
  pageSize,
  total,
  range,
  previousLabel,
  nextLabel,
  className,
  onPageChange,
}: AdminPagerProps) {
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
    <nav
      aria-label="Pages"
      className={cn('flex items-center gap-2', className, 'px-5 py-3')}
    >
      <span className="flex-1 text-body-sm text-muted-foreground">{range}</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handlePrevious}
        disabled={page <= 1}
      >
        {previousLabel}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleNext}
        disabled={page >= lastPage}
      >
        {nextLabel}
      </Button>
    </nav>
  );
}
