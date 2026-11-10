'use client';

import { useCallback, useState } from 'react';
import { ChevronRight } from 'lucide-react';

import {
  ConfirmDialog,
  ListGroupRow,
  ListGroupRowBody,
  ListGroupRowMeta,
  ListGroupRowTitle,
  ListGroupRowTrailing,
} from '@myorganiser/web-ui';

import { usePasskeyUnlockCard, useVaultOperationAvailability } from '../hooks';
import { VAULT_OPERATIONS } from '../policy';
import {
  PASSKEY_UNLOCK_DESCRIPTION,
  PASSKEY_UNLOCK_STATUS_OFF,
  PASSKEY_UNLOCK_STATUS_ON,
} from './PasskeyUnlockCard';
import { PasskeyUnlockEnableDialog } from './PasskeyUnlockEnableDialog';

/**
 * The phone row for Passkey Unlock, a row in the Access ListGroup. Off: a tap
 * opens the passphrase dialog that enables it. On: a tap opens a destructive
 * ConfirmDialog, and only its confirm control turns Passkey Unlock off for this
 * device. Cancel and Escape close the confirmation without changing anything.
 * Renders nothing where the browser cannot create passkeys.
 */
export function VaultPhonePasskeyRow() {
  const { supported, enrolled, busy, disable } = usePasskeyUnlockCard();
  const { allowed, unavailableReason } = useVaultOperationAvailability(
    VAULT_OPERATIONS.PasskeyUnlock,
  );
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
  }, []);

  const handleConfirmOpenChange = useCallback((next: boolean) => {
    setConfirmOpen(next);
  }, []);

  const handleRowPress = useCallback(() => {
    if (enrolled) {
      setConfirmOpen(true);
      return;
    }
    setOpen(true);
  }, [enrolled]);

  const handleConfirmDisable = useCallback(() => {
    disable();
    setConfirmOpen(false);
  }, [disable]);

  if (supported !== true) {
    return null;
  }

  const statusText = enrolled
    ? PASSKEY_UNLOCK_STATUS_ON
    : PASSKEY_UNLOCK_STATUS_OFF;

  return (
    <>
      <ListGroupRow asChild size="default" interactive={allowed}>
        <button
          type="button"
          data-testid="passkey-unlock-row"
          disabled={!allowed || busy}
          onClick={handleRowPress}
          className="w-full text-left"
        >
          <ListGroupRowBody>
            <ListGroupRowTitle>Passkey Unlock</ListGroupRowTitle>
            <ListGroupRowMeta>
              {allowed ? PASSKEY_UNLOCK_DESCRIPTION : unavailableReason}
            </ListGroupRowMeta>
          </ListGroupRowBody>
          <ListGroupRowTrailing>
            <span
              data-testid="passkey-unlock-status"
              className="text-body-sm text-foreground-supporting"
            >
              {statusText}
            </span>
            <ChevronRight aria-hidden="true" className="size-4 text-inactive" />
          </ListGroupRowTrailing>
        </button>
      </ListGroupRow>

      <PasskeyUnlockEnableDialog open={open} onOpenChange={handleOpenChange} />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={handleConfirmOpenChange}
        title="Turn off Passkey Unlock?"
        description="This device will ask for your passphrase again. You can turn Passkey Unlock back on with your passphrase."
        confirmLabel="Turn off"
        tone="destructive"
        onConfirm={handleConfirmDisable}
      />
    </>
  );
}
