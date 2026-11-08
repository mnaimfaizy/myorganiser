'use client';

import { createVaultBackupsApi } from '@myorganiser/web-vault';
import { useCallback, useEffect, useState } from 'react';

/**
 * Minimal record shape consumed by `LastBackupCard`. Kept here (not imported
 * from the generated client) so a regeneration that adds optional fields does
 * not require updating this hook.
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

export type LatestBackupState =
  | { status: 'loading'; record: null }
  | { status: 'empty'; record: null }
  | { status: 'loaded'; record: LatestBackupRecord }
  | { status: 'error'; record: null; error: unknown };

/**
 * Fetch the most recent successful export record on mount.
 * - 200 → `loaded` with the record
 * - 200 with a null body → `empty` (no backups yet)
 * - any other error → `error`
 */
export function useLatestBackup(
  apiFactory: () => {
    getLatestBackup: (req: {
      status?: string;
      event?: string;
    }) => Promise<{ data: LatestBackupRecord | null }>;
  } = createVaultBackupsApi as unknown as () => {
    getLatestBackup: (req: {
      status?: string;
      event?: string;
    }) => Promise<{ data: LatestBackupRecord | null }>;
  },
): LatestBackupState {
  const [state, setState] = useState<LatestBackupState>({
    status: 'loading',
    record: null,
  });

  const fetchLatest = useCallback(async () => {
    try {
      const api = apiFactory();
      // Exports only: a restore is not a backup and must not read as one.
      const response = await api.getLatestBackup({
        status: 'success',
        event: 'export',
      });
      // 200 with a null body means no backup exists yet.
      if (!response.data) {
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
    // Async data fetch; setState only fires after the awaited promise resolves,
    // not synchronously during the effect body. Disable the heuristic.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchLatest();
  }, [fetchLatest]);

  return state;
}
