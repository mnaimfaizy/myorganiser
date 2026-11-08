'use client';

import { Button, Separator } from '@myorganiser/web-ui';

export interface PasskeyUnlockOptionProps {
  /** True while the passkey check is in flight: the button shows its busy label and cannot be pressed. */
  unlocking: boolean;
  onUnlock: () => void;
}

/**
 * The passkey option on the locked unlock screen (ADR 0136). Sits above the
 * passphrase form; the passphrase path stays the fallback below the divider.
 */
export function PasskeyUnlockOption({
  unlocking,
  onUnlock,
}: PasskeyUnlockOptionProps) {
  return (
    <div className="flex flex-col gap-4.5">
      <Button
        type="button"
        variant="brand"
        className="w-full"
        onClick={onUnlock}
        disabled={unlocking}
        aria-busy={unlocking}
      >
        {unlocking ? 'Checking your passkey…' : 'Unlock with passkey'}
      </Button>
      <div className="flex items-center gap-3 text-body-sm text-muted-foreground">
        <Separator className="flex-1" />
        <span>or use your passphrase</span>
        <Separator className="flex-1" />
      </div>
    </div>
  );
}
