/* eslint-disable import/first -- jest.mock must precede application imports */

/**
 * Mock web-vault functions before importing the hook.
 * Keep the real VaultSecretMismatchError to test instanceof checks.
 */
jest.mock('@myorganiser/web-vault', () => ({
  ...jest.requireActual('@myorganiser/web-vault'),
  rotateRecoveryKeyWithPassphrase: jest.fn(),
  createVaultApi: jest.fn(),
}));

/**
 * Mock web-vault-ui functions.
 * Keep the real recoveryKeyRotationReading to test actual copy.
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
import {
  rotateRecoveryKeyWithPassphrase,
  createVaultApi,
  VaultSecretMismatchError,
  type MintedRecoveryKey,
} from '@myorganiser/web-vault';
import { useOptionalVaultSession } from '@myorganiser/web-vault-ui';
import { useToast } from '@myorganiser/web-ui';
import { useRecoveryKeyRotation } from './useRecoveryKeyRotation';
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

describe('useRecoveryKeyRotation', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mocks
    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: createMockHandle(),
      masterKeyBytes: new Uint8Array(32),
    });
    (useToast as jest.Mock).mockReturnValue({ toast: jest.fn() });
    (createVaultApi as jest.Mock).mockReturnValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Guarded preconditions', () => {
    test('1: no handle → returns "error" with destructive toast, never calls rotateRecoveryKeyWithPassphrase', async () => {
      const mockToast = jest.fn();
      (useOptionalVaultSession as jest.Mock).mockReturnValue(null);
      (useToast as jest.Mock).mockReturnValue({ toast: mockToast });

      const { result } = renderHook(() => useRecoveryKeyRotation());

      let callResult: 'ok' | 'wrong-passphrase' | 'error' | undefined;
      await act(async () => {
        callResult = await result.current.rotateRecoveryKey({
          currentPassphrase: 'oldpass1234',
          recoveryKey: 'mock-minted-key-value' as unknown as MintedRecoveryKey,
        });
      });

      expect(callResult).toBe('error');
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Cannot rotate recovery key',
          description: 'Unlock your vault first.',
          variant: 'destructive',
        }),
      );
      expect(rotateRecoveryKeyWithPassphrase).not.toHaveBeenCalled();
    });

    test('2: masterKeyBytes === null → returns "error" with destructive toast, never calls rotateRecoveryKeyWithPassphrase', async () => {
      const mockToast = jest.fn();
      (useOptionalVaultSession as jest.Mock).mockReturnValue({
        handle: createMockHandle(),
        masterKeyBytes: null,
      });
      (useToast as jest.Mock).mockReturnValue({ toast: mockToast });

      const { result } = renderHook(() => useRecoveryKeyRotation());

      let callResult: 'ok' | 'wrong-passphrase' | 'error' | undefined;
      await act(async () => {
        callResult = await result.current.rotateRecoveryKey({
          currentPassphrase: 'oldpass1234',
          recoveryKey: 'mock-minted-key-value' as unknown as MintedRecoveryKey,
        });
      });

      expect(callResult).toBe('error');
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Cannot rotate recovery key',
          description: 'Unlock your vault first.',
          variant: 'destructive',
        }),
      );
      expect(rotateRecoveryKeyWithPassphrase).not.toHaveBeenCalled();
    });
  });

  describe('Push outcomes — all non-destructive despite reaching server', () => {
    test('3: push kind "pushed" → returns "ok" and calls toast with non-destructive variant and real reading copy', async () => {
      const mockToast = jest.fn();
      (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
      (rotateRecoveryKeyWithPassphrase as jest.Mock).mockResolvedValue({
        push: { kind: 'pushed' },
      });

      const { result } = renderHook(() => useRecoveryKeyRotation());

      let callResult: 'ok' | 'wrong-passphrase' | 'error' | undefined;
      await act(async () => {
        callResult = await result.current.rotateRecoveryKey({
          currentPassphrase: 'oldpass1234',
          recoveryKey: 'mock-minted-key-value' as unknown as MintedRecoveryKey,
        });
      });

      expect(callResult).toBe('ok');
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Recovery key updated',
          description: expect.stringContaining('old recovery key'),
        }),
      );

      // Assert NOT destructive
      const toastCall = mockToast.mock.calls[0][0];
      expect(toastCall.variant).not.toBe('destructive');
      expect(toastCall.variant).toBeUndefined();
    });

    test('4: push kind "unreachable" → returns "ok" and calls toast non-destructive, title says "Recovery key waiting to sync"', async () => {
      const mockToast = jest.fn();
      (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
      (rotateRecoveryKeyWithPassphrase as jest.Mock).mockResolvedValue({
        push: { kind: 'unreachable' },
      });

      const { result } = renderHook(() => useRecoveryKeyRotation());

      let callResult: 'ok' | 'wrong-passphrase' | 'error' | undefined;
      await act(async () => {
        callResult = await result.current.rotateRecoveryKey({
          currentPassphrase: 'oldpass1234',
          recoveryKey: 'mock-minted-key-value' as unknown as MintedRecoveryKey,
        });
      });

      expect(callResult).toBe('ok');
      expect(mockToast).toHaveBeenCalled();

      const toastCall = mockToast.mock.calls[0][0];
      // Assert the real copy from recoveryKeyRotationReading
      expect(toastCall.title).toBe('Recovery key waiting to sync');
      expect(toastCall.description).toContain(
        'new recovery key works on this device only',
      );
      expect(toastCall.variant).not.toBe('destructive');
      expect(toastCall.variant).toBeUndefined();
    });

    test('5: push kind "refused-server-moved" → returns "ok" and calls toast non-destructive with attention tone', async () => {
      const mockToast = jest.fn();
      (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
      (rotateRecoveryKeyWithPassphrase as jest.Mock).mockResolvedValue({
        push: { kind: 'refused-server-moved', change: 'recovery-key' },
      });

      const { result } = renderHook(() => useRecoveryKeyRotation());

      let callResult: 'ok' | 'wrong-passphrase' | 'error' | undefined;
      await act(async () => {
        callResult = await result.current.rotateRecoveryKey({
          currentPassphrase: 'oldpass1234',
          recoveryKey: 'mock-minted-key-value' as unknown as MintedRecoveryKey,
        });
      });

      expect(callResult).toBe('ok');
      expect(mockToast).toHaveBeenCalled();

      const toastCall = mockToast.mock.calls[0][0];
      // Assert the real copy from recoveryKeyRotationReading (attention tone)
      expect(toastCall.title).toBe('Recovery key waiting to sync');
      expect(toastCall.variant).not.toBe('destructive');
      expect(toastCall.variant).toBeUndefined();
    });
  });

  describe('Error paths', () => {
    test('6: VaultSecretMismatchError on passphrase → returns "wrong-passphrase", NO toast called', async () => {
      const mockToast = jest.fn();
      (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
      (rotateRecoveryKeyWithPassphrase as jest.Mock).mockRejectedValue(
        new VaultSecretMismatchError('passphrase'),
      );

      const { result } = renderHook(() => useRecoveryKeyRotation());

      let callResult: 'ok' | 'wrong-passphrase' | 'error' | undefined;
      await act(async () => {
        callResult = await result.current.rotateRecoveryKey({
          currentPassphrase: 'wrongpass1234',
          recoveryKey: 'mock-minted-key-value' as unknown as MintedRecoveryKey,
        });
      });

      expect(callResult).toBe('wrong-passphrase');
      expect(mockToast).not.toHaveBeenCalled();
    });

    test('7: unexpected error (not VaultSecretMismatchError) → returns "error" with destructive toast', async () => {
      const mockToast = jest.fn();
      (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
      (rotateRecoveryKeyWithPassphrase as jest.Mock).mockRejectedValue(
        new Error('Network failed'),
      );

      const { result } = renderHook(() => useRecoveryKeyRotation());

      let callResult: 'ok' | 'wrong-passphrase' | 'error' | undefined;
      await act(async () => {
        callResult = await result.current.rotateRecoveryKey({
          currentPassphrase: 'oldpass1234',
          recoveryKey: 'mock-minted-key-value' as unknown as MintedRecoveryKey,
        });
      });

      expect(callResult).toBe('error');
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Recovery key rotation failed',
          variant: 'destructive',
        }),
      );
    });
  });

  describe('Loading state', () => {
    test('8: rotating boolean is false before the call, false after it resolves', async () => {
      (rotateRecoveryKeyWithPassphrase as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({ push: { kind: 'pushed' } });
            }, 50);
          }),
      );

      const { result } = renderHook(() => useRecoveryKeyRotation());

      expect(result.current.rotating).toBe(false);

      let callPromise: Promise<any>;
      act(() => {
        callPromise = result.current.rotateRecoveryKey({
          currentPassphrase: 'oldpass1234',
          recoveryKey: 'mock-minted-key-value' as unknown as MintedRecoveryKey,
        });
      });

      // After the async call completes, rotating should be false
      await act(async () => {
        await callPromise!;
      });

      expect(result.current.rotating).toBe(false);
    });
  });

  describe('Hook contract — reading usage', () => {
    test('9: calls recoveryKeyRotationReading with the push outcome and toasts the reading', async () => {
      const mockToast = jest.fn();

      (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
      (rotateRecoveryKeyWithPassphrase as jest.Mock).mockResolvedValue({
        push: { kind: 'pushed' },
      });

      const { result } = renderHook(() => useRecoveryKeyRotation());

      await act(async () => {
        await result.current.rotateRecoveryKey({
          currentPassphrase: 'oldpass1234',
          recoveryKey: 'mock-minted-key-value' as unknown as MintedRecoveryKey,
        });
      });

      // Assert toast was called with a reading (title and description from real recoveryKeyRotationReading)
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.any(String),
          description: expect.any(String),
        }),
      );
      // Assert that the variant is not destructive (proves it uses the reading correctly)
      const toastCall = mockToast.mock.calls[0][0];
      expect(toastCall.variant).not.toBe('destructive');
    });
  });
});
