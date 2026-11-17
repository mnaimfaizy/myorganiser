'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { useIsMobile } from '@myorganiser/web-ui';
import { VaultGate } from '@myorganiser/web-vault-ui';

import { useVaultDisabledState } from '../hooks';
import type { VaultDisabledState } from '../policy';
import { ChangePassphraseCard } from './ChangePassphraseCard';
import type { CloudBackupSummary } from './CloudBackupLiveCard';
import { EscapeCopyReaderCard } from './EscapeCopyReaderCard';
import { ExportVaultCard } from './ExportVaultCard';
import { ImportVaultCard } from './ImportVaultCard';
import { PasskeyUnlockCard } from './PasskeyUnlockCard';
import { RecoveryKeyRotationCard } from './RecoveryKeyRotationCard';
import { RemoveVaultCard } from './RemoveVaultCard';
import { VaultEscapeCopySection } from './VaultEscapeCopySection';
import { VaultPhoneSections } from './VaultPhoneSections';
import { VaultStatusHero } from './VaultStatusHero';
import { VaultUnlockCard } from './VaultUnlockCard';

const SECTION_GRID_CLASS =
  'grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(20rem,1fr))]';

const renderVaultHeading = () => <h1 className="sr-only">Vault</h1>;

/**
 * The hero for each disabled state. Enabled takes the Escape Copy summary; the rest ignore it.
 * 'no-local-vault' is not shown here directly: the page mounts VaultGate in the hero position
 * for it, and this entry only renders as the gate's unlocked children (see gateInHero).
 */
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

interface VaultGatePassedProps {
  onPassed: () => void;
}

/**
 * Mounted only as the gate's unlocked children, so its effect runs once the
 * gate has passed (Recovery Key Acknowledgment given and the User unlocked).
 * Renders nothing.
 */
function VaultGatePassed({ onPassed }: VaultGatePassedProps) {
  useEffect(() => {
    onPassed();
  }, [onPassed]);

  return null;
}

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
  // Set when the page enters 'no-local-vault' and held until the gate passes or
  // the User signs out. Creating a vault moves the disabled state off
  // 'no-local-vault' while the Recovery Key is still unacknowledged; the gate
  // holds that key in its own state, so the gate must stay mounted until then.
  const [gateLatched, setGateLatched] = useState(false);

  // Adjusting state during render, not in an effect: the latch is set in the same
  // render that first shows 'no-local-vault', so VaultGate never unmounts between
  // entering the state and the latch being recorded.
  if (disabledState === 'no-local-vault' && !gateLatched) {
    setGateLatched(true);
  } else if (disabledState === 'signed-out' && gateLatched) {
    setGateLatched(false);
  }

  const handleGatePassed = useCallback(() => {
    setGateLatched(false);
  }, []);

  const handleEscapeCopyMade = useCallback(() => {
    setJustMadeACopy(true);
  }, []);

  const handleSummaryChange = useCallback((summary: CloudBackupSummary) => {
    setEscapeCopySummary(summary);
  }, []);

  const gateInHero =
    disabledState === 'no-local-vault' ||
    (gateLatched && disabledState !== 'signed-out');

  const hero = gateInHero ? (
    <VaultGate title="Vault">
      {() => (
        <>
          {HERO_FOR_DISABLED_STATE[disabledState](escapeCopySummary)}
          <VaultGatePassed onPassed={handleGatePassed} />
        </>
      )}
    </VaultGate>
  ) : (
    HERO_FOR_DISABLED_STATE[disabledState](escapeCopySummary)
  );

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
              What opens your vault. Each opens a dialog with the full steps.
              Passkey Unlock is set up separately on each device.
            </p>
          </div>
          <div className={SECTION_GRID_CLASS}>
            <ChangePassphraseCard />
            <RecoveryKeyRotationCard />
            <PasskeyUnlockCard />
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
