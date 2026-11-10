'use client';

import { Button } from '@myorganiser/web-ui';
import { useEffect, useRef } from 'react';

export interface PhoneLoadMoreFooterProps {
  /** Rows on screen so far. */
  shownCount: number;
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  /** The last append failed. The rows stay; the sentinel does not retry. */
  loadMoreError: boolean;
  /** Shown in place of the count while a load-more error is present. */
  errorMessage: string;
  /** Shown while loading more. Omit to show the count instead. */
  loadingMoreMessage?: string;
  onLoadMore: () => void;
  /**
   * Re-requests the page that failed to append. Present → the error line gains
   * a Try again button.
   */
  onRetry?: () => void;
}

/**
 * The phone load-more tail: an invisible sentinel that asks for the next page
 * when it scrolls into view, then the error line or the count below it.
 */
export function PhoneLoadMoreFooter({
  shownCount,
  total,
  hasMore,
  loadingMore,
  loadMoreError,
  errorMessage,
  loadingMoreMessage,
  onLoadMore,
  onRetry,
}: PhoneLoadMoreFooterProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  // The sticky admin tab bar covers the tail where the sentinel triggers the
  // fetch, so a failure lands behind it. Bring the error block clear of the bar
  // once per failure; 'nearest' is a no-op when it is already fully visible.
  useEffect(() => {
    const node = errorRef.current;
    if (!loadMoreError || node === null) return;
    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView?.({
      block: 'nearest',
      behavior: reduceMotion ? 'instant' : 'smooth',
    });
  }, [loadMoreError]);

  useEffect(() => {
    let observer: IntersectionObserver | undefined;
    const node = sentinelRef.current;

    // jsdom has no IntersectionObserver; there the list simply does not grow.
    // After a failed append the sentinel stays quiet: no retry loop.
    if (
      node !== null &&
      hasMore &&
      !loadingMore &&
      !loadMoreError &&
      typeof IntersectionObserver !== 'undefined'
    ) {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMore();
        }
      });
      observer.observe(node);
    }

    return () => observer?.disconnect();
  }, [hasMore, loadingMore, loadMoreError, onLoadMore]);

  const countLabel =
    shownCount === 0
      ? null
      : hasMore
        ? `Scroll for more · ${shownCount} of ${total}`
        : `${shownCount} of ${total}`;

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      {loadMoreError ? (
        <div
          ref={errorRef}
          className="flex flex-col items-center gap-2"
          style={{ scrollMarginBottom: 'var(--toast-offset, 0px)' }}
        >
          <p className="text-center text-caption text-destructive">
            {errorMessage}
          </p>
          {onRetry !== undefined ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : loadingMore && loadingMoreMessage !== undefined ? (
        <p className="text-center text-caption text-muted-foreground">
          {loadingMoreMessage}
        </p>
      ) : countLabel !== null ? (
        <p className="text-center text-caption text-muted-foreground">
          {countLabel}
        </p>
      ) : null}
    </>
  );
}
