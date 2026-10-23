import { Button, Skeleton } from '@myorganiser/web-ui';

export interface OverviewStatusProps {
  /** True while the first overview request is in flight. */
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}

/**
 * The overview's loading and error states. Renders nothing once the data is
 * in. Loading is a polite sr-only status with skeletons; the error offers a
 * retry that re-runs the provider's request.
 */
export function OverviewStatus({
  loading,
  error,
  onRetry,
}: OverviewStatusProps) {
  if (error) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-panel border border-border bg-raised-surface p-4"
      >
        <p className="text-body text-foreground">
          Unable to load overview. Please try again.
        </p>
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <p role="status" className="sr-only">
          Loading…
        </p>
        <Skeleton className="h-24 w-full rounded-panel" />
        <Skeleton className="h-24 w-full rounded-panel" />
      </div>
    );
  }

  return null;
}
