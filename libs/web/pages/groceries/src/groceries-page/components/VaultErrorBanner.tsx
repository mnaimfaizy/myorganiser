'use client';

import { Button } from '@myorganiser/web-ui';
import { AlertCircle } from 'lucide-react';

export interface VaultErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

/** The dismissible notice for a failed vault operation. */
export function VaultErrorBanner({
  message,
  onDismiss,
}: VaultErrorBannerProps) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-start gap-3 rounded-control border border-destructive-edge bg-destructive-faint p-4 text-destructive-text"
    >
      <AlertCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        <p className="font-semibold text-body-sm">{message}</p>
        <Button variant="link" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
