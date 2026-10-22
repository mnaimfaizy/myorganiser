'use client';

import { Button, Dialog, DialogContent } from '@myorganiser/web-ui';
import Link from 'next/link';
import { useCallback } from 'react';
import { formatShortsDuration } from '../lib/shortsBudget';

interface ShortsEntryWarningProps {
  limitMs: number;
  remainingMs: number;
  onContinue: () => void;
}

/**
 * Entry gate for the Shorts page, shown on every visit before any Short can play.
 * States plainly that Shorts time is capped and offers two actions:
 * continue to Shorts or go back to long-form.
 *
 * Rendered as a controlled, non-dismissible Dialog that blocks the page beneath.
 * Radix's Dialog traps focus and lands it on the first focusable control — the
 * Continue button — so no manual focus management is needed here.
 */
export function ShortsEntryWarning({
  limitMs,
  remainingMs,
  onContinue,
}: ShortsEntryWarningProps) {
  const handleOpenChange = useCallback((_open: boolean) => {
    // Dialog can only be dismissed via explicit action buttons.
  }, []);

  const handlePointerDownOutside = useCallback(
    (event: { preventDefault: () => void }) => {
      event.preventDefault();
    },
    [],
  );

  return (
    <Dialog open={true} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-sm text-center"
        showCloseButton={false}
        onPointerDownOutside={handlePointerDownOutside}
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h2 className="font-display text-title text-foreground">
              Shorts Daily Budget
            </h2>
            <p className="text-body-sm text-foreground-supporting">
              Shorts are limited to {formatShortsDuration(limitMs)} per day.
            </p>
            <p className="text-body-sm text-foreground-supporting">
              You have {formatShortsDuration(remainingMs)} remaining today.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <Button onClick={onContinue} className="w-full">
              Continue to Shorts
            </Button>
            {/*
              Navigation is the Link's job alone. Pairing it with an onClick
              that also pushes the route fired both, which is why this used to
              navigate twice — same shape as ShortsHardStop's CTA now.
            */}
            <Button variant="outline" className="w-full" asChild>
              <Link href="/dashboard/youtube">Back to Videos</Link>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
