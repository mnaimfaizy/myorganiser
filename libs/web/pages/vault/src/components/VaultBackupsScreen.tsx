'use client';

import { ExportVaultCard } from './ExportVaultCard';
import { ImportVaultCard } from './ImportVaultCard';
import { VaultEscapeCopySection } from './VaultEscapeCopySection';

/** Content for `/dashboard/vault/backups`. The phone shell supplies the bar and back link. */
export function VaultBackupsScreen() {
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="font-display text-display sr-only md:not-sr-only">
        Backups
      </h1>
      <VaultEscapeCopySection />
      <ExportVaultCard />
      <ImportVaultCard />
    </div>
  );
}
