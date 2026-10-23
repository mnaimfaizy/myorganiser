/* eslint-disable import/first -- jest.mock must precede application imports */
import { act, renderHook } from '@testing-library/react';
import React from 'react';

const mockGetCurrentUser = jest.fn();
const mockCreateVaultHandle = jest.fn();
const mockCreateVaultApi = jest.fn();
const mockCreateVaultSyncQueue = jest.fn();
const mockCreateVaultPullTrigger = jest.fn();
const mockClaimUnclaimedLocalVaultOnEvidence = jest.fn();
const mockCheckVaultAbsentEvidence = jest.fn();

jest.mock('@myorganiser/auth', () => ({
  getCurrentUser: () => mockGetCurrentUser(),
}));

jest.mock('@myorganiser/web-vault', () => ({
  createVaultHandle: (opts: unknown) => mockCreateVaultHandle(opts),
  createVaultApi: () => mockCreateVaultApi(),
  createVaultSyncQueue: (opts: unknown) => mockCreateVaultSyncQueue(opts),
  createVaultPullTrigger: (opts: unknown) => mockCreateVaultPullTrigger(opts),
  createLocalVaultRevision: () => ({
    current: () => 0,
    bump: jest.fn(),
    subscribe: () => () => undefined,
  }),
  claimUnclaimedLocalVaultOnEvidence: (opts: unknown) =>
    mockClaimUnclaimedLocalVaultOnEvidence(opts),
  checkVaultAbsentEvidence: (opts: unknown) =>
    mockCheckVaultAbsentEvidence(opts),
}));

import {
  useOptionalVaultSession,
  useVaultLockState,
  VaultSessionProvider,
} from './session';

describe('useVaultLockState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUser.mockReturnValue({ id: 'user-a' });
    mockCreateVaultApi.mockReturnValue({});
    mockCreateVaultSyncQueue.mockReturnValue({
      vaultBlobChanged: jest.fn(),
      markUnsentFromBookmarks: jest.fn().mockResolvedValue(undefined),
    });
    mockCreateVaultPullTrigger.mockReturnValue({
      requestCheck: jest.fn(),
      check: jest.fn(),
      status: jest.fn(() => ({ sessionEnded: false })),
      subscribe: jest.fn(() => jest.fn()),
    });
    mockCreateVaultHandle.mockImplementation((opts) => ({
      owner: opts.owner,
      masterKeyBytes: opts.masterKeyBytes,
      vaultStatus: jest.fn(() => 'owned'),
    }));
    mockClaimUnclaimedLocalVaultOnEvidence.mockResolvedValue({
      kind: 'skipped-already-owned',
    });
    mockCheckVaultAbsentEvidence.mockResolvedValue({
      kind: 'no-server-vault',
    });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <VaultSessionProvider>{children}</VaultSessionProvider>
  );

  it('reports no-session when no Vault Session is mounted', () => {
    const { result } = renderHook(() => useVaultLockState());

    expect(result.current).toBe('no-session');
  });

  it('reports locked when a Vault Session is mounted without a Master Key', async () => {
    const { result } = renderHook(() => useVaultLockState(), { wrapper });
    // Flush the evidence checks the provider starts on mount.
    await act(async () => undefined);

    expect(result.current).toBe('locked');
  });

  it('reports unlocked once the Master Key is set on the session', async () => {
    const { result } = renderHook(
      () => ({
        lockState: useVaultLockState(),
        session: useOptionalVaultSession(),
      }),
      { wrapper },
    );
    expect(result.current.lockState).toBe('locked');
    await act(async () => undefined);

    act(() => {
      result.current.session?.setMasterKeyBytes(new Uint8Array(32));
    });

    expect(result.current.lockState).toBe('unlocked');
  });
});
