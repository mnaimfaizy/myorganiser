'use client';

import { useCallback, useState, type ReactNode } from 'react';

import { useIsMobile } from '@myorganiser/web-ui';

import { useVaultDisabledState } from '../hooks';
import type { VaultDisabledState } from '../policy';
import { ChangePassphraseCard } from './ChangePassphraseCard';
import type { CloudBackupSummary } from './CloudBackupLiveCard';
import { EscapeCopyReaderCard } from './EscapeCopyReaderCard';
import { ExportVaultCard } from './ExportVaultCard';
import { ImportVaultCard } from './ImportVaultCard';
import { RecoveryKeyRotationCard } from './RecoveryKeyRotationCard';
import { RemoveVaultCard } from './RemoveVaultCard';
import { VaultEscapeCopySection } from './VaultEscapeCopySection';
import { VaultPhoneSections } from './VaultPhoneSections';
import { VaultStatusHero } from './VaultStatusHero';
import { VaultUnlockCard } from './VaultUnlockCard';

const SECTION_GRID_CLASS =
  'grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(20rem,1fr))]';

const renderVaultHeading = () => <h1 className="sr-only">Vault</h1>;

/** The hero for each disabled state. Enabled takes the Escape Copy summary; the rest ignore it. */
const HERO_FOR_DISABLED_STATE = {
  enabled: (escapeCopy: CloudBackupSummary | undefined): ReactNode => (
    <VaultStatusHero escapeCopy={escapeCopy} />
  ),
  locked: (): ReactNode => <VaultUnlockCard />,
  'no-local-vault': renderVaultHeading,
  'signed-out': renderVaultHeading,
} as const satisfies Record<
  VaultDisabledState,
  (escapeCopy: CloudBackupSummary | undefined) => ReactNode
>;

/**
 * The Vault page. One layout renders, chosen by `useIsMobile`: the phone
 * ListGroups below md, the sectioned desktop page at md and up. Rendering both
 * would duplicate every test id on the page.
 */
export function VaultPageClient() {
  const isMobile = useIsMobile();
  const disabledState = useVaultDisabledState();
  const [justMadeACopy, setJustMadeACopy] = useState(false);
  const [escapeCopySummary, setEscapeCopySummary] = useState<
    CloudBackupSummary | undefined
  >(undefined);

  const handleEscapeCopyMade = useCallback(() => {
    setJustMadeACopy(true);
  }, []);

  const handleSummaryChange = useCallback((summary: CloudBackupSummary) => {
    setEscapeCopySummary(summary);
  }, []);

  const hero = HERO_FOR_DISABLED_STATE[disabledState](escapeCopySummary);

  if (isMobile) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4">
        {hero}
        <VaultPhoneSections />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:pt-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        {hero}

        <section
          aria-labelledby="vault-access-heading"
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <h2
              id="vault-access-heading"
              className="font-display text-title-lg"
            >
              Access
            </h2>
            <p className="text-body text-foreground-supporting">
              What opens your vault. Both open a dialog with the full steps.
            </p>
          </div>
          <div className={SECTION_GRID_CLASS}>
            <ChangePassphraseCard />
            <RecoveryKeyRotationCard />
          </div>
        </section>

        <section
          aria-labelledby="vault-backups-heading"
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <h2
              id="vault-backups-heading"
              className="font-display text-title-lg"
            >
              Backups and moving your vault
            </h2>
            <p className="text-body text-foreground-supporting">
              Every copy is ciphertext. Plaintext never leaves this device.
            </p>
          </div>
          <VaultEscapeCopySection
            onEscapeCopyMade={handleEscapeCopyMade}
            onSummaryChange={handleSummaryChange}
          />
          <div className={SECTION_GRID_CLASS}>
            <ExportVaultCard onEscapeCopyMade={handleEscapeCopyMade} />
            <ImportVaultCard />
          </div>
          <EscapeCopyReaderCard justMadeACopy={justMadeACopy} />
        </section>

        <section
          aria-labelledby="vault-danger-heading"
          className="flex flex-col gap-3"
        >
          <h2
            id="vault-danger-heading"
            className="font-display text-title-lg text-destructive-text"
          >
            Danger zone
          </h2>
          <RemoveVaultCard />
        </section>
      </div>
    </div>
  );
}
