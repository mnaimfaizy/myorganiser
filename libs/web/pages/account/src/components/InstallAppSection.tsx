'use client';

import { cn, InstallAppInstructions, useAppInstall } from '@myorganiser/web-ui';
import { useId } from 'react';

import type { AccountVariant } from '../account-view';

interface InstallAppSectionProps {
  variant?: AccountVariant;
}

// The permanent install entry. It ignores the dashboard card's dismissal, so a
// User who dismissed the card can still find the steps here.
export function InstallAppSection({
  variant = 'desktop',
}: InstallAppSectionProps) {
  const headingId = useId();
  const { mode, dismissed, install } = useAppInstall();

  // A cancelled prompt keeps the section, with a hint, so the User can still
  // find a way to install (#1129). Any other unavailable state hides it.
  if (mode === 'unavailable' && !dismissed) {
    return null;
  }

  const isPhone = variant === 'phone';

  return (
    <section
      data-testid="install-app-section"
      aria-labelledby={headingId}
      className={cn(
        'flex flex-col gap-4 rounded-panel border border-border bg-raised-surface',
        isPhone ? 'p-4' : 'px-6 py-5',
      )}
    >
      <h2 id={headingId} className="font-display text-title font-bold">
        Install MyOrganiser
      </h2>
      {mode === 'unavailable' ? (
        <p className="text-body-sm text-muted-foreground">
          To install, reload this page, or use your browser&apos;s menu.
        </p>
      ) : (
        <InstallAppInstructions
          mode={mode}
          onInstall={install}
          // The prompt sits beside its help text on desktop and stacks on the
          // phone; the Safari steps keep their own stacked layout.
          className={
            mode === 'prompt'
              ? cn(
                  'space-y-0',
                  isPhone
                    ? 'flex flex-col items-stretch gap-4'
                    : 'flex flex-wrap items-center justify-between gap-4',
                )
              : undefined
          }
        />
      )}
    </section>
  );
}
