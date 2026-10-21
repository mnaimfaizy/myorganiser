'use client';

import { useCallback, useState } from 'react';

import { Button, Card } from '@myorganiser/web-ui';

import { useVaultOperationAvailability } from '../hooks';
import { VAULT_OPERATIONS } from '../policy';
import { RemoveVaultDialog } from './RemoveVaultDialog';
import { VaultUnavailableNotice } from './VaultUnavailableNotice';

export const REMOVE_VAULT_DESCRIPTION =
  "Delete this device's copy of your Vault. Your account and passphrase are unaffected.";

export function RemoveVaultCard() {
  const { allowed, unavailableReason } = useVaultOperationAvailability(
    VAULT_OPERATIONS.Removal,
  );

  const [open, setOpen] = useState(false);

  const handleOpenDialog = useCallback(() => {
    setOpen(true);
  }, []);

  return (
    <>
      <Card className="h-full border-destructive-edge">
        <div className="flex h-full flex-col gap-3 p-4 md:p-6">
          <h3 className="font-display text-title">Remove local vault</h3>
          <p className="text-body text-foreground-supporting">
            {REMOVE_VAULT_DESCRIPTION}
          </p>
          <p className="text-body text-foreground-supporting">
            This only clears the encrypted copy stored in this browser. It does
            not delete your account, does not touch any other user&apos;s Local
            Vault on this device, and does not affect a cloud backup if one
            exists.
          </p>
          <VaultUnavailableNotice
            reason={unavailableReason}
            testId="remove-vault-unavailable"
          />
          <Button
            variant="outline"
            data-testid="remove-vault-button"
            disabled={!allowed}
            onClick={handleOpenDialog}
            className="w-full border-destructive-edge text-destructive-text hover:bg-destructive-faint md:w-auto md:self-start"
          >
            Remove local vault…
          </Button>
        </div>
      </Card>

      <RemoveVaultDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
