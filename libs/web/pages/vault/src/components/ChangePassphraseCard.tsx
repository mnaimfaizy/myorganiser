'use client';

import { useCallback, useState } from 'react';

import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@myorganiser/web-ui';

import {
  useChangePassphraseMode,
  useVaultOperationAvailability,
} from '../hooks';
import { VAULT_OPERATIONS } from '../policy';
import { ChangePassphraseForm } from './ChangePassphraseForm';
import { VaultUnavailableNotice } from './VaultUnavailableNotice';

export function ChangePassphraseCard() {
  const mode = useChangePassphraseMode();
  const { allowed, unavailableReason } = useVaultOperationAvailability(
    VAULT_OPERATIONS.PassphraseChange,
  );
  const [open, setOpen] = useState(false);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
  }, []);

  const handleOpen = useCallback(() => {
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <Card>
      <div className="flex flex-col gap-3 p-4 md:p-6">
        <h3 className="font-display text-title">{mode.title}</h3>
        <p className="text-body text-foreground-supporting">
          {mode.description}
        </p>
        <p className="text-body text-foreground-supporting">
          Your data is not re-encrypted and your recovery key keeps working.
        </p>

        <VaultUnavailableNotice
          reason={unavailableReason}
          testId="change-passphrase-unavailable"
        />

        <div>
          <Button
            type="button"
            variant="outline"
            data-testid="change-passphrase-open"
            disabled={!allowed}
            onClick={handleOpen}
          >
            {mode.title}…
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[calc(100dvh-theme(spacing.8))] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{mode.title}</DialogTitle>
            <DialogDescription>{mode.description}</DialogDescription>
          </DialogHeader>
          <ChangePassphraseForm
            layout="dialog"
            onCancel={handleClose}
            onDone={handleClose}
          />
        </DialogContent>
      </Dialog>
    </Card>
  );
}
