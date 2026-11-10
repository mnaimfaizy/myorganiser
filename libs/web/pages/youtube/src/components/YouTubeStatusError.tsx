'use client';

import { Button } from '@myorganiser/web-ui';

interface YouTubeStatusErrorProps {
  /** Re-runs the connection-status check. */
  onRetry: () => void | Promise<void>;
}

/**
 * Shown when the YouTube connection-status request fails, so the User sees why
 * the page is empty and can try again instead of landing on a bare prompt.
 */
export function YouTubeStatusError({ onRetry }: YouTubeStatusErrorProps) {
  return (
    <div
      role="alert"
      className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <p className="text-body text-destructive-text">
        Could not check your YouTube connection.
      </p>
      <Button variant="outline" onClick={() => void onRetry()}>
        Retry
      </Button>
    </div>
  );
}
