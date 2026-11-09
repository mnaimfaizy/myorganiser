'use client';

import { useCallback, useState } from 'react';

import { Button, Card } from '@myorganiser/web-ui';

import { usePasskeyUnlockCard, useVaultOperationAvailability } from '../hooks';
import { VAULT_OPERATIONS } from '../policy';
import { PasskeyUnlockEnableDialog } from './PasskeyUnlockEnableDialog';
import { VaultUnavailableNotice } from './VaultUnavailableNotice';

export const PASSKEY_UNLOCK_DESCRIPTION =
  'Unlock your vault on this device with a passkey you verify here, instead of typing your passphrase. Your passphrase and recovery key keep working.';

export const PASSKEY_UNLOCK_STATUS_ON = 'On for this device';
export const PASSKEY_UNLOCK_STATUS_OFF = 'Off on this device';

/**
 * The desktop card for Passkey Unlock (ADR 0136). Renders nothing where the
 * browser cannot create the passkey Passkey Unlock needs.
 */
export function PasskeyUnlockCard() {
  const { supported, enrolled, busy, disable } = usePasskeyUnlockCard();
  const { allowed, unavailableReason } = useVaultOperationAvailability(
    VAULT_OPERATIONS.PasskeyUnlock,
  );
  const [open, setOpen] = useState(false);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
  }, []);

  const handleOpen = useCallback(() => {
    setOpen(true);
  }, []);

  if (supported !== true) {
    return null;
  }

  return (
    <Card data-testid="passkey-unlock-card">
      <div className="flex flex-col gap-3 p-4 md:p-6">
        <h3 className="font-display text-title">Passkey Unlock</h3>
        <p className="text-body text-foreground-supporting">
          {PASSKEY_UNLOCK_DESCRIPTION}
        </p>
        <p
          data-testid="passkey-unlock-status"
          className="text-body font-medium text-foreground"
        >
          {enrolled ? PASSKEY_UNLOCK_STATUS_ON : PASSKEY_UNLOCK_STATUS_OFF}
        </p>

        <VaultUnavailableNotice
          reason={unavailableReason}
          testId="passkey-unlock-unavailable"
        />

        <div>
          {enrolled ? (
            <Button
              type="button"
              variant="outline"
              data-testid="passkey-unlock-turn-off"
              disabled={!allowed || busy}
              onClick={disable}
            >
              Turn off
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              data-testid="passkey-unlock-turn-on"
              disabled={!allowed || busy}
              onClick={handleOpen}
            >
              Turn on…
            </Button>
          )}
        </div>
      </div>

      <PasskeyUnlockEnableDialog open={open} onOpenChange={handleOpenChange} />
    </Card>
  );
}
