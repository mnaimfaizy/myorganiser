/* eslint-disable import/first -- jest.mock must precede application imports */
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

const mockGetCurrentUser = jest.fn();
const mockCreateVaultHandle = jest.fn();
const mockCreateVaultApi = jest.fn();
const mockCreateVaultSyncQueue = jest.fn();
const mockCreateVaultPullTrigger = jest.fn();
/** The default shared api is the plain fake, so existing assertions hold. */
const mockCreateSharedVaultApi = jest.fn<unknown, [string]>(() =>
  mockCreateVaultApi(),
);
const mockCreateLocalVaultRevision = jest.fn(() => ({
  current: () => 0,
  bump: jest.fn(),
  subscribe: () => () => undefined,
}));
const mockClaimUnclaimedLocalVaultOnEvidence = jest.fn();
const mockCheckVaultAbsentEvidence = jest.fn();

jest.mock('@myorganiser/auth', () => ({
  getCurrentUser: () => mockGetCurrentUser(),
}));

jest.mock('@myorganiser/web-vault', () => ({
  createVaultHandle: (opts: unknown) => mockCreateVaultHandle(opts),
  createVaultApi: () => mockCreateVaultApi(),
  createSharedVaultApi: (owner: string) => mockCreateSharedVaultApi(owner),
  createVaultSyncQueue: (opts: unknown) => mockCreateVaultSyncQueue(opts),
  createVaultPullTrigger: (opts: unknown) => mockCreateVaultPullTrigger(opts),
  createLocalVaultRevision: () => mockCreateLocalVaultRevision(),
  claimUnclaimedLocalVaultOnEvidence: (opts: unknown) =>
    mockClaimUnclaimedLocalVaultOnEvidence(opts),
  checkVaultAbsentEvidence: (opts: unknown) =>
    mockCheckVaultAbsentEvidence(opts),
}));

import {
  useOptionalVaultSession,
  useVaultSession,
  VaultSessionProvider,
} from './session';

// Helper to read call arguments without exposing syncSink on the returned handle
const optionsOf = (call: number) =>
  mockCreateVaultHandle.mock.calls[call][0] as {
    owner: string;
    masterKeyBytes: Uint8Array | null;
    syncSink: unknown;
    revision: unknown;
  };

// Helper to set up distinct queues keyed on call order (order-independent)
const setupTwoQueueMock = (queueA: object, queueB: object) => {
  mockCreateVaultSyncQueue.mockImplementation(() => {
    const callIndex = mockCreateVaultSyncQueue.mock.calls.length - 1;
    return callIndex === 0 ? queueA : queueB;
  });
};

// Helper to set up distinct pull triggers keyed on call order (order-independent)
const setupTwoTriggerMock = (triggerA: object, triggerB: object) => {
  mockCreateVaultPullTrigger.mockImplementation(() => {
    const callIndex = mockCreateVaultPullTrigger.mock.calls.length - 1;
    return callIndex === 0 ? triggerA : triggerB;
  });
};

