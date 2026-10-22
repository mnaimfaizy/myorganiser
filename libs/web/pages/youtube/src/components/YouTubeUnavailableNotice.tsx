'use client';

import { Button, Illustration } from '@myorganiser/web-ui';
import { requestYouTubeAvailabilityRecheck } from '@myorganiser/web-youtube';
import Link from 'next/link';
import { useCallback } from 'react';

interface YouTubeUnavailableNoticeProps {
  /**
   * `unavailable`: the availability check answered false (switched off, or no
   * YouTube Access). `unreachable`: the check itself errored, so the notice
   * offers Try again. Callers pass `unreachable` when the hook's `error` is set.
   */
  reason?: 'unavailable' | 'unreachable';
  /** When set, Back to Dashboard uses this handler (OAuth callback uses router.replace). When omitted, navigate with a Link to /dashboard. */
  onBack?: () => void;
}

export function YouTubeUnavailableNotice({
  reason = 'unavailable',
  onBack,
}: YouTubeUnavailableNoticeProps) {
  const isUnreachable = reason === 'unreachable';

  const handleRetry = useCallback(() => {
    requestYouTubeAvailabilityRecheck();
  }, []);

  const backButton = onBack ? (
    <Button type="button" variant="outline" onClick={onBack}>
      Back to Dashboard
    </Button>
  ) : (
    <Button asChild variant="outline">
      <Link href="/dashboard">Back to Dashboard</Link>
    </Button>
  );

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8">
      <div
        role={isUnreachable ? 'status' : undefined}
        className="flex w-full max-w-[420px] flex-col items-center gap-4 rounded-panel border border-border bg-raised-surface p-7 text-center"
      >
        <Illustration kind="youtube" size={96} />
        {isUnreachable ? (
          <p className="text-label-caps text-muted-foreground">TEMPORARY</p>
        ) : null}
        <h1 className="font-display text-title text-foreground">
          {isUnreachable
            ? "YouTube can't be reached right now"
            : 'YouTube is not available right now'}
        </h1>
        <p className="text-body text-muted-foreground">
          {isUnreachable
            ? "We couldn't check your YouTube connection. Your cached uploads are safe. Try again in a few minutes."
            : 'Please try again later.'}
        </p>
        {isUnreachable ? (
          <Button type="button" variant="brand" onClick={handleRetry}>
            Try again
          </Button>
        ) : null}
        {backButton}
      </div>
    </div>
  );
}
