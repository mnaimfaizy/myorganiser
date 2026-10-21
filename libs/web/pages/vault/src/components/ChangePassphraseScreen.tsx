'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';

import {
  useChangePassphraseMode,
  useVaultOperationAvailability,
} from '../hooks';
import { VAULT_OPERATIONS } from '../policy';
import { ChangePassphraseForm } from './ChangePassphraseForm';
import { VaultUnavailableNotice } from './VaultUnavailableNotice';

/** Content for `/dashboard/vault/passphrase`. The phone shell supplies the bar and back link. */
export function ChangePassphraseScreen() {
  const router = useRouter();
  const mode = useChangePassphraseMode();
  const { allowed, unavailableReason } = useVaultOperationAvailability(
    VAULT_OPERATIONS.PassphraseChange,
  );

  const handleDone = useCallback(() => {
    router.push('/dashboard/vault');
  }, [router]);

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="font-display text-display sr-only md:not-sr-only">
        {mode.title}
      </h1>
      <p className="text-body text-foreground-supporting">{mode.description}</p>

      <VaultUnavailableNotice
        reason={unavailableReason}
        testId="change-passphrase-unavailable"
      />

      {allowed && <ChangePassphraseForm layout="screen" onDone={handleDone} />}
    </div>
  );
}
