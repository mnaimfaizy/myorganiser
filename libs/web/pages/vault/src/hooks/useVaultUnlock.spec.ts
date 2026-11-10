/* eslint-disable import/first -- jest.mock must precede application imports */

/**
 * Mock web-vault functions before importing the hook.
 * Keep the real VaultSecretMismatchError to test instanceof checks.
 */
jest.mock('@myorganiser/web-vault', () => ({
  ...jest.requireActual('@myorganiser/web-vault'),
}));

/**
 * Mock web-vault-ui functions.
 */
jest.mock('@myorganiser/web-vault-ui', () => ({
  ...jest.requireActual('@myorganiser/web-vault-ui'),
  useOptionalVaultSession: jest.fn(),
}));

/**
 * Mock web-ui hook.
 */
jest.mock('@myorganiser/web-ui', () => ({
  useToast: jest.fn(),
}));

/**
 * Mock utils.
 */
jest.mock('../utils/getErrorMessage', () => ({
  getErrorMessage: jest.fn((error: Error) => error.message),
}));

import { renderHook, act } from '@testing-library/react';
import { VaultSecretMismatchError } from '@myorganiser/web-vault';
import { useOptionalVaultSession } from '@myorganiser/web-vault-ui';
import { useToast } from '@myorganiser/web-ui';
import { useVaultUnlock } from './useVaultUnlock';
import type { VaultHandle } from '@myorganiser/web-vault';

// === Mock helpers ===

function createMockHandle(overrides?: Partial<VaultHandle>): VaultHandle {
  const base: VaultHandle = {
    owner: 'test-owner',
    isUnlocked: false,
    hasVault: jest.fn().mockReturnValue(true),
    hasOwnedVault: jest.fn().mockReturnValue(true),
    loadVault: jest.fn().mockReturnValue(null),
    saveVault: jest.fn(),
    removeVault: jest.fn(),
    initialize: jest.fn(),
    unlockWithPassphrase: jest.fn(),
    unlockWithRecoveryKey: jest.fn(),
    changePassphrase: jest.fn(),
    resetPassphrase: jest.fn(),
    rotateRecoveryKey: jest.fn(),
    loadDecryptedData: jest.fn(),
    loadDecryptedDataWithCiphertext: jest.fn(),
    saveEncryptedData: jest.fn(),
    vaultStatus: jest.fn().mockReturnValue('absent'),
    hasUnclaimedLocalVault: jest.fn().mockReturnValue(false),
    claimUnclaimedLocalVaultLocked: jest.fn(),
    loadUnclaimedVault: jest.fn().mockReturnValue(null),
    claimUnclaimedLocalVaultByRecoveryKey: jest.fn(),
    replaceOwnedLocalVaultWithUnclaimedLocked: jest.fn(),
    replaceOwnedLocalVaultWithUnclaimedByRecoveryKey: jest.fn(),
    hasUnsentChanges: jest.fn().mockResolvedValue(false),
    lastPushedEtag: jest.fn().mockReturnValue(undefined),
    recordPushSuccess: jest.fn(),
    lastAgreedVaultMetaHash: jest.fn().mockReturnValue(undefined),
    recordVaultMetaAgreement: jest.fn(),
    observedVaultIdentity: jest.fn().mockReturnValue(undefined),
    recordObservedVaultIdentity: jest.fn(),
    isVaultMetaRefused: jest.fn().mockResolvedValue(false),
    recordVaultMetaRefusal: jest.fn(),
    isRecoveryKeyUnacknowledged: jest.fn().mockResolvedValue(false),
    recordUnacknowledgedRecoveryKey: jest.fn(),
    acknowledgeRecoveryKey: jest.fn(),
    forgetSyncBookmarks: jest.fn(),
    decryptCiphertext: jest.fn(),
  };
  return { ...base, ...overrides };
}

