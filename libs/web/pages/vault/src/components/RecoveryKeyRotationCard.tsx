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

import { useVaultOperationAvailability } from '../hooks';
import { VAULT_OPERATIONS } from '../policy';
import { RecoveryKeyRotationForm } from './RecoveryKeyRotationForm';
import { VaultUnavailableNotice } from './VaultUnavailableNotice';

export const ROTATION_DESCRIPTION =
  'Generate a new recovery key that can open your vault. Your old key stops working after you confirm the new one.';

export function RecoveryKeyRotationCard() {
  const { allowed, unavailableReason } = useVaultOperationAvailability(
    VAULT_OPERATIONS.RecoveryKeyRotation,
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
        <h3 className="font-display text-title">Rotate recovery key</h3>
        <p className="text-body text-foreground-supporting">
          {ROTATION_DESCRIPTION}
        </p>

        <VaultUnavailableNotice
          reason={unavailableReason}
          testId="recovery-key-rotation-unavailable"
        />

        <div>
          <Button
            type="button"
            variant="outline"
            data-testid="recovery-key-rotation-open"
            disabled={!allowed}
            onClick={handleOpen}
          >
            Rotate recovery key…
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[calc(100dvh-theme(spacing.8))] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Rotate recovery key</DialogTitle>
            <DialogDescription>{ROTATION_DESCRIPTION}</DialogDescription>
          </DialogHeader>
          <RecoveryKeyRotationForm
            layout="dialog"
            onCancel={handleClose}
            onDone={handleClose}
          />
        </DialogContent>
      </Dialog>
    </Card>
  );
}