describe('VaultSessionProvider', () => {
  let mockApi: { getVaultBlob: jest.Mock; putVaultBlob: jest.Mock };
  let mockQueue: {
    vaultBlobChanged: jest.Mock;
    markUnsentFromBookmarks: jest.Mock;
  };
  let mockPullTrigger: {
    requestCheck: jest.Mock;
    check: jest.Mock;
    status: jest.Mock;
    subscribe: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Standard mock setup used by most tests
    mockApi = { getVaultBlob: jest.fn(), putVaultBlob: jest.fn() };
    mockCreateVaultApi.mockReturnValue(mockApi);
    mockCreateSharedVaultApi.mockImplementation(() => mockCreateVaultApi());

    mockQueue = {
      vaultBlobChanged: jest.fn(),
      markUnsentFromBookmarks: jest.fn().mockResolvedValue(undefined),
    };
    mockCreateVaultSyncQueue.mockReturnValue(mockQueue);

    mockPullTrigger = {
      requestCheck: jest.fn(),
      check: jest.fn(),
      status: jest.fn(() => ({ sessionEnded: false })),
      subscribe: jest.fn(() => jest.fn()),
    };
    mockCreateVaultPullTrigger.mockReturnValue(mockPullTrigger);

    // Standard handle stub: just echoes back the input, with vaultStatus method
    mockCreateVaultHandle.mockImplementation((opts) => ({
      owner: opts.owner,
      masterKeyBytes: opts.masterKeyBytes,
      vaultStatus: jest.fn(() => 'owned'),
    }));

    // Default mock primitives return success states
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

  test('constructs handle with signed-in owner on initial mount', () => {
    mockGetCurrentUser.mockReturnValue({ id: 'user-a' });
    mockCreateVaultHandle.mockImplementation((opts) => ({
      owner: opts.owner,
      masterKeyBytes: opts.masterKeyBytes,
      vaultStatus: jest.fn(() => 'owned'),
      __stub: true,
    }));

    const { result } = renderHook(() => useVaultSession(), { wrapper });

    expect(mockCreateVaultHandle).toHaveBeenCalledWith({
      owner: 'user-a',
      masterKeyBytes: null,
      syncSink: mockQueue,
      revision: expect.objectContaining({ subscribe: expect.any(Function) }),
    });
    expect(result.current.handle).toMatchObject({
      owner: 'user-a',
      masterKeyBytes: null,
      __stub: true,
    });
  });

  test('returns null handle and never calls createVaultHandle when no owner', () => {
    mockGetCurrentUser.mockReturnValue(undefined);

    const { result } = renderHook(() => useVaultSession(), { wrapper });

    expect(mockCreateVaultApi).not.toHaveBeenCalled();
    expect(mockCreateVaultSyncQueue).not.toHaveBeenCalled();
    expect(mockCreateVaultHandle).not.toHaveBeenCalled();
    expect(result.current.handle).toBeNull();
    expect(result.current.masterKeyBytes).toBeNull();
  });

  test('clears masterKeyBytes and updates handle when owner changes', async () => {
    mockGetCurrentUser.mockReturnValue({ id: 'user-a' });
    const mockQueueA = {
      vaultBlobChanged: jest.fn(),
      markUnsentFromBookmarks: jest.fn().mockResolvedValue(undefined),
    };
    const mockQueueB = {
      vaultBlobChanged: jest.fn(),
      markUnsentFromBookmarks: jest.fn().mockResolvedValue(undefined),
    };
    setupTwoQueueMock(mockQueueA, mockQueueB);

    const { result, rerender } = renderHook(() => useVaultSession(), {
      wrapper,
    });

    // Set masterKeyBytes for user-a
    act(() => {
      result.current.setMasterKeyBytes(new Uint8Array([1, 2, 3]));
    });

    await waitFor(() => {
      expect(result.current.masterKeyBytes).toEqual(new Uint8Array([1, 2, 3]));
    });
    expect(result.current.handle).toMatchObject({
      owner: 'user-a',
      masterKeyBytes: new Uint8Array([1, 2, 3]),
    });
    expect(optionsOf(0).syncSink).toBe(mockQueueA);

    // Switch owner
    mockGetCurrentUser.mockReturnValue({ id: 'user-b' });
    rerender();

    await waitFor(() => {
      expect(result.current.masterKeyBytes).toBeNull();
    });
    expect(result.current.handle).toMatchObject({
      owner: 'user-b',
      masterKeyBytes: null,
    });
    expect(optionsOf(2).syncSink).toBe(mockQueueB);
  });

  test('clears masterKeyBytes and nullifies handle when owner becomes undefined', async () => {
    mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

    const { result, rerender } = renderHook(() => useVaultSession(), {
      wrapper,
    });

    // Set masterKeyBytes for user-a
    act(() => {
      result.current.setMasterKeyBytes(new Uint8Array([4, 5, 6]));
    });

    await waitFor(() => {
      expect(result.current.masterKeyBytes).toEqual(new Uint8Array([4, 5, 6]));
    });
    expect(result.current.handle).toMatchObject({
      owner: 'user-a',
      masterKeyBytes: new Uint8Array([4, 5, 6]),
    });

    // Sign out
    mockGetCurrentUser.mockReturnValue(undefined);
    rerender();

    await waitFor(() => {
      expect(result.current.masterKeyBytes).toBeNull();
    });
    expect(result.current.handle).toBeNull();
  });

  test('does not spuriously clear masterKeyBytes on initial mount for same owner', async () => {
    mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

    const { result } = renderHook(() => useVaultSession(), { wrapper });

    // Immediately set masterKeyBytes in the same render cycle
    act(() => {
      result.current.setMasterKeyBytes(new Uint8Array([7, 8, 9]));
    });

    await waitFor(() => {
      expect(result.current.masterKeyBytes).toEqual(new Uint8Array([7, 8, 9]));
    });
    expect(result.current.handle).toMatchObject({
      owner: 'user-a',
      masterKeyBytes: new Uint8Array([7, 8, 9]),
    });
  });

  test('lock() clears masterKeyBytes', async () => {
    mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

    const { result } = renderHook(() => useVaultSession(), { wrapper });

    // Set masterKeyBytes
    act(() => {
      result.current.setMasterKeyBytes(new Uint8Array([10, 11, 12]));
    });

    await waitFor(() => {
      expect(result.current.masterKeyBytes).toEqual(
        new Uint8Array([10, 11, 12]),
      );
    });

    // Lock
    act(() => {
      result.current.lock();
    });

    await waitFor(() => {
      expect(result.current.masterKeyBytes).toBeNull();
    });
  });

  test('setMasterKeyBytes updates the masterKeyBytes state', async () => {
    mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

    const { result } = renderHook(() => useVaultSession(), { wrapper });

    expect(result.current.masterKeyBytes).toBeNull();

    // Set bytes
    const testBytes = new Uint8Array([13, 14, 15]);
    act(() => {
      result.current.setMasterKeyBytes(testBytes);
    });

    await waitFor(() => {
      expect(result.current.masterKeyBytes).toEqual(testBytes);
    });

    // Clear bytes
    act(() => {
      result.current.setMasterKeyBytes(null);
    });

    await waitFor(() => {
      expect(result.current.masterKeyBytes).toBeNull();
    });
  });

  describe('unlockSecret', () => {
    test('starts null while locked', () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      expect(result.current.unlockSecret).toBeNull();
      expect(result.current.masterKeyBytes).toBeNull();
    });

    test('records passphrase when setMasterKeyBytes is called with bytes only', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      act(() => {
        result.current.setMasterKeyBytes(new Uint8Array([1, 2, 3]));
      });

      await waitFor(() => {
        expect(result.current.unlockSecret).toBe('passphrase');
      });
    });

    test('records recovery-key when setMasterKeyBytes is called with that secret', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      act(() => {
        result.current.setMasterKeyBytes(
          new Uint8Array([4, 5, 6]),
          'recovery-key',
        );
      });

      await waitFor(() => {
        expect(result.current.unlockSecret).toBe('recovery-key');
      });
    });

    test('records passphrase when setMasterKeyBytes is called with explicit passphrase secret', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      act(() => {
        result.current.setMasterKeyBytes(
          new Uint8Array([7, 8, 9]),
          'passphrase',
        );
      });

      await waitFor(() => {
        expect(result.current.unlockSecret).toBe('passphrase');
      });
    });

    test('lock clears unlockSecret', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      act(() => {
        result.current.setMasterKeyBytes(
          new Uint8Array([10, 11, 12]),
          'recovery-key',
        );
      });

      await waitFor(() => {
        expect(result.current.unlockSecret).toBe('recovery-key');
      });

      act(() => {
        result.current.lock();
      });

      await waitFor(() => {
        expect(result.current.unlockSecret).toBeNull();
        expect(result.current.masterKeyBytes).toBeNull();
      });
    });

    test('lock then passphrase unlock records passphrase not recovery-key', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      act(() => {
        result.current.setMasterKeyBytes(
          new Uint8Array([19, 20, 21]),
          'recovery-key',
        );
      });

      await waitFor(() => {
        expect(result.current.unlockSecret).toBe('recovery-key');
      });

      act(() => {
        result.current.lock();
      });

      await waitFor(() => {
        expect(result.current.unlockSecret).toBeNull();
      });

      act(() => {
        result.current.setMasterKeyBytes(
          new Uint8Array([22, 23, 24]),
          'passphrase',
        );
      });

      await waitFor(() => {
        expect(result.current.unlockSecret).toBe('passphrase');
      });
    });

    test('setMasterKeyBytes(null) clears unlockSecret', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      act(() => {
        result.current.setMasterKeyBytes(
          new Uint8Array([13, 14, 15]),
          'recovery-key',
        );
      });

      await waitFor(() => {
        expect(result.current.unlockSecret).toBe('recovery-key');
      });

      act(() => {
        result.current.setMasterKeyBytes(null);
      });

      await waitFor(() => {
        expect(result.current.unlockSecret).toBeNull();
        expect(result.current.masterKeyBytes).toBeNull();
      });
    });

    test('owner change clears unlockSecret when unlocked', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

      const { result, rerender } = renderHook(() => useVaultSession(), {
        wrapper,
      });

      act(() => {
        result.current.setMasterKeyBytes(
          new Uint8Array([16, 17, 18]),
          'recovery-key',
        );
      });

      await waitFor(() => {
        expect(result.current.unlockSecret).toBe('recovery-key');
      });

      mockGetCurrentUser.mockReturnValue({ id: 'user-b' });
      rerender();

      await waitFor(() => {
        expect(result.current.unlockSecret).toBeNull();
        expect(result.current.masterKeyBytes).toBeNull();
      });
    });
  });

  describe('passphraseResetPromptOwed', () => {
    let setItemSpy: jest.SpyInstance;

    beforeEach(() => {
      setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
    });

    afterEach(() => {
      setItemSpy.mockRestore();
    });

    test('starts false while locked; recovery-key unlock owes it; passphrase unlock does not', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      expect(result.current.passphraseResetPromptOwed).toBe(false);

      act(() => {
        result.current.setMasterKeyBytes(
          new Uint8Array([1, 2, 3]),
          'recovery-key',
        );
      });

      await waitFor(() => {
        expect(result.current.passphraseResetPromptOwed).toBe(true);
        expect(result.current.unlockSecret).toBe('recovery-key');
      });

      act(() => {
        result.current.lock();
      });

      await waitFor(() => {
        expect(result.current.passphraseResetPromptOwed).toBe(false);
      });

      act(() => {
        result.current.setMasterKeyBytes(new Uint8Array([4, 5, 6]));
      });

      await waitFor(() => {
        expect(result.current.passphraseResetPromptOwed).toBe(false);
        expect(result.current.unlockSecret).toBe('passphrase');
      });

      act(() => {
        result.current.setMasterKeyBytes(
          new Uint8Array([7, 8, 9]),
          'passphrase',
        );
      });

      await waitFor(() => {
        expect(result.current.passphraseResetPromptOwed).toBe(false);
      });
    });

    test('skipPassphraseResetPrompt clears owed, keeps recovery-key unlock, second skip is no-op, and does not persist', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      act(() => {
        result.current.setMasterKeyBytes(
          new Uint8Array([10, 11, 12]),
          'recovery-key',
        );
      });

      await waitFor(() => {
        expect(result.current.passphraseResetPromptOwed).toBe(true);
      });

      const apiCallsBefore = mockCreateVaultApi.mock.calls.length;
      setItemSpy.mockClear();

      act(() => {
        result.current.skipPassphraseResetPrompt();
      });

      await waitFor(() => {
        expect(result.current.passphraseResetPromptOwed).toBe(false);
        expect(result.current.unlockSecret).toBe('recovery-key');
      });

      expect(setItemSpy).not.toHaveBeenCalled();
      expect(mockCreateVaultApi.mock.calls.length).toBe(apiCallsBefore);

      act(() => {
        result.current.skipPassphraseResetPrompt();
      });

      await waitFor(() => {
        expect(result.current.passphraseResetPromptOwed).toBe(false);
        expect(result.current.unlockSecret).toBe('recovery-key');
      });
    });

    test('completePassphraseResetPrompt clears owed, keeps recovery-key unlock, and does not persist', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      act(() => {
        result.current.setMasterKeyBytes(
          new Uint8Array([13, 14, 15]),
          'recovery-key',
        );
      });

      await waitFor(() => {
        expect(result.current.passphraseResetPromptOwed).toBe(true);
      });

      const apiCallsBefore = mockCreateVaultApi.mock.calls.length;
      setItemSpy.mockClear();

      act(() => {
        result.current.completePassphraseResetPrompt();
      });

      await waitFor(() => {
        expect(result.current.passphraseResetPromptOwed).toBe(false);
        expect(result.current.unlockSecret).toBe('recovery-key');
      });

      expect(setItemSpy).not.toHaveBeenCalled();
      expect(mockCreateVaultApi.mock.calls.length).toBe(apiCallsBefore);
    });

    test('lock then recovery unlock owes the prompt again after skip or complete', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      const recoveryBytes = new Uint8Array([16, 17, 18]);

      act(() => {
        result.current.setMasterKeyBytes(recoveryBytes, 'recovery-key');
      });

      await waitFor(() => {
        expect(result.current.passphraseResetPromptOwed).toBe(true);
      });

      act(() => {
        result.current.skipPassphraseResetPrompt();
      });

      await waitFor(() => {
        expect(result.current.passphraseResetPromptOwed).toBe(false);
      });

      act(() => {
        result.current.lock();
      });

      await waitFor(() => {
        expect(result.current.passphraseResetPromptOwed).toBe(false);
      });

      act(() => {
        result.current.setMasterKeyBytes(recoveryBytes, 'recovery-key');
      });

      await waitFor(() => {
        expect(result.current.passphraseResetPromptOwed).toBe(true);
      });

      act(() => {
        result.current.completePassphraseResetPrompt();
      });

      await waitFor(() => {
        expect(result.current.passphraseResetPromptOwed).toBe(false);
      });

      act(() => {
        result.current.lock();
        result.current.setMasterKeyBytes(recoveryBytes, 'recovery-key');
      });

      await waitFor(() => {
        expect(result.current.passphraseResetPromptOwed).toBe(true);
      });
    });

    test('passphrase unlock after recovery clears owed whether the prompt was still owed or skipped', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      act(() => {
        result.current.setMasterKeyBytes(
          new Uint8Array([19, 20, 21]),
          'recovery-key',
        );
      });

      await waitFor(() => {
        expect(result.current.passphraseResetPromptOwed).toBe(true);
      });

      act(() => {
        result.current.setMasterKeyBytes(
          new Uint8Array([22, 23, 24]),
          'passphrase',
        );
      });

      await waitFor(() => {
        expect(result.current.passphraseResetPromptOwed).toBe(false);
        expect(result.current.unlockSecret).toBe('passphrase');
      });

      act(() => {
        result.current.setMasterKeyBytes(
          new Uint8Array([25, 26, 27]),
          'recovery-key',
        );
      });

      await waitFor(() => {
        expect(result.current.passphraseResetPromptOwed).toBe(true);
      });

      act(() => {
        result.current.skipPassphraseResetPrompt();
      });

      await waitFor(() => {
        expect(result.current.passphraseResetPromptOwed).toBe(false);
      });

      act(() => {
        result.current.setMasterKeyBytes(
          new Uint8Array([28, 29, 30]),
          'passphrase',
        );
      });

      await waitFor(() => {
        expect(result.current.passphraseResetPromptOwed).toBe(false);
        expect(result.current.unlockSecret).toBe('passphrase');
      });
    });

    test('setMasterKeyBytes(null) and owner change clear passphraseResetPromptOwed', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

      const { result, rerender } = renderHook(() => useVaultSession(), {
        wrapper,
      });

      act(() => {
        result.current.setMasterKeyBytes(
          new Uint8Array([31, 32, 33]),
          'recovery-key',
        );
      });

      await waitFor(() => {
        expect(result.current.passphraseResetPromptOwed).toBe(true);
      });

      act(() => {
        result.current.setMasterKeyBytes(null);
      });

      await waitFor(() => {
        expect(result.current.passphraseResetPromptOwed).toBe(false);
      });

      act(() => {
        result.current.setMasterKeyBytes(
          new Uint8Array([34, 35, 36]),
          'recovery-key',
        );
      });

      await waitFor(() => {
        expect(result.current.passphraseResetPromptOwed).toBe(true);
      });

      mockGetCurrentUser.mockReturnValue({ id: 'user-b' });
      rerender();

      await waitFor(() => {
        expect(result.current.passphraseResetPromptOwed).toBe(false);
        expect(result.current.masterKeyBytes).toBeNull();
      });
    });

    test('skipPassphraseResetPrompt and completePassphraseResetPrompt are no-ops without a recovery-key unlock', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      act(() => {
        result.current.skipPassphraseResetPrompt();
        result.current.completePassphraseResetPrompt();
      });

      expect(result.current.passphraseResetPromptOwed).toBe(false);

      act(() => {
        result.current.setMasterKeyBytes(new Uint8Array([37, 38, 39]));
      });

      await waitFor(() => {
        expect(result.current.unlockSecret).toBe('passphrase');
        expect(result.current.passphraseResetPromptOwed).toBe(false);
      });

      act(() => {
        result.current.skipPassphraseResetPrompt();
        result.current.completePassphraseResetPrompt();
      });

      await waitFor(() => {
        expect(result.current.passphraseResetPromptOwed).toBe(false);
        expect(result.current.unlockSecret).toBe('passphrase');
      });
    });
  });

  describe('sync sink wiring', () => {
    test('handle gets the queue (identity check)', () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });
      mockCreateVaultHandle.mockImplementation(() => ({
        owner: 'user-a',
        vaultStatus: jest.fn(() => 'owned'),
      }));

      renderHook(() => useVaultSession(), { wrapper });

      // Verify the exact object from createVaultSyncQueue is passed to createVaultHandle
      expect(optionsOf(0).syncSink).toBe(mockQueue);
    });

    test('queue is built from the vault api and a deferring prompt', () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });
      mockCreateVaultHandle.mockImplementation(() => ({
        owner: 'user-a',
        vaultStatus: jest.fn(() => 'owned'),
      }));

      renderHook(() => useVaultSession(), { wrapper });

      // Verify createVaultSyncQueue was called with the right api and prompt
      expect(mockCreateVaultSyncQueue).toHaveBeenCalledWith(
        expect.objectContaining({
          api: mockApi,
          prompt: expect.any(Function),
        }),
      );

      // Verify the prompt function returns 'defer'
      const callArgs = mockCreateVaultSyncQueue.mock.calls[0][0];
      expect(callArgs.prompt()).toBe('defer');
    });

    test('pull trigger is built from the shared api for the owner', () => {
      const sharedApi = { shared: true };
      mockCreateSharedVaultApi.mockImplementation(() => sharedApi);
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });
      mockCreateVaultHandle.mockImplementation(() => ({
        owner: 'user-a',
        vaultStatus: jest.fn(() => 'owned'),
      }));

      renderHook(() => useVaultSession(), { wrapper });

      expect(mockCreateSharedVaultApi).toHaveBeenCalledWith('user-a');
      expect(mockCreateVaultPullTrigger.mock.calls[0][0].api).toBe(sharedApi);
    });

    test('sync queue is built from the plain api, never the shared one', () => {
      const sharedApi = { shared: true };
      mockCreateSharedVaultApi.mockImplementation(() => sharedApi);
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });
      mockCreateVaultHandle.mockImplementation(() => ({
        owner: 'user-a',
        vaultStatus: jest.fn(() => 'owned'),
      }));

      renderHook(() => useVaultSession(), { wrapper });

      expect(mockCreateVaultSyncQueue.mock.calls[0][0].api).toBe(mockApi);
      expect(mockCreateVaultSyncQueue.mock.calls[0][0].api).not.toBe(sharedApi);
    });

    test('no owner, no api or queue', () => {
      mockGetCurrentUser.mockReturnValue(undefined);

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      expect(mockCreateVaultApi).not.toHaveBeenCalled();
      expect(mockCreateVaultSyncQueue).not.toHaveBeenCalled();
      expect(result.current.handle).toBeNull();
    });

    test('markUnsentFromBookmarks is called with the handle on mount', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

      renderHook(() => useVaultSession(), { wrapper });

      await waitFor(() => {
        expect(mockQueue.markUnsentFromBookmarks).toHaveBeenCalledTimes(1);
      });

      // Verify it was called with the handle
      const callArg = (mockQueue.markUnsentFromBookmarks as jest.Mock).mock
        .calls[0][0];
      expect(callArg).toHaveProperty('owner', 'user-a');
      expect(callArg).toHaveProperty('masterKeyBytes', null);
    });

    test('markUnsentFromBookmarks is not called when there is no owner', () => {
      mockGetCurrentUser.mockReturnValue(undefined);

      renderHook(() => useVaultSession(), { wrapper });

      expect(mockQueue.markUnsentFromBookmarks).not.toHaveBeenCalled();
    });

    test('markUnsentFromBookmarks is called again when handle changes on lock', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      await waitFor(() => {
        expect(mockQueue.markUnsentFromBookmarks).toHaveBeenCalledTimes(1);
      });

      // Unlock by setting masterKeyBytes - this changes the handle identity
      act(() => {
        result.current.setMasterKeyBytes(new Uint8Array([1, 2, 3]));
      });

      await waitFor(() => {
        expect(result.current.masterKeyBytes).toEqual(
          new Uint8Array([1, 2, 3]),
        );
      });

      // markUnsentFromBookmarks should be called again after handle changes for unlock
      expect(mockQueue.markUnsentFromBookmarks).toHaveBeenCalledTimes(2);

      // Lock - this changes the handle identity again
      act(() => {
        result.current.lock();
      });

      await waitFor(() => {
        expect(result.current.masterKeyBytes).toBeNull();
      });

      // markUnsentFromBookmarks should be called again after lock (handle changed)
      expect(mockQueue.markUnsentFromBookmarks).toHaveBeenCalledTimes(3);

      // Verify the handle passed to the third call is the new locked one
      const thirdCallArg = (mockQueue.markUnsentFromBookmarks as jest.Mock).mock
        .calls[2][0];
      expect(thirdCallArg).toHaveProperty('owner', 'user-a');
      expect(thirdCallArg).toHaveProperty('masterKeyBytes', null);
    });

    test('queue survives lock/unlock', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      // Set masterKeyBytes
      act(() => {
        result.current.setMasterKeyBytes(new Uint8Array([1, 2, 3]));
      });

      await waitFor(() => {
        expect(result.current.masterKeyBytes).toEqual(
          new Uint8Array([1, 2, 3]),
        );
      });

      const firstSyncSink = optionsOf(0).syncSink;

      // Lock
      act(() => {
        result.current.lock();
      });

      await waitFor(() => {
        expect(result.current.masterKeyBytes).toBeNull();
      });

      // Verify the queue was called exactly once despite multiple handle creations
      expect(mockCreateVaultSyncQueue).toHaveBeenCalledTimes(1);

      // Verify handle received the same queue reference after lock
      expect(optionsOf(1).syncSink).toBe(firstSyncSink);
    });

    test('owner change rebuilds the queue', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });
      const mockQueueA = {
        vaultBlobChanged: jest.fn(),
        markUnsentFromBookmarks: jest.fn().mockResolvedValue(undefined),
      };
      const mockQueueB = {
        vaultBlobChanged: jest.fn(),
        markUnsentFromBookmarks: jest.fn().mockResolvedValue(undefined),
      };
      setupTwoQueueMock(mockQueueA, mockQueueB);

      const { result, rerender } = renderHook(() => useVaultSession(), {
        wrapper,
      });

      // Set masterKeyBytes for user-a
      act(() => {
        result.current.setMasterKeyBytes(new Uint8Array([1, 2, 3]));
      });

      await waitFor(() => {
        expect(result.current.masterKeyBytes).toEqual(
          new Uint8Array([1, 2, 3]),
        );
      });
      expect(optionsOf(0).syncSink).toBe(mockQueueA);

      // Switch owner
      mockGetCurrentUser.mockReturnValue({ id: 'user-b' });
      rerender();

      await waitFor(() => {
        expect(result.current.masterKeyBytes).toBeNull();
      });

      // Verify the queue was called twice and the new queue is used
      expect(mockCreateVaultSyncQueue).toHaveBeenCalledTimes(2);
      expect(optionsOf(2).syncSink).toBe(mockQueueB);
      expect(optionsOf(2).syncSink).not.toBe(mockQueueA);
    });
  });

  describe('pull trigger wiring', () => {
    test('trigger is built from the vault api and a deferring prompt', () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });
      mockCreateVaultHandle.mockImplementation(() => ({
        owner: 'user-a',
        vaultStatus: jest.fn(() => 'owned'),
      }));

      renderHook(() => useVaultSession(), { wrapper });

      // Verify createVaultPullTrigger was called with the right api and prompt
      expect(mockCreateVaultPullTrigger).toHaveBeenCalledWith(
        expect.objectContaining({
          api: mockApi,
          prompt: expect.any(Function),
        }),
      );

      // Verify the prompt function returns 'defer'
      const callArgs = mockCreateVaultPullTrigger.mock.calls[0][0];
      expect(callArgs.prompt()).toBe('defer');
    });

    test('trigger is exposed on context as result.current.pullTrigger', () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });
      mockCreateVaultHandle.mockImplementation(() => ({
        owner: 'user-a',
        vaultStatus: jest.fn(() => 'owned'),
      }));

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      // Verify the exact object from createVaultPullTrigger is exposed on context
      expect(result.current.pullTrigger).toBe(mockPullTrigger);
    });

    test('no owner, no trigger', () => {
      mockGetCurrentUser.mockReturnValue(undefined);

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      expect(mockCreateVaultPullTrigger).not.toHaveBeenCalled();
      expect(result.current.pullTrigger).toBeNull();
    });

    test('trigger survives lock/unlock', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      // Set masterKeyBytes
      act(() => {
        result.current.setMasterKeyBytes(new Uint8Array([1, 2, 3]));
      });

      await waitFor(() => {
        expect(result.current.masterKeyBytes).toEqual(
          new Uint8Array([1, 2, 3]),
        );
      });

      const firstPullTrigger = result.current.pullTrigger;

      // Lock
      act(() => {
        result.current.lock();
      });

      await waitFor(() => {
        expect(result.current.masterKeyBytes).toBeNull();
      });

      // Verify the trigger was created exactly once despite multiple handle creations
      expect(mockCreateVaultPullTrigger).toHaveBeenCalledTimes(1);

      // Verify the trigger stayed the same reference after lock
      expect(result.current.pullTrigger).toBe(firstPullTrigger);
    });

    test('owner change rebuilds the trigger', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });
      const mockTriggerA = {
        requestCheck: jest.fn(),
        check: jest.fn(),
        status: jest.fn(() => ({ sessionEnded: false })),
        subscribe: jest.fn(() => jest.fn()),
      };
      const mockTriggerB = {
        requestCheck: jest.fn(),
        check: jest.fn(),
        status: jest.fn(() => ({ sessionEnded: false })),
        subscribe: jest.fn(() => jest.fn()),
      };
      setupTwoTriggerMock(mockTriggerA, mockTriggerB);

      const { result, rerender } = renderHook(() => useVaultSession(), {
        wrapper,
      });

      // Set masterKeyBytes for user-a
      act(() => {
        result.current.setMasterKeyBytes(new Uint8Array([1, 2, 3]));
      });

      await waitFor(() => {
        expect(result.current.masterKeyBytes).toEqual(
          new Uint8Array([1, 2, 3]),
        );
      });
      expect(result.current.pullTrigger).toBe(mockTriggerA);

      // Switch owner
      mockGetCurrentUser.mockReturnValue({ id: 'user-b' });
      rerender();

      await waitFor(() => {
        expect(result.current.masterKeyBytes).toBeNull();
      });

      // Verify the trigger was called twice and the new trigger is used
      expect(mockCreateVaultPullTrigger).toHaveBeenCalledTimes(2);
      expect(result.current.pullTrigger).toBe(mockTriggerB);
      expect(result.current.pullTrigger).not.toBe(mockTriggerA);
    });

    test('trigger is not passed to createVaultHandle', () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });
      mockCreateVaultHandle.mockImplementation(() => ({
        owner: 'user-a',
        vaultStatus: jest.fn(() => 'owned'),
      }));

      renderHook(() => useVaultSession(), { wrapper });

      // Verify createVaultHandle was not passed the pull trigger
      const callArgs = mockCreateVaultHandle.mock.calls[0][0];
      expect(callArgs).not.toHaveProperty('pullTrigger');
    });
  });

  describe('vault evidence', () => {
    test('exposes claimEvidence and absentEvidence on context', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });
      // Mock the handle to have absent status for this test
      mockCreateVaultHandle.mockImplementation((opts) => ({
        owner: opts.owner,
        masterKeyBytes: opts.masterKeyBytes,
        vaultStatus: jest.fn(() => 'absent'),
      }));

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      // Wait for evidence to settle
      await waitFor(() => {
        expect(result.current.claimEvidence.status).toBe('settled');
      });

      await waitFor(() => {
        expect(result.current.absentEvidence.status).toBe('settled');
      });

      // Verify both are present on context
      expect(result.current).toHaveProperty('claimEvidence');
      expect(result.current).toHaveProperty('absentEvidence');
    });

    test('calls claimEvidence primitive once per owner on initial mount', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

      renderHook(() => useVaultSession(), { wrapper });

      await waitFor(() => {
        expect(mockClaimUnclaimedLocalVaultOnEvidence).toHaveBeenCalledTimes(1);
      });

      const callArg = mockClaimUnclaimedLocalVaultOnEvidence.mock.calls[0][0];
      expect(callArg.handle).toBeDefined();
      expect(callArg.api).toBeDefined();
    });

    test('claimEvidence settles with the library result', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });
      mockClaimUnclaimedLocalVaultOnEvidence.mockResolvedValue({
        kind: 'claimed',
      });

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      await waitFor(() => {
        expect(result.current.claimEvidence.status).toBe('settled');
      });

      expect(result.current.claimEvidence).toEqual({
        status: 'settled',
        result: { kind: 'claimed' },
      });
    });

    test('does not re-ask claimEvidence on provider re-render with same owner', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

      const { rerender } = renderHook(() => useVaultSession(), { wrapper });

      await waitFor(() => {
        expect(mockClaimUnclaimedLocalVaultOnEvidence).toHaveBeenCalledTimes(1);
      });

      // Re-render with same owner
      rerender();

      // Wait a bit to ensure no additional calls
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockClaimUnclaimedLocalVaultOnEvidence).toHaveBeenCalledTimes(1);
    });

    test('does not re-ask claimEvidence across lock/unlock (same owner)', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      await waitFor(() => {
        expect(mockClaimUnclaimedLocalVaultOnEvidence).toHaveBeenCalledTimes(1);
      });

      // After initial settle, handle should have been created once
      expect(mockCreateVaultHandle).toHaveBeenCalledTimes(1);

      // Unlock
      act(() => {
        result.current.setMasterKeyBytes(new Uint8Array([1, 2, 3]));
      });

      await waitFor(() => {
        expect(result.current.masterKeyBytes).toEqual(
          new Uint8Array([1, 2, 3]),
        );
      });

      // After unlock, handle should have been created a second time
      expect(mockCreateVaultHandle).toHaveBeenCalledTimes(2);
      expect(optionsOf(1).owner).toBe('user-a');
      expect(optionsOf(1).masterKeyBytes).toEqual(new Uint8Array([1, 2, 3]));

      // Lock
      act(() => {
        result.current.lock();
      });

      await waitFor(() => {
        expect(result.current.masterKeyBytes).toBeNull();
      });

      // After lock, handle should have been created a third time
      expect(mockCreateVaultHandle).toHaveBeenCalledTimes(3);
      expect(optionsOf(2).owner).toBe('user-a');
      expect(optionsOf(2).masterKeyBytes).toBeNull();

      // Wait a bit to ensure no additional calls
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should still be only 1 call (lock/unlock doesn't re-ask)
      expect(mockClaimUnclaimedLocalVaultOnEvidence).toHaveBeenCalledTimes(1);
    });

    test('claimEvidence returns checking immediately when owner changes, then settles', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });
      const mockQueueA = {
        vaultBlobChanged: jest.fn(),
        markUnsentFromBookmarks: jest.fn().mockResolvedValue(undefined),
      };
      const mockQueueB = {
        vaultBlobChanged: jest.fn(),
        markUnsentFromBookmarks: jest.fn().mockResolvedValue(undefined),
      };
      setupTwoQueueMock(mockQueueA, mockQueueB);

      const results = [
        { kind: 'claimed' as const },
        { kind: 'skipped-nothing-to-claim' as const },
      ];
      let callCount = 0;
      mockClaimUnclaimedLocalVaultOnEvidence.mockImplementation(async () => {
        return results[callCount++] || results[results.length - 1];
      });

      const { result, rerender } = renderHook(() => useVaultSession(), {
        wrapper,
      });

      // Wait for user-a's evidence to settle
      await waitFor(() => {
        expect(result.current.claimEvidence.status).toBe('settled');
      });
      expect(result.current.claimEvidence).toEqual({
        status: 'settled',
        result: { kind: 'claimed' },
      });

      // Change owner
      mockGetCurrentUser.mockReturnValue({ id: 'user-b' });
      rerender();

      // Should immediately return checking for new owner
      expect(result.current.claimEvidence.status).toBe('checking');

      // Then settle to new owner's result
      await waitFor(() => {
        expect(result.current.claimEvidence.status).toBe('settled');
      });
      expect(result.current.claimEvidence).toEqual({
        status: 'settled',
        result: { kind: 'skipped-nothing-to-claim' },
      });
    });

    test('absentEvidence settles with the library result', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });
      // Mock the handle to have absent status for this test
      mockCreateVaultHandle.mockImplementation((opts) => ({
        owner: opts.owner,
        masterKeyBytes: opts.masterKeyBytes,
        vaultStatus: jest.fn(() => 'absent'),
      }));
      mockCheckVaultAbsentEvidence.mockResolvedValue({
        kind: 'no-server-vault',
      });

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      await waitFor(() => {
        expect(result.current.absentEvidence.status).toBe('settled');
      });

      expect(result.current.absentEvidence).toEqual({
        status: 'settled',
        result: { kind: 'no-server-vault' },
      });
    });

    test('does not re-ask absentEvidence across lock/unlock (same owner)', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });
      // Mock the handle to have absent status for this test
      mockCreateVaultHandle.mockImplementation((opts) => ({
        owner: opts.owner,
        masterKeyBytes: opts.masterKeyBytes,
        vaultStatus: jest.fn(() => 'absent'),
      }));
      mockCheckVaultAbsentEvidence.mockResolvedValue({
        kind: 'no-server-vault',
      });

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      await waitFor(() => {
        expect(mockCheckVaultAbsentEvidence).toHaveBeenCalledTimes(1);
      });

      // After initial settle, handle should have been created once
      expect(mockCreateVaultHandle).toHaveBeenCalledTimes(1);

      // Unlock
      act(() => {
        result.current.setMasterKeyBytes(new Uint8Array([1, 2, 3]));
      });

      await waitFor(() => {
        expect(result.current.masterKeyBytes).toEqual(
          new Uint8Array([1, 2, 3]),
        );
      });

      // After unlock, handle should have been created a second time
      expect(mockCreateVaultHandle).toHaveBeenCalledTimes(2);
      expect(optionsOf(1).owner).toBe('user-a');
      expect(optionsOf(1).masterKeyBytes).toEqual(new Uint8Array([1, 2, 3]));

      // Lock
      act(() => {
        result.current.lock();
      });

      await waitFor(() => {
        expect(result.current.masterKeyBytes).toBeNull();
      });

      // After lock, handle should have been created a third time
      expect(mockCreateVaultHandle).toHaveBeenCalledTimes(3);
      expect(optionsOf(2).owner).toBe('user-a');
      expect(optionsOf(2).masterKeyBytes).toBeNull();

      // Wait a bit to ensure no additional calls
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should still be only 1 call to absentEvidence (lock/unlock doesn't re-ask)
      expect(mockCheckVaultAbsentEvidence).toHaveBeenCalledTimes(1);
    });

    test('a new owner reads checking for absentEvidence, then settles from its own ask', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });
      // Mock the handle to have absent status for this test
      mockCreateVaultHandle.mockImplementation((opts) => ({
        owner: opts.owner,
        masterKeyBytes: opts.masterKeyBytes,
        vaultStatus: jest.fn(() => 'absent'),
      }));

      const results = [
        { kind: 'no-server-vault' as const },
        { kind: 'server-has-vault' as const },
      ];
      let callCount = 0;
      mockCheckVaultAbsentEvidence.mockImplementation(async () => {
        return results[callCount++] || results[results.length - 1];
      });

      const { result, rerender } = renderHook(() => useVaultSession(), {
        wrapper,
      });

      // Wait for user-a's evidence to settle
      await waitFor(() => {
        expect(result.current.absentEvidence.status).toBe('settled');
      });
      expect(result.current.absentEvidence).toEqual({
        status: 'settled',
        result: { kind: 'no-server-vault' },
      });

      // Change owner
      mockGetCurrentUser.mockReturnValue({ id: 'user-b' });
      rerender();

      // Should immediately return checking for new owner
      expect(result.current.absentEvidence.status).toBe('checking');

      // Then settle to new owner's result
      await waitFor(() => {
        expect(result.current.absentEvidence.status).toBe('settled');
      });
      expect(result.current.absentEvidence).toEqual({
        status: 'settled',
        result: { kind: 'server-has-vault' },
      });

      // Should have been called twice (once per owner)
      expect(mockCheckVaultAbsentEvidence).toHaveBeenCalledTimes(2);
    });

    test('no owner returns checking for both evidence', async () => {
      mockGetCurrentUser.mockReturnValue(undefined);

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      expect(result.current.claimEvidence.status).toBe('settled');
      expect(result.current.claimEvidence).toEqual({
        status: 'settled',
        result: { kind: 'skipped-nothing-to-claim' },
      });

      // absentEvidence without owner stays checking
      expect(result.current.absentEvidence.status).toBe('checking');

      // Primitives should not be called
      expect(mockClaimUnclaimedLocalVaultOnEvidence).not.toHaveBeenCalled();
      expect(mockCheckVaultAbsentEvidence).not.toHaveBeenCalled();
    });
  });

  describe('passkey unlock secret (ADR 0136)', () => {
    test('a passkey unlock records "passkey" and owes no passphrase reset prompt', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      act(() => {
        result.current.setMasterKeyBytes(new Uint8Array([1, 2, 3]), 'passkey');
      });

      await waitFor(() => {
        expect(result.current.unlockSecret).toBe('passkey');
        expect(result.current.masterKeyBytes).toEqual(
          new Uint8Array([1, 2, 3]),
        );
        expect(result.current.passphraseResetPromptOwed).toBe(false);
      });
    });

    test('skip and complete on a passkey session are no-ops: nothing owed, secret unchanged', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      act(() => {
        result.current.setMasterKeyBytes(new Uint8Array([4, 5, 6]), 'passkey');
      });

      await waitFor(() => {
        expect(result.current.unlockSecret).toBe('passkey');
      });

      act(() => {
        result.current.skipPassphraseResetPrompt();
        result.current.completePassphraseResetPrompt();
      });

      await waitFor(() => {
        expect(result.current.passphraseResetPromptOwed).toBe(false);
        expect(result.current.unlockSecret).toBe('passkey');
      });
    });

    test('a recovery-key unlock after a passkey session still owes the prompt', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      act(() => {
        result.current.setMasterKeyBytes(new Uint8Array([7, 8, 9]), 'passkey');
      });

      await waitFor(() => {
        expect(result.current.unlockSecret).toBe('passkey');
      });

      act(() => {
        result.current.setMasterKeyBytes(
          new Uint8Array([10, 11, 12]),
          'recovery-key',
        );
      });

      await waitFor(() => {
        expect(result.current.unlockSecret).toBe('recovery-key');
        expect(result.current.passphraseResetPromptOwed).toBe(true);
      });
    });

    test('lock clears the passkey unlock secret', async () => {
      mockGetCurrentUser.mockReturnValue({ id: 'user-a' });

      const { result } = renderHook(() => useVaultSession(), { wrapper });

      act(() => {
        result.current.setMasterKeyBytes(
          new Uint8Array([13, 14, 15]),
          'passkey',
        );
      });

      await waitFor(() => {
        expect(result.current.unlockSecret).toBe('passkey');
      });

      act(() => {
        result.current.lock();
      });

      await waitFor(() => {
        expect(result.current.masterKeyBytes).toBeNull();
        expect(result.current.unlockSecret).toBeNull();
        expect(result.current.passphraseResetPromptOwed).toBe(false);
      });
    });
  });
});

