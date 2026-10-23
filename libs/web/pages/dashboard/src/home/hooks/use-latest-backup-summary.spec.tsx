/* eslint-disable import/first */
jest.mock('@myorganiser/web-vault', () => ({
  createVaultBackupsApi: jest.fn(),
}));

import { renderHook, waitFor } from '@testing-library/react';
import { createVaultBackupsApi } from '@myorganiser/web-vault';
import { useLatestBackupSummary } from './use-latest-backup-summary';

describe('useLatestBackupSummary', () => {
  const getLatestBackup = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    getLatestBackup.mockReset();
    (createVaultBackupsApi as jest.Mock).mockReturnValue({ getLatestBackup });
  });

  it('does not query the backups API while disabled', () => {
    const { result } = renderHook(() => useLatestBackupSummary(false));

    expect(result.current).toEqual({ status: 'pending' });
    expect(createVaultBackupsApi).not.toHaveBeenCalled();
    expect(getLatestBackup).not.toHaveBeenCalled();
  });

  it('loads the latest successful export when enabled', async () => {
    getLatestBackup.mockResolvedValue({
      data: { createdAt: '2026-10-20T09:00:00.000Z', source: 'google-drive' },
    });

    const { result } = renderHook(() => useLatestBackupSummary(true));

    await waitFor(() => {
      expect(result.current).toEqual({
        status: 'loaded',
        record: {
          createdAt: '2026-10-20T09:00:00.000Z',
          source: 'google-drive',
        },
      });
    });
    expect(getLatestBackup).toHaveBeenCalledWith({
      status: 'success',
      event: 'export',
    });
  });

  it('reads as empty when the API answers 404 (no backup recorded yet)', async () => {
    getLatestBackup.mockRejectedValue({ response: { status: 404 } });

    const { result } = renderHook(() => useLatestBackupSummary(true));

    await waitFor(() => {
      expect(result.current).toEqual({ status: 'empty' });
    });
  });

  it('reads as error for any other failure', async () => {
    getLatestBackup.mockRejectedValue({ response: { status: 500 } });

    const { result } = renderHook(() => useLatestBackupSummary(true));

    await waitFor(() => {
      expect(result.current).toEqual({ status: 'error' });
    });
  });
});
