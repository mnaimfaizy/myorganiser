/* eslint-disable import/first -- jest.mock must precede application imports */

/**
 * Mock web-vault-ui hooks before importing the tested hook.
 */
jest.mock('@myorganiser/web-vault-ui', () => ({
  useOptionalVaultSession: jest.fn(),
  useLocalVaultRevision: jest.fn(),
}));

import { renderHook } from '@testing-library/react';
import {
  useOptionalVaultSession,
  useLocalVaultRevision,
} from '@myorganiser/web-vault-ui';
import { useVaultDisabledState } from './useVaultDisabledState';
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

describe('useVaultDisabledState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useLocalVaultRevision as jest.Mock).mockReturnValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('returns "signed-out" when vaultSession is null', () => {
    (useOptionalVaultSession as jest.Mock).mockReturnValue(null);

    const { result } = renderHook(() => useVaultDisabledState());

    expect(result.current).toBe('signed-out');
  });

  test('returns "no-local-vault" when handle is present but loadVault() returns null', () => {
    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: createMockHandle({
        loadVault: jest.fn().mockReturnValue(null),
      }),
      masterKeyBytes: new Uint8Array(32),
    });

    const { result } = renderHook(() => useVaultDisabledState());

    expect(result.current).toBe('no-local-vault');
  });

  test('returns "locked" when vault exists but masterKeyBytes is null', () => {
    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: createMockHandle({
        loadVault: jest.fn().mockReturnValue({}),
      }),
      masterKeyBytes: null,
    });

    const { result } = renderHook(() => useVaultDisabledState());

    expect(result.current).toBe('locked');
  });

  test('returns "enabled" when vault exists and masterKeyBytes is present', () => {
    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: createMockHandle({
        loadVault: jest.fn().mockReturnValue({}),
      }),
      masterKeyBytes: new Uint8Array(32),
    });

    const { result } = renderHook(() => useVaultDisabledState());

    expect(result.current).toBe('enabled');
  });

  test('recomputes state when revision changes (reconcile restores vault)', () => {
    // Start: no vault, revision is 1
    const mockHandle = createMockHandle({
      loadVault: jest.fn().mockReturnValue(null),
    });
    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
      masterKeyBytes: new Uint8Array(32),
    });
    (useLocalVaultRevision as jest.Mock).mockReturnValue(1);

    const { result, rerender } = renderHook(() => useVaultDisabledState());
    expect(result.current).toBe('no-local-vault');

    // Simulate reconcile: vault restored and revision incremented
    (mockHandle.loadVault as jest.Mock).mockReturnValue({});
    (useLocalVaultRevision as jest.Mock).mockReturnValue(2);

    rerender();

    // State should update to 'enabled' because vault now exists
    expect(result.current).toBe('enabled');
  });
});
