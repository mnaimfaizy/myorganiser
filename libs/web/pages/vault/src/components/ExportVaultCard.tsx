'use client';

import { useCallback } from 'react';

import { Button, Card } from '@myorganiser/web-ui';

import { useExportVault, useVaultOperationAvailability } from '../hooks';
import { VAULT_OPERATIONS } from '../policy';
import { VaultUnavailableNotice } from './VaultUnavailableNotice';

interface ExportVaultCardProps {
  /**
   * Optional callback invoked when the export succeeds. Not called if the
   * export fails (errors are already toasted by the hook).
   */
  onEscapeCopyMade?: () => void;
}

export function ExportVaultCard({ onEscapeCopyMade }: ExportVaultCardProps) {
  const { exporting, exportVaultNow } = useExportVault();
  const { allowed, unavailableReason } = useVaultOperationAvailability(
    VAULT_OPERATIONS.Export,
  );

  const handleExport = useCallback(async () => {
    const success = await exportVaultNow();
    if (success && onEscapeCopyMade) {
      onEscapeCopyMade();
    }
  }, [exportVaultNow, onEscapeCopyMade]);

  return (
    <Card className="h-full">
      <div className="flex h-full flex-col gap-3 p-4 md:p-6">
        <h3 className="font-display text-title">Export encrypted vault</h3>
        <p className="text-body text-foreground-supporting">
          Download a ciphertext-only JSON bundle. The file never contains
          plaintext addresses or phone numbers.
        </p>
        <p className="text-body text-foreground-supporting">
          The exported file is decrypted only on this device using your
          passphrase or recovery key. The server stores audit metadata only —
          never the bundle itself.
        </p>
        <VaultUnavailableNotice
          reason={unavailableReason}
          testId="export-vault-unavailable"
        />
        <Button
          data-testid="export-vault-button"
          onClick={handleExport}
          disabled={exporting || !allowed}
          className="mt-auto w-full md:w-auto"
        >
          {exporting ? 'Exporting…' : 'Export vault JSON'}
        </Button>
      </div>
    </Card>
  );
}
