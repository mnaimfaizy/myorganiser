'use client';

import {
  createVaultBackupsApi,
  type GetLatestBackupParams,
} from '@myorganiser/web-vault';
import { useCallback, useEffect, useState } from 'react';

/**
 * Minimal record shape consumed by cloud-backup surfaces. Kept here (not
 * imported from the generated client) so a regeneration that adds optional
 * fields does not require updating this hook.
 */
export interface LatestBackupRecord {
  id: string;
  event: string;
  source: string;
  status: string;
  createdAt: string;
  schemaVersion: number;
  sizeBytes: number;
}

export type LatestCloudBackupState =
  | { status: 'loading'; record: null }
  | { status: 'empty'; record: null }
  | { status: 'loaded'; record: LatestBackupRecord }
  | { status: 'error'; record: null; error: unknown };

export type LatestCloudBackupApiFactory = () => {
  getLatestBackup: (
    req: Pick<GetLatestBackupParams, 'status' | 'source' | 'event'>,
  ) => Promise<{ data: LatestBackupRecord | null }>;
};

/**
 * Fetch the most recent successful Google Drive Escape Copy record on mount and
 * whenever `refreshKey` changes. Mirrors the cross-source `useLatestBackup`
 * hook (`libs/web/pages/account/src/hooks/useLatestBackup.ts`, private to
 * that route) but filters by `source='google-drive'` and `event='export'` so
 * the returned record is provider-scoped and excludes restore imports.
 */
export function useLatestCloudBackup(
  refreshKey = 0,
  apiFactory: LatestCloudBackupApiFactory = createVaultBackupsApi,
): LatestCloudBackupState {
  const [state, setState] = useState<LatestCloudBackupState>({
    status: 'loading',
    record: null,
  });

  const fetchLatest = useCallback(async () => {
    try {
      const api = apiFactory();
      const response = await api.getLatestBackup({
        status: 'success',
        source: 'google-drive',
        event: 'export',
      });
      // 200 with a null body means no backup exists yet.
      if (response.data === null) {
        setState({ status: 'empty', record: null });
        return;
      }
      setState({ status: 'loaded', record: response.data });
    } catch (error: unknown) {
      const err = error as { response?: { status?: number } };
      if (err?.response?.status === 404) {
        setState({ status: 'empty', record: null });
        return;
      }
      setState({ status: 'error', record: null, error });
    }
  }, [apiFactory]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ status: 'loading', record: null });
    void fetchLatest();
  }, [fetchLatest, refreshKey]);

  return state;
}
