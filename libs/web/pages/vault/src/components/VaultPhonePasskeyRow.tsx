'use client';

import { useCallback, useState } from 'react';

import {
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
 * The phone row for Passkey Unlock, a row in the Access ListGroup. Off: it
 * opens the passphrase dialog. On: it turns Passkey Unlock off for this device
 * directly. Renders nothing where the browser cannot create passkeys.
 */
export function VaultPhonePasskeyRow() {
  const { supported, enrolled, busy, disable } = usePasskeyUnlockCard();
  const { allowed, unavailableReason } = useVaultOperationAvailability(
    VAULT_OPERATIONS.PasskeyUnlock,
  );
  const [open, setOpen] = useState(false);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
  }, []);

  const handleRowPress = useCallback(() => {
    if (enrolled) {
      disable();
      return;
    }
    setOpen(true);
  }, [enrolled, disable]);

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
          </ListGroupRowTrailing>
        </button>
      </ListGroupRow>

      <PasskeyUnlockEnableDialog open={open} onOpenChange={handleOpenChange} />
    </>
  );
}
