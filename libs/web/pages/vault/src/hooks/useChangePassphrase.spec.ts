/* eslint-disable import/first -- jest.mock must precede application imports */

/**
 * Mock web-vault functions before importing the hook.
 * Keep the real VaultSecretMismatchError to test instanceof checks.
 */
jest.mock('@myorganiser/web-vault', () => ({
  ...jest.requireActual('@myorganiser/web-vault'),
  changePassphraseWithCurrent: jest.fn(),
  resetPassphraseAfterRecovery: jest.fn(),
  createVaultApi: jest.fn(),
}));

/**
 * Mock web-vault-ui functions.
 * Keep the real passphraseChangeReading to test actual copy.
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

import { renderHook, act, waitFor } from '@testing-library/react';
import {
  changePassphraseWithCurrent,
  createVaultApi,
  resetPassphraseAfterRecovery,
  VaultSecretMismatchError,
} from '@myorganiser/web-vault';
import { useOptionalVaultSession } from '@myorganiser/web-vault-ui';
import { useToast } from '@myorganiser/web-ui';
import { useChangePassphrase } from './useChangePassphrase';
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
    adoptVaultMetaWrapping: jest.fn(),
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

describe('useChangePassphrase', () => {
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
    test('1: no handle → returns "error" with destructive toast, never calls changePassphraseWithCurrent', async () => {
      const mockToast = jest.fn();
      (useOptionalVaultSession as jest.Mock).mockReturnValue(null);
      (useToast as jest.Mock).mockReturnValue({ toast: mockToast });

      const { result } = renderHook(() => useChangePassphrase());

      let callResult: 'ok' | 'wrong-passphrase' | 'error' | undefined;
      await act(async () => {
        callResult = await result.current.changePassphrase({
          currentPassphrase: 'old',
          newPassphrase: 'new1234567',
        });
      });

      expect(callResult).toBe('error');
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Cannot change passphrase',
          description: 'Unlock your vault first.',
          variant: 'destructive',
        }),
      );
      expect(changePassphraseWithCurrent).not.toHaveBeenCalled();
      expect(resetPassphraseAfterRecovery).not.toHaveBeenCalled();
    });

    test('2: masterKeyBytes === null → returns "error" with destructive toast, never calls changePassphraseWithCurrent', async () => {
      const mockToast = jest.fn();
      (useOptionalVaultSession as jest.Mock).mockReturnValue({
        handle: createMockHandle(),
        masterKeyBytes: null,
      });
      (useToast as jest.Mock).mockReturnValue({ toast: mockToast });

      const { result } = renderHook(() => useChangePassphrase());

      let callResult: 'ok' | 'wrong-passphrase' | 'error' | undefined;
      await act(async () => {
        callResult = await result.current.changePassphrase({
          currentPassphrase: 'old',
          newPassphrase: 'new1234567',
        });
      });

      expect(callResult).toBe('error');
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Cannot change passphrase',
          variant: 'destructive',
        }),
      );
      expect(changePassphraseWithCurrent).not.toHaveBeenCalled();
      expect(resetPassphraseAfterRecovery).not.toHaveBeenCalled();
    });
  });

  describe('Authorization by unlockSecret', () => {
    test('10: unlockSecret "passphrase" → changePassphraseWithCurrent with current+new, not resetPassphraseAfterRecovery', async () => {
      const mockHandle = createMockHandle();
      const mockCompletePassphraseResetPrompt = jest.fn();
      (useOptionalVaultSession as jest.Mock).mockReturnValue({
        handle: mockHandle,
        masterKeyBytes: new Uint8Array(32),
        unlockSecret: 'passphrase',
        completePassphraseResetPrompt: mockCompletePassphraseResetPrompt,
      });
      (changePassphraseWithCurrent as jest.Mock).mockResolvedValue({
        push: { kind: 'pushed' },
      });

      const { result } = renderHook(() => useChangePassphrase());

      let callResult: 'ok' | 'wrong-passphrase' | 'error' | undefined;
      await act(async () => {
        callResult = await result.current.changePassphrase({
          currentPassphrase: 'oldpass1234',
          newPassphrase: 'newpass12345',
        });
      });

      expect(callResult).toBe('ok');
      expect(changePassphraseWithCurrent).toHaveBeenCalledWith({
        api: {},
        handle: mockHandle,
        currentPassphrase: 'oldpass1234',
        newPassphrase: 'newpass12345',
      });
      expect(resetPassphraseAfterRecovery).not.toHaveBeenCalled();
      expect(mockCompletePassphraseResetPrompt).not.toHaveBeenCalled();
    });

    test('11: unlockSecret null → defaults to changePassphraseWithCurrent', async () => {
      const mockHandle = createMockHandle();
      (useOptionalVaultSession as jest.Mock).mockReturnValue({
        handle: mockHandle,
        masterKeyBytes: new Uint8Array(32),
        unlockSecret: null,
      });
      (changePassphraseWithCurrent as jest.Mock).mockResolvedValue({
        push: { kind: 'pushed' },
      });

      const { result } = renderHook(() => useChangePassphrase());

      await act(async () => {
        await result.current.changePassphrase({
          currentPassphrase: 'oldpass1234',
          newPassphrase: 'newpass12345',
        });
      });

      expect(changePassphraseWithCurrent).toHaveBeenCalled();
      expect(resetPassphraseAfterRecovery).not.toHaveBeenCalled();
    });

    test('12: unlockSecret "recovery-key" → resetPassphraseAfterRecovery with new only, not changePassphraseWithCurrent', async () => {
      const mockHandle = createMockHandle();
      const mockCompletePassphraseResetPrompt = jest.fn();
      (useOptionalVaultSession as jest.Mock).mockReturnValue({
        handle: mockHandle,
        masterKeyBytes: new Uint8Array(32),
        unlockSecret: 'recovery-key',
        completePassphraseResetPrompt: mockCompletePassphraseResetPrompt,
      });
      (resetPassphraseAfterRecovery as jest.Mock).mockResolvedValue({
        push: { kind: 'pushed' },
      });

      const { result } = renderHook(() => useChangePassphrase());

      let callResult: 'ok' | 'wrong-passphrase' | 'error' | undefined;
      await act(async () => {
        callResult = await result.current.changePassphrase({
          currentPassphrase: 'ignored1234',
          newPassphrase: 'newpass12345',
        });
      });

      expect(callResult).toBe('ok');
      expect(resetPassphraseAfterRecovery).toHaveBeenCalledWith({
        api: {},
        handle: mockHandle,
        newPassphrase: 'newpass12345',
      });
      expect(changePassphraseWithCurrent).not.toHaveBeenCalled();
      expect(mockCompletePassphraseResetPrompt).toHaveBeenCalledTimes(1);
    });

    test('13: unlockSecret "recovery-key" success → same passphraseChangeReading toast', async () => {
      const mockToast = jest.fn();
      (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
      (useOptionalVaultSession as jest.Mock).mockReturnValue({
        handle: createMockHandle(),
        masterKeyBytes: new Uint8Array(32),
        unlockSecret: 'recovery-key',
      });
      (resetPassphraseAfterRecovery as jest.Mock).mockResolvedValue({
        push: { kind: 'pushed' },
      });

      const { result } = renderHook(() => useChangePassphrase());

      await act(async () => {
        await result.current.changePassphrase({
          currentPassphrase: '',
          newPassphrase: 'newpass12345',
        });
      });

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Passphrase changed',
          description: expect.stringContaining('other devices'),
        }),
      );
    });

    test('14: unlockSecret "passkey" → changePassphraseWithCurrent with current+new, not resetPassphraseAfterRecovery, and the reset prompt is not completed', async () => {
      const mockHandle = createMockHandle();
      const mockCompletePassphraseResetPrompt = jest.fn();
      (useOptionalVaultSession as jest.Mock).mockReturnValue({
        handle: mockHandle,
        masterKeyBytes: new Uint8Array(32),
        unlockSecret: 'passkey',
        completePassphraseResetPrompt: mockCompletePassphraseResetPrompt,
      });
      (changePassphraseWithCurrent as jest.Mock).mockResolvedValue({
        push: { kind: 'pushed' },
      });

      const { result } = renderHook(() => useChangePassphrase());

      let callResult: 'ok' | 'wrong-passphrase' | 'error' | undefined;
      await act(async () => {
        callResult = await result.current.changePassphrase({
          currentPassphrase: 'oldpass1234',
          newPassphrase: 'newpass12345',
        });
      });

      expect(callResult).toBe('ok');
      expect(changePassphraseWithCurrent).toHaveBeenCalledWith({
        api: {},
        handle: mockHandle,
        currentPassphrase: 'oldpass1234',
        newPassphrase: 'newpass12345',
      });
      expect(resetPassphraseAfterRecovery).not.toHaveBeenCalled();
      expect(mockCompletePassphraseResetPrompt).not.toHaveBeenCalled();
    });

    test('15: unlockSecret "passkey" with a wrong current passphrase → returns "wrong-passphrase" and never resets', async () => {
      (useOptionalVaultSession as jest.Mock).mockReturnValue({
        handle: createMockHandle(),
        masterKeyBytes: new Uint8Array(32),
        unlockSecret: 'passkey',
        completePassphraseResetPrompt: jest.fn(),
      });
      (changePassphraseWithCurrent as jest.Mock).mockRejectedValue(
        new VaultSecretMismatchError('passphrase'),
      );

      const { result } = renderHook(() => useChangePassphrase());

      let callResult: 'ok' | 'wrong-passphrase' | 'error' | undefined;
      await act(async () => {
        callResult = await result.current.changePassphrase({
          currentPassphrase: 'wrongpass123',
          newPassphrase: 'newpass12345',
        });
      });

      expect(callResult).toBe('wrong-passphrase');
      expect(resetPassphraseAfterRecovery).not.toHaveBeenCalled();
    });
  });

  describe('Push outcomes — all non-destructive despite reaching server', () => {
    test('3: push kind "pushed" → returns "ok" and calls toast with non-destructive variant', async () => {
      const mockToast = jest.fn();
      (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
      (changePassphraseWithCurrent as jest.Mock).mockResolvedValue({
        push: { kind: 'pushed' },
      });

      const { result } = renderHook(() => useChangePassphrase());

      let callResult: 'ok' | 'wrong-passphrase' | 'error' | undefined;
      await act(async () => {
        callResult = await result.current.changePassphrase({
          currentPassphrase: 'oldpass1234',
          newPassphrase: 'newpass12345',
        });
      });

      expect(callResult).toBe('ok');
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Passphrase changed',
          description: expect.stringContaining('other devices'),
        }),
      );

      // Assert NOT destructive
      const toastCall = mockToast.mock.calls[0][0];
      expect(toastCall.variant).not.toBe('destructive');
      expect(toastCall.variant).toBeUndefined();
    });

    test('4: push kind "unreachable" → returns "ok" and calls toast non-destructive, copy says changed on device but not synced yet', async () => {
      const mockToast = jest.fn();
      (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
      (changePassphraseWithCurrent as jest.Mock).mockResolvedValue({
        push: { kind: 'unreachable' },
      });

      const { result } = renderHook(() => useChangePassphrase());

      let callResult: 'ok' | 'wrong-passphrase' | 'error' | undefined;
      await act(async () => {
        callResult = await result.current.changePassphrase({
          currentPassphrase: 'oldpass1234',
          newPassphrase: 'newpass12345',
        });
      });

      expect(callResult).toBe('ok');
      expect(mockToast).toHaveBeenCalled();

      const toastCall = mockToast.mock.calls[0][0];
      // Assert the real copy from passphraseChangeReading
      expect(toastCall.title).toContain('changed on this device');
      expect(toastCall.description).toContain('has not reached');
      expect(toastCall.variant).not.toBe('destructive');
      expect(toastCall.variant).toBeUndefined();
    });

    test('5: push kind "refused-server-moved" → returns "ok" and calls toast non-destructive, copy mentions next sign-in', async () => {
      const mockToast = jest.fn();
      (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
      (changePassphraseWithCurrent as jest.Mock).mockResolvedValue({
        push: { kind: 'refused-server-moved', change: 'passphrase' },
      });

      const { result } = renderHook(() => useChangePassphrase());

      let callResult: 'ok' | 'wrong-passphrase' | 'error' | undefined;
      await act(async () => {
        callResult = await result.current.changePassphrase({
          currentPassphrase: 'oldpass1234',
          newPassphrase: 'newpass12345',
        });
      });

      expect(callResult).toBe('ok');
      expect(mockToast).toHaveBeenCalled();

      const toastCall = mockToast.mock.calls[0][0];
      // Assert the real copy from passphraseChangeReading
      expect(toastCall.title).toContain('changed on this device');
      expect(toastCall.description).toContain('next time you sign in');
      expect(toastCall.variant).not.toBe('destructive');
      expect(toastCall.variant).toBeUndefined();
    });
  });

  describe('Error paths', () => {
    test('6: VaultSecretMismatchError on passphrase → returns "wrong-passphrase", NO toast called', async () => {
      const mockToast = jest.fn();
      const mockCompletePassphraseResetPrompt = jest.fn();
      (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
      (useOptionalVaultSession as jest.Mock).mockReturnValue({
        handle: createMockHandle(),
        masterKeyBytes: new Uint8Array(32),
        unlockSecret: 'passphrase',
        completePassphraseResetPrompt: mockCompletePassphraseResetPrompt,
      });
      (changePassphraseWithCurrent as jest.Mock).mockRejectedValue(
        new VaultSecretMismatchError('passphrase'),
      );

      const { result } = renderHook(() => useChangePassphrase());

      let callResult: 'ok' | 'wrong-passphrase' | 'error' | undefined;
      await act(async () => {
        callResult = await result.current.changePassphrase({
          currentPassphrase: 'wrongpass1234',
          newPassphrase: 'newpass12345',
        });
      });

      expect(callResult).toBe('wrong-passphrase');
      expect(mockToast).not.toHaveBeenCalled();
      expect(mockCompletePassphraseResetPrompt).not.toHaveBeenCalled();
    });

    test('7: unexpected error (not VaultSecretMismatchError) → returns "error" with destructive toast', async () => {
      const mockToast = jest.fn();
      (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
      (changePassphraseWithCurrent as jest.Mock).mockRejectedValue(
        new Error('Network failed'),
      );

      const { result } = renderHook(() => useChangePassphrase());

      let callResult: 'ok' | 'wrong-passphrase' | 'error' | undefined;
      await act(async () => {
        callResult = await result.current.changePassphrase({
          currentPassphrase: 'oldpass1234',
          newPassphrase: 'newpass12345',
        });
      });

      expect(callResult).toBe('error');
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Passphrase change failed',
          variant: 'destructive',
        }),
      );
    });
  });

  describe('Loading state', () => {
    test('8: changing is true while operation pending, false after completion', async () => {
      let resolveChange!: (value: { push: { kind: string } }) => void;
      (changePassphraseWithCurrent as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveChange = resolve;
          }),
      );

      const { result } = renderHook(() => useChangePassphrase());

      expect(result.current.changing).toBe(false);

      let callPromise: Promise<unknown>;
      act(() => {
        callPromise = result.current.changePassphrase({
          currentPassphrase: 'oldpass1234',
          newPassphrase: 'newpass12345',
        });
      });

      await waitFor(() => {
        expect(result.current.changing).toBe(true);
      });

      await act(async () => {
        resolveChange({ push: { kind: 'pushed' } });
        await callPromise!;
      });

      expect(result.current.changing).toBe(false);
    });
  });

  describe('Hook contract — reading usage', () => {
    test('9: success toast uses non-destructive reading from push outcome', async () => {
      const mockToast = jest.fn();

      (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
      (changePassphraseWithCurrent as jest.Mock).mockResolvedValue({
        push: { kind: 'pushed' },
      });

      const { result } = renderHook(() => useChangePassphrase());

      await act(async () => {
        await result.current.changePassphrase({
          currentPassphrase: 'oldpass1234',
          newPassphrase: 'newpass12345',
        });
      });

      // Assert toast was called with a reading (title and description from real passphraseChangeReading)
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
