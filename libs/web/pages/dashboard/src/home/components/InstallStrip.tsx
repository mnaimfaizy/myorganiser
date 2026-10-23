'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  IconButton,
  InstallAppInstructions,
  useAppInstall,
} from '@myorganiser/web-ui';
import { Smartphone, X } from 'lucide-react';
import { useCallback, useState } from 'react';

import { useInstallCardDismissed } from '../../hooks/use-install-card-dismissed';

/**
 * The install offer. One tap installs where the browser can prompt; Safari
 * shows its steps in a dialog. Hidden once installed, unsupported, or
 * dismissed on this device.
 */
export function InstallStrip() {
  const { mode, dismissed: promptDismissed, install } = useAppInstall();
  const { dismissed: cardDismissed, dismiss } = useInstallCardDismissed();
  const [stepsOpen, setStepsOpen] = useState(false);

  const openInstall = useCallback(() => {
    if (mode === 'prompt') {
      void install();
      return;
    }
    setStepsOpen(true);
  }, [install, mode]);

  if (mode === 'unavailable' || promptDismissed || cardDismissed) {
    return null;
  }

  return (
    <section
      aria-label="Install"
      data-testid="install-app-card"
      className="flex flex-wrap items-center gap-4 rounded-panel border border-border bg-raised-surface py-4 pr-4 pl-5"
    >
      <span
        aria-hidden="true"
        className="flex size-11 shrink-0 items-center justify-center rounded-control bg-brand-soft text-brand-text"
      >
        <Smartphone className="size-5.5" />
      </span>
      <span className="flex min-w-0 flex-1 basis-70 flex-col gap-0.5">
        <span className="text-body-sm font-semibold text-foreground">
          Install MyOrganiser on this device
        </span>
        <span className="text-caption text-muted-foreground">
          Opens full-screen like an app, works offline, and keeps your vault on
          this device.
        </span>
      </span>
      <Button variant="default" className="h-11" onClick={openInstall}>
        Install
      </Button>
      <IconButton
        variant="ghost"
        label="Dismiss install suggestion"
        icon={<X aria-hidden="true" />}
        onClick={dismiss}
      />
      <Dialog open={stepsOpen} onOpenChange={setStepsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Install MyOrganiser</DialogTitle>
            <DialogDescription className="sr-only">
              Add MyOrganiser to this device from your browser.
            </DialogDescription>
          </DialogHeader>
          <InstallAppInstructions mode={mode} onInstall={install} />
        </DialogContent>
      </Dialog>
    </section>
  );
}
