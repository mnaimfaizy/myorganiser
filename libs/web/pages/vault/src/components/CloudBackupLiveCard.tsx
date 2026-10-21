'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CloudBackupCard } from '@myorganiser/web-vault-ui';
import {
  createVaultBackupsApi,
  isEscapeCopyOverdue,
  type CloudBackupProvider,
  type VaultHandle,
} from '@myorganiser/web-vault';

import {
  useCloudBackup,
  useLatestCloudBackup,
  useVaultImportDisclosure,
} from '../hooks';
import { ImportVaultReplaceDialog } from './ImportVaultReplaceDialog';

/**
 * What the page needs to know about Google Drive backup state: whether the
 * connection is linked, and when the newest copy was made. `undefined` while
 * the latest record is loading or failed to load, `null` when there is none.
 */
export interface CloudBackupSummary {
  linked: boolean;
  newestCopyCreatedAt: string | null | undefined;
}

interface CloudBackupLiveCardProps {
  provider: CloudBackupProvider;
  handle: VaultHandle;
  /**
   * Optional callback invoked when a Cloud Backup succeeds. Not called on
   * initial mount or before the first backup attempt.
   */
  onEscapeCopyMade?: () => void;
  /**
   * Optional callback reporting the connection state and newest copy. Called
   * from an effect when either changes, including once on mount.
   */
  onSummaryChange?: (summary: CloudBackupSummary) => void;
}

export function CloudBackupLiveCard({
  provider,
  handle,
  onEscapeCopyMade,
  onSummaryChange,
}: CloudBackupLiveCardProps) {
  const getNewestCopyMs = useCallback(async () => {
    try {
      const api = createVaultBackupsApi();
      const response = await api.getLatestBackup({
        status: 'success',
        source: 'google-drive',
        event: 'export',
      });
      const created = response.data?.createdAt;
      return created ? Date.parse(created) : null;
    } catch (err: unknown) {
      const e = err as { response?: { status?: number } };
      if (e?.response?.status === 404) return null;
      return null;
    }
  }, []);

  const cloud = useCloudBackup({
    providerId: 'google-drive',
    provider,
    handle,
    getNewestCopyMs,
  });
  const latestCloud = useLatestCloudBackup(cloud.backupCounter);

  // Track previous backup counter to detect increments. Fire onEscapeCopyMade
  // only when the counter increments, not on mount (initial value is 0).
  const previousCounterRef = useRef(cloud.backupCounter);

  useEffect(() => {
    if (cloud.backupCounter > previousCounterRef.current && onEscapeCopyMade) {
      onEscapeCopyMade();
    }
    previousCounterRef.current = cloud.backupCounter;
  }, [cloud.backupCounter, onEscapeCopyMade]);

  const latestRecord =
    latestCloud.status === 'loaded'
      ? latestCloud.record
      : latestCloud.status === 'empty'
        ? null
        : undefined;

  const linked = cloud.connection.status === 'linked';
  const newestCopyCreatedAt =
    latestRecord === undefined
      ? undefined
      : latestRecord === null
        ? null
        : latestRecord.createdAt;

  // Kept in a ref so an unstable parent callback does not re-fire the effect
  // below; only the connection state and the newest copy drive it.
  const onSummaryChangeRef = useRef(onSummaryChange);
  useEffect(() => {
    onSummaryChangeRef.current = onSummaryChange;
  }, [onSummaryChange]);

  useEffect(() => {
    onSummaryChangeRef.current?.({ linked, newestCopyCreatedAt });
  }, [linked, newestCopyCreatedAt]);

  // Track current time outside render for purity: poll every 60s so the
  // relative age and overdue status stay current while the page is open
  // (ADR 0062: a limit shows staleness, not a clock). The clock is stale
  // only as long as the browser tab is hidden or the page is idle.
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    // Set initial time and start polling every 60 seconds.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNowMs(Date.now());
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  // Compute overdue status when we have the record and aren't still loading
  const isOverdue = useMemo(() => {
    if (latestCloud.status === 'loading' || latestCloud.status === 'error')
      return false;
    return isEscapeCopyOverdue({
      ageLimit: cloud.ageLimit,
      newestCopyMs: latestRecord ? Date.parse(latestRecord.createdAt) : null,
      nowMs,
    });
  }, [cloud.ageLimit, latestCloud.status, latestRecord, nowMs]);

  // Restore workflow: fetch copy, show dialog, then confirm/cancel
  const restoreDialogOpen = cloud.pendingRestore !== null;
  const restoreSource = useMemo(() => {
    if (!cloud.pendingRestore) return null;
    const copy = cloud.pendingRestore;
    return {
      text: async () => copy.text,
    };
  }, [cloud.pendingRestore]);
  const restoreDisclosure = useVaultImportDisclosure(
    restoreSource,
    restoreDialogOpen,
  );

  const handleRestoreDialogOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        cloud.cancelRestore();
      }
    },
    [cloud],
  );

  return (
    <>
      <CloudBackupCard
        providerLabel="Google Drive"
        connection={cloud.connection}
        ageLimit={cloud.ageLimit}
        latestRecord={latestRecord}
        isLatestLoading={latestCloud.status === 'loading'}
        isOverdue={isOverdue}
        isBusy={cloud.isBusy}
        lastError={cloud.lastError}
        now={nowMs}
        onConnect={cloud.connect}
        onReconnect={cloud.reconnect}
        onDisconnect={cloud.disconnect}
        onBackupNow={cloud.backupNow}
        onRestore={cloud.beginRestore}
        onAgeLimitChange={cloud.setAgeLimit}
      />

      <ImportVaultReplaceDialog
        open={restoreDialogOpen}
        onOpenChange={handleRestoreDialogOpenChange}
        onConfirm={cloud.confirmRestore}
        onDecline={cloud.cancelRestore}
        disclosure={restoreDisclosure}
        copyCreatedAt={cloud.pendingRestore?.metadata.createdAt}
        title="Restore this copy from Google Drive?"
      />
    </>
  );
}
