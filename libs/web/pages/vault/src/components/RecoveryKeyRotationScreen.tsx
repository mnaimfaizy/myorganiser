'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';

import { useVaultOperationAvailability } from '../hooks';
import { VAULT_OPERATIONS } from '../policy';
import { ROTATION_DESCRIPTION } from './RecoveryKeyRotationCard';
import { RecoveryKeyRotationForm } from './RecoveryKeyRotationForm';
import { VaultUnavailableNotice } from './VaultUnavailableNotice';

/** Content for `/dashboard/vault/recovery-key`. The phone shell supplies the bar and back link. */
export function RecoveryKeyRotationScreen() {
  const router = useRouter();
  const { allowed, unavailableReason } = useVaultOperationAvailability(
    VAULT_OPERATIONS.RecoveryKeyRotation,
  );

  const handleLeave = useCallback(() => {
    router.push('/dashboard/vault');
  }, [router]);

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="font-display text-display sr-only md:not-sr-only">
        Rotate recovery key
      </h1>
      <p className="text-body text-foreground-supporting">
        {ROTATION_DESCRIPTION}
      </p>

      <VaultUnavailableNotice
        reason={unavailableReason}
        testId="recovery-key-rotation-unavailable"
      />

      {allowed && (
        <RecoveryKeyRotationForm
          layout="screen"
          onCancel={handleLeave}
          onDone={handleLeave}
        />
      )}
    </div>
  );
}
