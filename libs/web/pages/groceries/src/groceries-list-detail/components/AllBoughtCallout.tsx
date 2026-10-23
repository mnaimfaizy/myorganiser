'use client';

import { Button } from '@myorganiser/web-ui';

interface AllBoughtCalloutProps {
  isBusy: boolean;
  onUncheckAll: () => void;
}

/** Shown when every open line of a non-empty list is checked. */
export function AllBoughtCallout({
  isBusy,
  onUncheckAll,
}: AllBoughtCalloutProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-success-edge bg-success-faint p-4">
      <p className="min-w-0 flex-1 text-body-sm text-success-text">
        All bought. Uncheck All to use it again.
      </p>
      <Button
        variant="secondary"
        size="sm"
        onClick={onUncheckAll}
        disabled={isBusy}
      >
        Uncheck All
      </Button>
    </div>
  );
}
