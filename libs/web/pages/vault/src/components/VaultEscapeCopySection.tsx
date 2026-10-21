'use client';

import { useMemo } from 'react';

import { GoogleDriveCloudBackupProvider } from '@myorganiser/web-vault';
import { useOptionalVaultSession } from '@myorganiser/web-vault-ui';

import {
  useGoogleIdentityScript,
  useVaultOperationAvailability,
} from '../hooks';
import { VAULT_OPERATIONS } from '../policy';
import {
  CloudBackupLiveCard,
  type CloudBackupSummary,
} from './CloudBackupLiveCard';
import { CloudBackupUnavailableCard } from './CloudBackupUnavailableCard';

export interface VaultEscapeCopySectionProps {
  /** Called when a Cloud Backup succeeds. */
  onEscapeCopyMade?: () => void;
  /** Reports the Google Drive connection state and the newest copy. */
  onSummaryChange?: (summary: CloudBackupSummary) => void;
}

/**
 * The Google Drive Escape Copy card, with every reason it cannot run shown in
 * place of the live card. The policy answers first: with no Local Vault to back
 * up, how Google Drive is configured is not the reason the card is unavailable.
 */
export function VaultEscapeCopySection({
  onEscapeCopyMade,
  onSummaryChange,
}: VaultEscapeCopySectionProps) {
  const gisStatus = useGoogleIdentityScript();
  const vaultSession = useOptionalVaultSession();
  const handle = vaultSession?.handle ?? null;
  const cloudBackup = useVaultOperationAvailability(
    VAULT_OPERATIONS.CloudBackup,
  );
  const clientId =
    // Production and staging bake NEXT_PUBLIC_GOOGLE_CLIENT_ID in at
    // build time. window.__MYORG_GOOGLE_CLIENT_ID__ is an E2E/dev fallback
    // only — not a hosted configuration path (issue #751).
    typeof process !== 'undefined' && process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
      ? process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
      : typeof window !== 'undefined'
        ? ((window as { __MYORG_GOOGLE_CLIENT_ID__?: string })
            .__MYORG_GOOGLE_CLIENT_ID__ ?? '')
        : '';

  const provider = useMemo(() => {
    if (!clientId || gisStatus !== 'ready') return null;
    return new GoogleDriveCloudBackupProvider({ clientId });
  }, [clientId, gisStatus]);

  if (cloudBackup.unavailableReason !== null) {
    return (
      <CloudBackupUnavailableCard reason={cloudBackup.unavailableReason} />
    );
  }
  if (!clientId) {
    return (
      <CloudBackupUnavailableCard reason="Cloud backup is not configured. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID to enable Google Drive backup." />
    );
  }
  if (gisStatus === 'error') {
    return (
      <CloudBackupUnavailableCard reason="Google Identity Services failed to load. Check your network and try again." />
    );
  }
  if (!provider || !handle) {
    return (
      <CloudBackupUnavailableCard reason="Loading Google Drive integration…" />
    );
  }
  return (
    <CloudBackupLiveCard
      provider={provider}
      handle={handle}
      onEscapeCopyMade={onEscapeCopyMade}
      onSummaryChange={onSummaryChange}
    />
  );
}
