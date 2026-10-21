'use client';

import { createVaultBackupsApi } from '@myorganiser/web-vault';
import { useEffect, useState } from 'react';
import type { BackupState } from '../home-view';

/**
 * The most recent successful export, for the Vault space line. Only fetched
 * while the vault is unlocked. 404 means no backup has been recorded yet.
 */
export function useLatestBackupSummary(enabled: boolean): BackupState {
  const [state, setState] = useState<BackupState>({ status: 'pending' });

  useEffect(() => {
    if (!enabled) return;

    let isActive = true;

    createVaultBackupsApi()
      .getLatestBackup({ status: 'success', event: 'export' })
      .then((response) => {
        if (!isActive) return;
        setState({
          status: 'loaded',
          record: {
            createdAt: response.data.createdAt,
            source: response.data.source,
          },
        });
      })
      .catch((error: unknown) => {
        if (!isActive) return;
        const status = (error as { response?: { status?: number } })?.response
          ?.status;
        setState(status === 404 ? { status: 'empty' } : { status: 'error' });
      });

    return () => {
      isActive = false;
    };
  }, [enabled]);

  return state;
}
