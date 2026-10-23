'use client';

import { useCallback } from 'react';

import { Button, ConfirmDialog, useToast } from '@myorganiser/web-ui';

import {
  useOptionalVaultSession,
  vaultBlobTypeLabel,
  formatDate,
} from '@myorganiser/web-vault-ui';

import { getErrorMessage } from '../utils/getErrorMessage';
import {
  useExportVault,
  useLatestCloudBackup,
  useUnsentVaultBlobTypes,
} from '../hooks';

export interface RemoveVaultDialogProps {
  /** Controlled open state, owned by the caller. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RemoveVaultDialog({
  open,
  onOpenChange,
}: RemoveVaultDialogProps) {
  const { toast } = useToast();
  const vaultSession = useOptionalVaultSession();
  const handle = vaultSession?.handle ?? null;

  const { exporting, exportVaultNow } = useExportVault();
  const latestCloud = useLatestCloudBackup();
  const unsentTypes = useUnsentVaultBlobTypes(open);

  const handleExportFirst = useCallback(() => {
    void exportVaultNow();
  }, [exportVaultNow]);

  const handleConfirmRemove = useCallback(async () => {
    if (!handle) return;

    try {
      handle.removeVault();

      toast({
        title: 'Vault removed',
        description: 'This Vault was removed from this device.',
      });

      onOpenChange(false);

      // Full page reload to reset vault-dependent surfaces and VaultGate state.
      //
      // The reconcile runner no longer needs it: `removeVault` moves the Local
      // Vault Revision and the runner passes on that alone (ADR 0066, decision
      // point 2). What still needs it is `VaultGate`, which seeds its status
      // from storage once and re-reads only when the handle identity changes —
      // and a removal does not change it. Decision point 4 is what makes the
      // gate answer for itself; this line goes with it, not before it.
      window.location.reload();
    } catch (error) {
      toast({
        title: 'Removal failed',
        description: getErrorMessage(error),
        variant: 'destructive',
      });
    }
  }, [handle, onOpenChange, toast]);

  /**
   * Render the confirmation dialog description based on unsent vault blob types.
   * Always returns plain text/inline content (no block elements or buttons).
   * Note: DialogDescription renders as <p>, so we return text/inline fragments only.
   */
  function renderDescription(): React.ReactNode {
    switch (unsentTypes.status) {
      case 'pending':
        return 'Checking what this device has not sent to the server yet…';

      case 'loaded': {
        if (unsentTypes.types.length === 0) {
          return (
            <>
              Every part of this Vault has already reached the server. Removing
              it deletes nothing that has not been synced.
            </>
          );
        }

        const typeNames = unsentTypes.types.map(vaultBlobTypeLabel).join(', ');
        return (
          <>
            This device holds changes it has not sent to the server yet, for:{' '}
            {typeNames}. Removing this Vault deletes that Ciphertext from this
            device, and it does not exist anywhere else.
          </>
        );
      }

      default:
        return null;
    }
  }

  /**
   * Render backup status and export button.
   * Rendered between the description and the buttons. Status-only (does not
   * claim backup is a safety mechanism), with the export button only when empty.
   */
  function renderDialogChildren(): React.ReactNode {
    if (latestCloud.status !== 'empty') {
      let backupStatus: string;
      switch (latestCloud.status) {
        case 'loading':
          backupStatus =
            'Checking whether this Vault has an independent backup…';
          break;

        case 'loaded':
          backupStatus = `An independent backup of this Vault exists, last made on ${formatDate(latestCloud.record.createdAt)}.`;
          break;

        case 'error':
        default:
          backupStatus = 'Backup status could not be confirmed.';
          break;
      }

      return (
        <p className="text-body-sm text-foreground-supporting">
          {backupStatus}
        </p>
      );
    }

    return (
      <div className="flex flex-wrap items-center gap-3 rounded-control border border-warning-edge bg-warning-faint p-3.5">
        <span className="min-w-0 flex-1 basis-60 text-body-sm text-warning-text">
          This Vault has no independent backup.
        </span>
        <Button
          type="button"
          variant="default"
          data-testid="remove-vault-export-first-button"
          disabled={exporting}
          onClick={handleExportFirst}
          className="w-full md:w-auto"
        >
          {exporting ? 'Exporting…' : 'Export vault JSON first'}
        </Button>
      </div>
    );
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Remove this Vault from this device?"
      description={renderDescription()}
      confirmLabel="Remove from this device"
      tone="destructive"
      onConfirm={handleConfirmRemove}
    >
      {renderDialogChildren()}
    </ConfirmDialog>
  );
}