describe('useVaultUnlock', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mocks
    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: createMockHandle(),
      setMasterKeyBytes: jest.fn(),
    });
    (useToast as jest.Mock).mockReturnValue({ toast: jest.fn() });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Guarded preconditions', () => {
    test('1: no handle → returns "error" with destructive toast, never calls unlockWithPassphrase', async () => {
      const mockToast = jest.fn();
      (useOptionalVaultSession as jest.Mock).mockReturnValue({
        handle: null,
        setMasterKeyBytes: jest.fn(),
      });
      (useToast as jest.Mock).mockReturnValue({ toast: mockToast });

      const { result } = renderHook(() => useVaultUnlock());

      let callResult: 'ok' | 'wrong-passphrase' | 'error' | undefined;
      await act(async () => {
        callResult = await result.current.unlock('testpass1234');
      });

      expect(callResult).toBe('error');
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Unlock failed',
          description: 'Sign in to unlock a vault.',
          variant: 'destructive',
        }),
      );
    });

    test('2: no setMasterKeyBytes → returns "error" with destructive toast, never calls unlockWithPassphrase', async () => {
      const mockToast = jest.fn();
      const mockHandle = createMockHandle();
      (useOptionalVaultSession as jest.Mock).mockReturnValue({
        handle: mockHandle,
        setMasterKeyBytes: undefined,
      });
      (useToast as jest.Mock).mockReturnValue({ toast: mockToast });

      const { result } = renderHook(() => useVaultUnlock());

      let callResult: 'ok' | 'wrong-passphrase' | 'error' | undefined;
      await act(async () => {
        callResult = await result.current.unlock('testpass1234');
      });

      expect(callResult).toBe('error');
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Unlock failed',
          description: 'Sign in to unlock a vault.',
          variant: 'destructive',
        }),
      );
      expect(mockHandle.unlockWithPassphrase).not.toHaveBeenCalled();
    });
  });

  describe('Happy path', () => {
    test('3: unlockWithPassphrase resolves with masterKeyBytes → returns "ok", calls setMasterKeyBytes, non-destructive toast', async () => {
      const mockToast = jest.fn();
      const mockSetMasterKeyBytes = jest.fn();
      const mockMasterKeyBytes = new Uint8Array(32);
      const mockHandle = createMockHandle({
        unlockWithPassphrase: jest.fn().mockResolvedValue({
          masterKeyBytes: mockMasterKeyBytes,
        }),
      });

      (useOptionalVaultSession as jest.Mock).mockReturnValue({
        handle: mockHandle,
        setMasterKeyBytes: mockSetMasterKeyBytes,
      });
      (useToast as jest.Mock).mockReturnValue({ toast: mockToast });

      const { result } = renderHook(() => useVaultUnlock());

      let callResult: 'ok' | 'wrong-passphrase' | 'error' | undefined;
      await act(async () => {
        callResult = await result.current.unlock('correctpass123');
      });

      expect(callResult).toBe('ok');
      expect(mockSetMasterKeyBytes).toHaveBeenCalledWith(
        mockMasterKeyBytes,
        'passphrase',
      );
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Unlocked',
          description: 'Vault unlocked for this session.',
        }),
      );

      // Assert NOT destructive
      const toastCall = mockToast.mock.calls[0][0];
      expect(toastCall.variant).not.toBe('destructive');
      expect(toastCall.variant).toBeUndefined();
    });

    test('4: unlockWithPassphrase called with exact passphrase argument', async () => {
      const mockSetMasterKeyBytes = jest.fn();
      const mockHandle = createMockHandle({
        unlockWithPassphrase: jest.fn().mockResolvedValue({
          masterKeyBytes: new Uint8Array(32),
        }),
      });

      (useOptionalVaultSession as jest.Mock).mockReturnValue({
        handle: mockHandle,
        setMasterKeyBytes: mockSetMasterKeyBytes,
      });
      (useToast as jest.Mock).mockReturnValue({ toast: jest.fn() });

      const { result } = renderHook(() => useVaultUnlock());

      const testPassphrase = 'my-secret-pass';
      await act(async () => {
        await result.current.unlock(testPassphrase);
      });

      expect(mockHandle.unlockWithPassphrase).toHaveBeenCalledWith({
        passphrase: testPassphrase,
      });
    });
  });

  describe('Error paths', () => {
    test('5: VaultSecretMismatchError on passphrase → returns "wrong-passphrase", NO toast called, NO setMasterKeyBytes', async () => {
      const mockToast = jest.fn();
      const mockSetMasterKeyBytes = jest.fn();
      const mockHandle = createMockHandle({
        unlockWithPassphrase: jest
          .fn()
          .mockRejectedValue(new VaultSecretMismatchError('passphrase')),
      });

      (useOptionalVaultSession as jest.Mock).mockReturnValue({
        handle: mockHandle,
        setMasterKeyBytes: mockSetMasterKeyBytes,
      });
      (useToast as jest.Mock).mockReturnValue({ toast: mockToast });

      const { result } = renderHook(() => useVaultUnlock());

      let callResult: 'ok' | 'wrong-passphrase' | 'error' | undefined;
      await act(async () => {
        callResult = await result.current.unlock('wrongpass1234');
      });

      expect(callResult).toBe('wrong-passphrase');
      expect(mockToast).not.toHaveBeenCalled();
      expect(mockSetMasterKeyBytes).not.toHaveBeenCalled();
    });

    test('6: unexpected error (not VaultSecretMismatchError) → returns "error" with destructive toast, NO setMasterKeyBytes', async () => {
      const mockToast = jest.fn();
      const mockSetMasterKeyBytes = jest.fn();
      const mockHandle = createMockHandle({
        unlockWithPassphrase: jest
          .fn()
          .mockRejectedValue(new Error('Network failed')),
      });

      (useOptionalVaultSession as jest.Mock).mockReturnValue({
        handle: mockHandle,
        setMasterKeyBytes: mockSetMasterKeyBytes,
      });
      (useToast as jest.Mock).mockReturnValue({ toast: mockToast });

      const { result } = renderHook(() => useVaultUnlock());

      let callResult: 'ok' | 'wrong-passphrase' | 'error' | undefined;
      await act(async () => {
        callResult = await result.current.unlock('somepass1234');
      });

      expect(callResult).toBe('error');
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Unlock failed',
          variant: 'destructive',
        }),
      );
      expect(mockSetMasterKeyBytes).not.toHaveBeenCalled();
    });
  });

  describe('Loading state', () => {
    test('7: unlocking is false initially and false after async operation completes', async () => {
      const mockSetMasterKeyBytes = jest.fn();
      const mockHandle = createMockHandle({
        unlockWithPassphrase: jest.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              setTimeout(() => {
                resolve({ masterKeyBytes: new Uint8Array(32) });
              }, 50);
            }),
        ),
      });

      (useOptionalVaultSession as jest.Mock).mockReturnValue({
        handle: mockHandle,
        setMasterKeyBytes: mockSetMasterKeyBytes,
      });
      (useToast as jest.Mock).mockReturnValue({ toast: jest.fn() });

      const { result } = renderHook(() => useVaultUnlock());

      expect(result.current.unlocking).toBe(false);

      let callPromise: Promise<any>;
      act(() => {
        callPromise = result.current.unlock('testpass1234');
      });

      // After the async call completes, unlocking should be false
      await act(async () => {
        await callPromise!;
      });

      expect(result.current.unlocking).toBe(false);
    });
  });
});