describe('useVaultSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('throws error when called outside VaultSessionProvider', () => {
    // Suppress console.error during this test since renderHook will log the error
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    expect(() => {
      renderHook(() => useVaultSession());
    }).toThrow('useVaultSession must be used within VaultSessionProvider');

    consoleErrorSpy.mockRestore();
  });

  test('returns context value when called inside provider', () => {
    mockGetCurrentUser.mockReturnValue({ id: 'user-a' });
    const mockApi = { getVaultBlob: jest.fn(), putVaultBlob: jest.fn() };
    mockCreateVaultApi.mockReturnValue(mockApi);
    const mockQueue = {
      vaultBlobChanged: jest.fn(),
      markUnsentFromBookmarks: jest.fn().mockResolvedValue(undefined),
    };
    mockCreateVaultSyncQueue.mockReturnValue(mockQueue);
    mockCreateVaultHandle.mockImplementation((opts) => ({
      owner: opts.owner,
      vaultStatus: jest.fn(() => 'owned'),
    }));

    const { result } = renderHook(() => useVaultSession(), {
      wrapper: ({ children }) => (
        <VaultSessionProvider>{children}</VaultSessionProvider>
      ),
    });

    expect(result.current.masterKeyBytes).toBeNull();
    expect(result.current.handle?.owner).toBe('user-a');
    expect(typeof result.current.setMasterKeyBytes).toBe('function');
    expect(typeof result.current.lock).toBe('function');
  });
});

describe('useOptionalVaultSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns null when called outside VaultSessionProvider', () => {
    const { result } = renderHook(() => useOptionalVaultSession());

    expect(result.current).toBeNull();
  });

  test('returns context value when called inside provider', () => {
    mockGetCurrentUser.mockReturnValue({ id: 'user-a' });
    const mockApi = { getVaultBlob: jest.fn(), putVaultBlob: jest.fn() };
    mockCreateVaultApi.mockReturnValue(mockApi);
    const mockQueue = {
      vaultBlobChanged: jest.fn(),
      markUnsentFromBookmarks: jest.fn().mockResolvedValue(undefined),
    };
    mockCreateVaultSyncQueue.mockReturnValue(mockQueue);
    mockCreateVaultHandle.mockImplementation((opts) => ({
      owner: opts.owner,
      vaultStatus: jest.fn(() => 'owned'),
    }));

    const { result } = renderHook(() => useOptionalVaultSession(), {
      wrapper: ({ children }) => (
        <VaultSessionProvider>{children}</VaultSessionProvider>
      ),
    });

    expect(result.current).not.toBeNull();
    expect(result.current?.masterKeyBytes).toBeNull();
    expect(result.current?.handle?.owner).toBe('user-a');
  });
});
