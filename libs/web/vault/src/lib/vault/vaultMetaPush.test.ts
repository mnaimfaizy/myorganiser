/**
 * Tests for Vault Meta Push — conditional writes guarded by device-proven server state.
 *
 * Tests use REAL vault initialization, hashing, and convergence with REAL crypto.subtle,
 * and REAL serverVaultSync logic (getServerVaultMeta and putServerVaultMetaEtagAware).
 * The VaultApi layer (getVaultMeta and putVaultMeta) is faked to control server responses
 * and verify the correct conflict-handling semantics.
 */

import type { AxiosResponse } from 'axios';
import type { VaultApi, VaultMetaV1 } from '@myorganiser/app-api-client';
import type { VaultStorageV1 } from './localVaultStorage';
import { createVaultHandle, VaultSecretMismatchError } from './vaultHandle';
import {
  probeVaultMetaReachability,
  pushLocalVaultMeta,
  resetPassphraseAfterRecovery,
  changePassphraseWithCurrent,
  settleVaultMeta,
} from './vaultMetaPush';
import { vaultIdentityOf, type VaultMetaDecision } from './vaultMetaConverge';
import { expectStillPending } from './promisePending.testutil';
import { hashVaultMeta } from './syncBookmarkAccess';
import { localToServerMeta } from './vaultShapes';

type VaultMetaApi = Pick<VaultApi, 'getVaultMeta' | 'putVaultMeta'>;

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
});

/**
 * A `VaultApi` double carrying the two methods this module reaches for.
 *
 * Typed as `jest.Mocked` rather than as the plain interface so the mock
 * controls are visible to the typechecker: a double typed as the interface
 * compiles at the call site and then fails on every `mockResolvedValue`.
 */
function createApiDouble(): jest.Mocked<VaultMetaApi> {
  return {
    getVaultMeta: jest.fn(),
    putVaultMeta: jest.fn(),
  } as unknown as jest.Mocked<VaultMetaApi>;
}

/**
 * Helper to create a local vault with the given overrides.
 */
function makeLocalVault(
  overrides: Partial<VaultStorageV1> = {},
): VaultStorageV1 {
  return {
    version: 1,
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: 310_000,
      salt: 'salt-local',
    },
    masterKeyWrappedWithPassphrase: {
      iv: 'iv1-local',
      ciphertext: 'ct1-local',
    },
    masterKeyWrappedWithRecoveryKey: {
      iv: 'iv2-local',
      ciphertext: 'ct2-local',
    },
    data: {
      addresses: { iv: 'aiv', ciphertext: 'act' },
    },
    ...overrides,
  };
}

/**
 * Helper to create server Vault Meta with the given overrides.
 */
function makeServerMeta(overrides: Partial<VaultMetaV1> = {}): VaultMetaV1 {
  return {
    version: 1,
    kdf_name: 'PBKDF2',
    kdf_salt: 'salt-local',
    kdf_params: { hash: 'SHA-256', iterations: 310_000 },
    wrapped_mk_passphrase: {
      version: 1,
      iv: 'iv1-local',
      ciphertext: 'ct1-local',
    },
    wrapped_mk_recovery: {
      version: 1,
      iv: 'iv2-local',
      ciphertext: 'ct2-local',
    },
    ...overrides,
  };
}

/**
 * Helper to set up a vault handle with initialization and unlock.
 */
async function setupHandle(owner: string, passphrase: string) {
  const handle = createVaultHandle({ owner });
  await handle.initialize({ passphrase });
  await handle.unlockWithPassphrase({ passphrase });
  return handle;
}

describe('pushLocalVaultMeta', () => {
  // ===== Case 1: Server holds no Vault Meta (getVaultMeta 404) =====

  test('1: PUTs with no ifMatch when server holds no Vault Meta and returns {kind: "pushed"}', async () => {
    const api = createApiDouble();
    // getVaultMeta rejects with 404, so getServerVaultMeta returns null
    const notFoundError = new Error('Not Found') as Error & {
      response?: { status: number };
    };
    notFoundError.response = { status: 404 };
    api.getVaultMeta.mockRejectedValue(notFoundError);

    // putVaultMeta resolves with new etag
    api.putVaultMeta.mockResolvedValue({
      data: { etag: 'etag-new', updatedAt: 't1' },
    } as AxiosResponse);

    const meta = makeServerMeta();
    const result = await pushLocalVaultMeta({
      api,
      meta,
      baseHash: undefined,
    });

    expect(result).toEqual({ kind: 'pushed' });
    expect(api.putVaultMeta).toHaveBeenCalledTimes(1);
    expect(api.putVaultMeta).toHaveBeenCalledWith({
      putVaultMetaRequest: { meta },
      ifMatch: undefined,
    });
  });

  // ===== Case 2: Server meta equals local meta =====

  test('2: returns {kind: "noop-already-in-sync"} when server meta equals local meta and does NOT call putVaultMeta', async () => {
    const api = createApiDouble();
    const meta = makeServerMeta();
    api.getVaultMeta.mockResolvedValue({
      data: { etag: 'etag-server', updatedAt: 't1', meta },
    } as AxiosResponse);

    const result = await pushLocalVaultMeta({
      api,
      meta,
      baseHash: 'any-hash',
    });

    expect(result).toEqual({ kind: 'noop-already-in-sync' });
    expect(api.putVaultMeta).not.toHaveBeenCalled();
  });

  // ===== Case 3: Server meta differs, difference is not pushable (different-vault) =====

  test('3: returns {kind: "refused-not-pushable", change: "different-vault"} when kdf_salt differs and does NOT call putVaultMeta even when baseHash matches', async () => {
    const api = createApiDouble();
    const localMeta = makeServerMeta();
    const serverMeta = makeServerMeta({ kdf_salt: 'different-salt' });
    const serverHash = await hashVaultMeta(serverMeta);

    api.getVaultMeta.mockResolvedValue({
      data: { etag: 'etag-server', updatedAt: 't1', meta: serverMeta },
    } as AxiosResponse);

    const result = await pushLocalVaultMeta({
      api,
      meta: localMeta,
      baseHash: serverHash,
    });

    expect(result).toEqual({
      kind: 'refused-not-pushable',
      change: 'different-vault',
    });
    expect(api.putVaultMeta).not.toHaveBeenCalled();
  });

  // ===== Case 4: Server meta differs, baseHash undefined =====

  test('4: returns {kind: "refused-no-base"} when server meta differs and baseHash is undefined', async () => {
    const api = createApiDouble();
    const localMeta = makeServerMeta();
    const serverMeta = makeServerMeta({
      wrapped_mk_passphrase: {
        version: 1,
        iv: 'different-iv',
        ciphertext: 'different-ct',
      },
    });

    api.getVaultMeta.mockResolvedValue({
      data: { etag: 'etag-server', updatedAt: 't1', meta: serverMeta },
    } as AxiosResponse);

    const result = await pushLocalVaultMeta({
      api,
      meta: localMeta,
      baseHash: undefined,
    });

    expect(result).toEqual({ kind: 'refused-no-base' });
    expect(api.putVaultMeta).not.toHaveBeenCalled();
  });

  // ===== Case 5: Server meta differs, baseHash does not match server's hash =====

  test('5: returns {kind: "refused-server-moved", change: "passphrase"} when baseHash does not match server hash', async () => {
    const api = createApiDouble();
    const localMeta = makeServerMeta();
    const serverMeta = makeServerMeta({
      wrapped_mk_passphrase: {
        version: 1,
        iv: 'different-iv',
        ciphertext: 'different-ct',
      },
    });

    api.getVaultMeta.mockResolvedValue({
      data: { etag: 'etag-server', updatedAt: 't1', meta: serverMeta },
    } as AxiosResponse);

    const result = await pushLocalVaultMeta({
      api,
      meta: localMeta,
      baseHash: 'wrong-hash',
    });

    expect(result).toEqual({
      kind: 'refused-server-moved',
      change: 'passphrase',
    });
    expect(api.putVaultMeta).not.toHaveBeenCalled();
  });

  // ===== Case 6: Server meta differs, baseHash matches, PUT succeeds =====

  test('6: PUTs with ifMatch equal to server ETag when baseHash matches and returns {kind: "pushed"}', async () => {
    const api = createApiDouble();
    const localMeta = makeServerMeta();
    const serverMeta = makeServerMeta({
      wrapped_mk_passphrase: {
        version: 1,
        iv: 'different-iv',
        ciphertext: 'different-ct',
      },
    });
    const serverHash = await hashVaultMeta(serverMeta);

    api.getVaultMeta.mockResolvedValue({
      data: { etag: 'etag-server-proof', updatedAt: 't1', meta: serverMeta },
    } as AxiosResponse);

    api.putVaultMeta.mockResolvedValue({
      data: { etag: 'etag-new', updatedAt: 't2' },
    } as AxiosResponse);

    const result = await pushLocalVaultMeta({
      api,
      meta: localMeta,
      baseHash: serverHash,
    });

    expect(result).toEqual({ kind: 'pushed' });
    expect(api.putVaultMeta).toHaveBeenCalledTimes(1);
    expect(api.putVaultMeta).toHaveBeenCalledWith({
      putVaultMetaRequest: { meta: localMeta },
      ifMatch: 'etag-server-proof',
    });
  });

  // ===== Case 7: PUT rejects with 409, onConflict returns 'keep-remote' =====

  test('7: returns {kind: "refused-server-moved"} when PUT returns 409 and onConflict keeps remote, and putVaultMeta is NOT called a second time', async () => {
    const api = createApiDouble();
    const localMeta = makeServerMeta();
    const serverMeta = makeServerMeta({
      wrapped_mk_passphrase: {
        version: 1,
        iv: 'different-iv',
        ciphertext: 'different-ct',
      },
    });
    const serverHash = await hashVaultMeta(serverMeta);

    // Order-independent rather than a queue of `*Once()` calls: the real
    // conflict path reads the server twice (once before the PUT, once inside
    // the 409 branch) and both reads see the same server meta, so there is
    // nothing for an ordered queue to express.
    api.getVaultMeta.mockImplementation(() =>
      Promise.resolve({
        data: { etag: 'etag-server-proof', updatedAt: 't1', meta: serverMeta },
      } as AxiosResponse),
    );

    // Every PUT conflicts. If the conflict were force-retried, this would
    // reject a second time and the call count below would be 2.
    const conflictError = new Error('Conflict') as Error & {
      response?: { status: number };
    };
    conflictError.response = { status: 409 };
    api.putVaultMeta.mockRejectedValue(conflictError);

    const result = await pushLocalVaultMeta({
      api,
      meta: localMeta,
      baseHash: serverHash,
    });

    expect(result).toEqual({
      kind: 'refused-server-moved',
      change: 'passphrase',
    });
    // putVaultMeta should be called exactly once (the conflict is not retried)
    expect(api.putVaultMeta).toHaveBeenCalledTimes(1);
  });

  // ===== Case 8: getVaultMeta rejects with 401 =====

  test('8: returns {kind: "skipped-not-authenticated"} on 401 error without throwing', async () => {
    const api = createApiDouble();
    const error = new Error('Unauthorized') as Error & {
      response?: { status: number };
    };
    error.response = { status: 401 };
    api.getVaultMeta.mockRejectedValue(error);

    const result = await pushLocalVaultMeta({
      api,
      meta: makeServerMeta(),
      baseHash: 'any-hash',
    });

    expect(result).toEqual({ kind: 'skipped-not-authenticated' });
    expect(api.putVaultMeta).not.toHaveBeenCalled();
  });

  // ===== Case 9: getVaultMeta rejects with 403 =====

  test('8b: returns {kind: "skipped-not-authenticated"} on 403 error without throwing', async () => {
    const api = createApiDouble();
    const error = new Error('Forbidden') as Error & {
      response?: { status: number };
    };
    error.response = { status: 403 };
    api.getVaultMeta.mockRejectedValue(error);

    const result = await pushLocalVaultMeta({
      api,
      meta: makeServerMeta(),
      baseHash: 'any-hash',
    });

    expect(result).toEqual({ kind: 'skipped-not-authenticated' });
    expect(api.putVaultMeta).not.toHaveBeenCalled();
  });

  // ===== Case 9: getVaultMeta rejects with 500 =====

  test('9: rethrows on 500 error', async () => {
    const api = createApiDouble();
    const error = new Error('Server error') as Error & {
      response?: { status: number };
    };
    error.response = { status: 500 };
    api.getVaultMeta.mockRejectedValue(error);

    await expect(
      pushLocalVaultMeta({
        api,
        meta: makeServerMeta(),
        baseHash: 'any-hash',
      }),
    ).rejects.toThrow('Server error');
  });
});

describe('changePassphraseWithCurrent', () => {
  const owner = 'test-owner';
  const passphrase = 'old-pass';
  const currentPassphrase = 'old-pass';
  const newPassphrase = 'new-pass';

  // ===== Case A: Happy path =====

  test('A: happy path mirrors resetPassphraseAfterRecovery: changes local wrapping, records base before push, pushes new meta, and records new agreement on success', async () => {
    const handle = await setupHandle(owner, passphrase);
    const api = createApiDouble();

    // Capture base meta before change
    const before = handle.loadVault();
    expect(before).not.toBeNull();
    const saltBefore = before!.kdf.salt;

    // getVaultMeta rejects with 404, so getServerVaultMeta returns null
    const notFoundError = new Error('Not Found') as Error & {
      response?: { status: number };
    };
    notFoundError.response = { status: 404 };
    api.getVaultMeta.mockRejectedValue(notFoundError);

    api.putVaultMeta.mockResolvedValue({
      data: { etag: 'etag-new', updatedAt: 't1' },
    } as AxiosResponse);

    const result = await changePassphraseWithCurrent({
      api,
      handle,
      currentPassphrase,
      newPassphrase,
    });

    expect(result).toEqual({
      changedLocally: true,
      push: { kind: 'pushed' },
    });

    // Verify new passphrase works
    const newHandle = createVaultHandle({ owner });
    await newHandle.unlockWithPassphrase({ passphrase: newPassphrase });
    expect(newHandle.loadVault()).not.toBeNull();

    // Verify bookmark is set to new meta
    const newMeta = handle.loadVault();
    const newMetaHash = await hashVaultMeta(localToServerMeta(newMeta!));
    expect(handle.lastAgreedVaultMetaHash()).toBe(newMetaHash);

    // Verify kdf.salt is byte-identical before and after
    expect(newMeta!.kdf.salt).toBe(saltBefore);
  });

  // ===== Case B: Wrong current passphrase =====

  test('B: wrong current passphrase throws VaultSecretMismatchError, does NOT call putVaultMeta, and Vault Meta Bookmark is unchanged', async () => {
    const handle = await setupHandle(owner, passphrase);
    const api = createApiDouble();

    // Record bookmark before the failed call
    const baseLocalMeta = localToServerMeta(handle.loadVault()!);
    await handle.recordVaultMetaAgreement({ meta: baseLocalMeta });
    const baseBookmarkHash = handle.lastAgreedVaultMetaHash();

    // Capture Local Vault state before the failed call to verify byte-identical
    const vaultBefore = handle.loadVault()!;
    const stateBefore = {
      masterKeyWrappedWithPassphrase:
        vaultBefore.masterKeyWrappedWithPassphrase,
      masterKeyWrappedWithRecoveryKey:
        vaultBefore.masterKeyWrappedWithRecoveryKey,
      kdf: vaultBefore.kdf,
      data: vaultBefore.data,
    };
    // Deep-copied so the comparison below cannot be a live object compared
    // against itself. JSON round-trip rather than structuredClone: jsdom does
    // not expose the latter, and every field here is already a string or a
    // number — an EncryptedBlob is base64 text, not bytes — so nothing is lost.
    const stateBeforeSnapshot = JSON.parse(
      JSON.stringify(stateBefore),
    ) as typeof stateBefore;

    // Attempt with wrong passphrase
    await expect(
      changePassphraseWithCurrent({
        api,
        handle,
        currentPassphrase: 'wrong-pass',
        newPassphrase,
      }),
    ).rejects.toThrow(VaultSecretMismatchError);

    // Verify putVaultMeta was never called
    expect(api.putVaultMeta).not.toHaveBeenCalled();

    // Verify bookmark is still the base hash
    expect(handle.lastAgreedVaultMetaHash()).toBe(baseBookmarkHash);

    // Verify Local Vault is byte-identical (no rewrap happened)
    const vaultAfter = handle.loadVault()!;
    const stateAfter = {
      masterKeyWrappedWithPassphrase: vaultAfter.masterKeyWrappedWithPassphrase,
      masterKeyWrappedWithRecoveryKey:
        vaultAfter.masterKeyWrappedWithRecoveryKey,
      kdf: vaultAfter.kdf,
      data: vaultAfter.data,
    };
    expect(stateAfter).toEqual(stateBeforeSnapshot);
  });

  // ===== Case C: Push fails but local change persists =====

  test('C: push transport error returns {changedLocally: true, push: {kind: "unreachable"}}, local vault has new wrapping, and new passphrase works', async () => {
    const handle = await setupHandle(owner, passphrase);
    const api = createApiDouble();

    const transportError = new Error('Network error') as Error & {
      response?: { status: number };
    };
    transportError.response = { status: 500 };
    api.getVaultMeta.mockRejectedValue(transportError);

    const result = await changePassphraseWithCurrent({
      api,
      handle,
      currentPassphrase,
      newPassphrase,
    });

    expect(result).toEqual({
      changedLocally: true,
      push: { kind: 'unreachable' },
    });

    // Verify new passphrase works locally
    const newHandle = createVaultHandle({ owner });
    await newHandle.unlockWithPassphrase({ passphrase: newPassphrase });
    expect(newHandle.loadVault()).not.toBeNull();
  });
});

describe('resetPassphraseAfterRecovery', () => {
  const owner = 'test-owner';
  const passphrase = 'old-pass';
  const newPassphrase = 'new-pass';

  // ===== Case 10: Happy path =====

  test('10: happy path changes local wrapping, records base before push, pushes new meta, and records new agreement on success', async () => {
    const handle = await setupHandle(owner, passphrase);
    const api = createApiDouble();

    // Capture base meta before change
    const before = handle.loadVault();
    expect(before).not.toBeNull();
    const saltBefore = before!.kdf.salt;

    // getVaultMeta rejects with 404, so getServerVaultMeta returns null
    const notFoundError = new Error('Not Found') as Error & {
      response?: { status: number };
    };
    notFoundError.response = { status: 404 };
    api.getVaultMeta.mockRejectedValue(notFoundError);

    api.putVaultMeta.mockResolvedValue({
      data: { etag: 'etag-new', updatedAt: 't1' },
    } as AxiosResponse);

    const result = await resetPassphraseAfterRecovery({
      api,
      handle,
      newPassphrase,
    });

    expect(result).toEqual({
      changedLocally: true,
      push: { kind: 'pushed' },
    });

    // Verify new passphrase works
    const newHandle = createVaultHandle({ owner });
    await newHandle.unlockWithPassphrase({ passphrase: newPassphrase });
    expect(newHandle.loadVault()).not.toBeNull();

    // Verify bookmark is set to new meta
    const newMeta = handle.loadVault();
    const newMetaHash = await hashVaultMeta(localToServerMeta(newMeta!));
    expect(handle.lastAgreedVaultMetaHash()).toBe(newMetaHash);

    // Verify kdf.salt is byte-identical before and after (passphrase change does not mint a fresh salt)
    expect(newMeta!.kdf.salt).toBe(saltBefore);
  });

  // ===== Case 11: Push throws transport error =====

  test('11: push transport error returns {changedLocally: true, push: {kind: "unreachable"}}, local vault has new wrapping, and bookmark holds base hash', async () => {
    const handle = await setupHandle(owner, passphrase);
    const api = createApiDouble();

    const before = handle.loadVault();
    const baseHash = await hashVaultMeta(localToServerMeta(before!));

    const transportError = new Error('Network error') as Error & {
      response?: { status: number };
    };
    transportError.response = { status: 500 };
    api.getVaultMeta.mockRejectedValue(transportError);

    const result = await resetPassphraseAfterRecovery({
      api,
      handle,
      newPassphrase,
    });

    expect(result).toEqual({
      changedLocally: true,
      push: { kind: 'unreachable' },
    });

    // Verify new passphrase works (local change persisted)
    const newHandle = createVaultHandle({ owner });
    await newHandle.unlockWithPassphrase({ passphrase: newPassphrase });
    expect(newHandle.loadVault()).not.toBeNull();

    // Verify bookmark holds the BASE hash, not the new one
    expect(handle.lastAgreedVaultMetaHash()).toBe(baseHash);
  });

  // ===== Case 12: Push refused because server moved =====

  test('12: push refused-server-moved returns that result, and bookmark holds base hash', async () => {
    const handle = await setupHandle(owner, passphrase);
    const api = createApiDouble();

    const before = handle.loadVault();
    const baseHash = await hashVaultMeta(localToServerMeta(before!));

    // Mock: Create a server meta that differs from the base only in the passphrase wrapping.
    // changePassphrase will rewrap the local passphrase (creating new wrapped_mk_passphrase).
    // The server has a DIFFERENT passphrase wrapping (same vault, different wrapping),
    // so pushLocalVaultMeta will find the hash doesn't match base and refuse.
    // We need to use the exact same base but with different wrapped_mk_passphrase.
    const baseMeta = localToServerMeta(before!);
    const serverMeta = {
      ...baseMeta,
      wrapped_mk_passphrase: {
        version: 1 as const,
        iv: 'server-iv-different',
        ciphertext: 'server-ct-different',
      },
    };

    api.getVaultMeta.mockResolvedValue({
      data: { etag: 'etag-server', updatedAt: 't1', meta: serverMeta },
    } as AxiosResponse);

    const result = await resetPassphraseAfterRecovery({
      api,
      handle,
      newPassphrase,
    });

    expect(result.changedLocally).toBe(true);
    expect(result.push).toEqual({
      kind: 'refused-server-moved',
      change: 'passphrase',
    });

    // Verify bookmark still holds base hash (not new hash)
    expect(handle.lastAgreedVaultMetaHash()).toBe(baseHash);
  });

  // ===== Case 13: Locked handle =====

  test('13: locked handle rejects VaultLockedError without calling putVaultMeta', async () => {
    const handle = createVaultHandle({ owner });
    // Never initialize or unlock, so handle is locked
    const api = createApiDouble();

    await expect(
      resetPassphraseAfterRecovery({
        api,
        handle,
        newPassphrase,
      }),
    ).rejects.toThrow();

    expect(api.putVaultMeta).not.toHaveBeenCalled();
  });
});

describe('probeVaultMetaReachability', () => {
  // ===== Probe Case 1: getVaultMeta resolves with meta =====

  test('probes once on mount and returns "reachable" when server holds Vault Meta', async () => {
    const api = createApiDouble();
    const meta = makeServerMeta();
    api.getVaultMeta.mockResolvedValue({
      data: { etag: 'etag-server', updatedAt: 't1', meta },
    } as AxiosResponse);

    const result = await probeVaultMetaReachability({ api });

    expect(result).toBe('reachable');
    expect(api.getVaultMeta).toHaveBeenCalledTimes(1);
    expect(api.putVaultMeta).not.toHaveBeenCalled();
  });

  // ===== Probe Case 2: getVaultMeta returns 404 (null) =====

  test('returns "reachable" when server holds no Vault Meta (404)', async () => {
    const api = createApiDouble();
    const notFoundError = new Error('Not Found') as Error & {
      response?: { status: number };
    };
    notFoundError.response = { status: 404 };
    api.getVaultMeta.mockRejectedValue(notFoundError);

    const result = await probeVaultMetaReachability({ api });

    expect(result).toBe('reachable');
    // Reaching the server is what matters; empty server is still reached
    expect(api.putVaultMeta).not.toHaveBeenCalled();
  });

  // ===== Probe Case 3: getVaultMeta rejects with 401 =====

  test('returns "signed-out" when getVaultMeta rejects with 401', async () => {
    const api = createApiDouble();
    const error = new Error('Unauthorized') as Error & {
      response?: { status: number };
    };
    error.response = { status: 401 };
    api.getVaultMeta.mockRejectedValue(error);

    const result = await probeVaultMetaReachability({ api });

    expect(result).toBe('signed-out');
    expect(api.putVaultMeta).not.toHaveBeenCalled();
  });

  // ===== Probe Case 4: getVaultMeta rejects with 403 =====

  test('returns "signed-out" when getVaultMeta rejects with 403', async () => {
    const api = createApiDouble();
    const error = new Error('Forbidden') as Error & {
      response?: { status: number };
    };
    error.response = { status: 403 };
    api.getVaultMeta.mockRejectedValue(error);

    const result = await probeVaultMetaReachability({ api });

    expect(result).toBe('signed-out');
    expect(api.putVaultMeta).not.toHaveBeenCalled();
  });

  // ===== Probe Case 5: getVaultMeta rejects with network error (no status) =====

  test('returns "unreachable" when getVaultMeta rejects with network error (no status)', async () => {
    const api = createApiDouble();
    const networkError = new Error('Network error');
    api.getVaultMeta.mockRejectedValue(networkError);

    const result = await probeVaultMetaReachability({ api });

    expect(result).toBe('unreachable');
    expect(api.putVaultMeta).not.toHaveBeenCalled();
  });

  // ===== Probe Case 6: getVaultMeta rejects with 500 returns unreachable =====

  test('returns "unreachable" when getVaultMeta rejects with 500 (server fault)', async () => {
    const api = createApiDouble();
    const serverError = new Error('Server error') as Error & {
      response?: { status: number };
    };
    serverError.response = { status: 500 };
    api.getVaultMeta.mockRejectedValue(serverError);

    const result = await probeVaultMetaReachability({ api });

    // This is the guard against silently turning a server fault into a sign-in
    // prompt: a 500 is unreachable, not a session-gone condition. If someone
    // later widens isSessionGone to catch other error types, this test will
    // catch them re-categorizing server faults as sign-outs.
    expect(result).toBe('unreachable');
    expect(api.putVaultMeta).not.toHaveBeenCalled();
  });

  // ===== Probe Case 7: Proves read-only via API narrowing =====

  test('never calls putVaultMeta (API narrowed to getVaultMeta only)', async () => {
    const api = createApiDouble();
    api.getVaultMeta.mockResolvedValue({
      data: { etag: 'etag-server', updatedAt: 't1', meta: makeServerMeta() },
    } as AxiosResponse);

    await probeVaultMetaReachability({ api });

    expect(api.putVaultMeta).not.toHaveBeenCalled();
  });
});

describe('settleVaultMeta', () => {
  const owner = 'test-owner';
  const passphrase = 'vault-pass';

  // ===== Case 14: No local vault =====

  test('14: returns {kind: "skipped-no-local-vault"} when handle has no vault, and does NOT call api', async () => {
    const handle = createVaultHandle({ owner });
    const api = createApiDouble();

    const result = await settleVaultMeta({
      api,
      handle,
      prompt: jest.fn(),
    });

    expect(result).toEqual({ kind: 'skipped-no-local-vault' });
    expect(api.getVaultMeta).not.toHaveBeenCalled();
  });

  // ===== Case 14a: No local vault, recordObservedVaultIdentity not called =====

  test('14a: does NOT call recordObservedVaultIdentity when handle has no vault (skipped-no-local-vault)', async () => {
    const handle = createVaultHandle({ owner });
    const api = createApiDouble();
    const recordObservedSpy = jest.spyOn(handle, 'recordObservedVaultIdentity');

    await settleVaultMeta({
      api,
      handle,
      prompt: jest.fn(),
    });

    expect(recordObservedSpy).not.toHaveBeenCalled();
  });

  // ===== Case 15: Bookmark absent (device never agreed) =====

  test('15: bookmark absent falls through to converge, returns {kind: "converged", ...}, and does NOT call putVaultMeta', async () => {
    const handle = await setupHandle(owner, passphrase);
    const api = createApiDouble();
    const prompt = jest.fn().mockResolvedValue('defer');

    // getVaultMeta rejects with 404, so getServerVaultMeta returns null
    const notFoundError = new Error('Not Found') as Error & {
      response?: { status: number };
    };
    notFoundError.response = { status: 404 };
    api.getVaultMeta.mockRejectedValue(notFoundError);

    const result = await settleVaultMeta({
      api,
      handle,
      prompt,
    });

    expect(result.kind).toBe('converged');
    expect(result).toHaveProperty('result');
    expect(api.putVaultMeta).not.toHaveBeenCalled();
  });

  // ===== Case 16: Bookmark present, server still on base, local differs (retry case) =====

  test('16: bookmark present, server on base, local differs pushes new wrapping, does NOT call prompt, and bookmark holds new meta hash', async () => {
    const handle = await setupHandle(owner, passphrase);
    const api = createApiDouble();
    const prompt = jest.fn();

    // Record base meta
    const baseLocalMeta = localToServerMeta(handle.loadVault()!);
    await handle.recordVaultMetaAgreement({ meta: baseLocalMeta });

    // Change passphrase locally
    await handle.resetPassphrase({ newPassphrase: 'new-pass' });

    // Server still holds the base
    const serverMeta = baseLocalMeta;
    api.getVaultMeta.mockResolvedValue({
      data: { etag: 'etag-server', updatedAt: 't1', meta: serverMeta },
    } as AxiosResponse);

    api.putVaultMeta.mockResolvedValue({
      data: { etag: 'etag-new', updatedAt: 't2' },
    } as AxiosResponse);

    const result = await settleVaultMeta({
      api,
      handle,
      prompt,
    });

    expect(result).toEqual({ kind: 'pushed-local-wrapping' });
    expect(prompt).not.toHaveBeenCalled();

    // Verify bookmark holds new meta hash
    const newMeta = localToServerMeta(handle.loadVault()!);
    const newMetaHash = await hashVaultMeta(newMeta);
    expect(handle.lastAgreedVaultMetaHash()).toBe(newMetaHash);
  });

  // ===== Case 17: Bookmark present, local identity equals server identity =====

  test('17: bookmark present, local already in sync with server returns {kind: "noop-already-in-sync"}, does NOT call prompt, and does NOT call putVaultMeta', async () => {
    const handle = await setupHandle(owner, passphrase);
    const api = createApiDouble();
    const prompt = jest.fn();

    const localMeta = localToServerMeta(handle.loadVault()!);
    await handle.recordVaultMetaAgreement({ meta: localMeta });

    // Server holds same meta
    api.getVaultMeta.mockResolvedValue({
      data: { etag: 'etag-server', updatedAt: 't1', meta: localMeta },
    } as AxiosResponse);

    const result = await settleVaultMeta({
      api,
      handle,
      prompt,
    });

    expect(result).toEqual({ kind: 'noop-already-in-sync' });
    expect(prompt).not.toHaveBeenCalled();
    expect(api.putVaultMeta).not.toHaveBeenCalled();
  });

  // ===== Case 18: Bookmark present, server moved off base, differs from local =====

  test('18: bookmark present, server moved AND differs from local falls through to converge, calls prompt, and does NOT call putVaultMeta', async () => {
    const handle = await setupHandle(owner, passphrase);
    const api = createApiDouble();
    const prompt = jest.fn().mockResolvedValue('defer');

    const baseLocalMeta = localToServerMeta(handle.loadVault()!);
    await handle.recordVaultMetaAgreement({ meta: baseLocalMeta });

    // Change passphrase locally
    await handle.resetPassphrase({ newPassphrase: 'new-pass' });

    // Server holds a completely different meta (different salt = different vault)
    const differentServerMeta = makeServerMeta({ kdf_salt: 'different-salt' });
    api.getVaultMeta.mockResolvedValue({
      data: { etag: 'etag-server', updatedAt: 't1', meta: differentServerMeta },
    } as AxiosResponse);

    const result = await settleVaultMeta({
      api,
      handle,
      prompt,
    });

    expect(result.kind).toBe('converged');
    expect(prompt).toHaveBeenCalled();
    expect(api.putVaultMeta).not.toHaveBeenCalled();
  });

  // ===== Case 19: Push path records this device's identity =====

  test("19: pushed path calls recordObservedVaultIdentity with this device's identity (vaultIdentityOf(meta))", async () => {
    const handle = await setupHandle(owner, passphrase);
    const api = createApiDouble();
    const recordObservedSpy = jest.spyOn(handle, 'recordObservedVaultIdentity');

    // Record base meta
    const baseLocalMeta = localToServerMeta(handle.loadVault()!);
    await handle.recordVaultMetaAgreement({ meta: baseLocalMeta });

    // Change passphrase locally
    await handle.resetPassphrase({ newPassphrase: 'new-pass' });

    // Server still holds the base
    const serverMeta = baseLocalMeta;
    api.getVaultMeta.mockResolvedValue({
      data: { etag: 'etag-server', updatedAt: 't1', meta: serverMeta },
    } as AxiosResponse);

    api.putVaultMeta.mockResolvedValue({
      data: { etag: 'etag-new', updatedAt: 't2' },
    } as AxiosResponse);

    const result = await settleVaultMeta({
      api,
      handle,
      prompt: jest.fn(),
    });

    expect(result).toEqual({ kind: 'pushed-local-wrapping' });
    expect(recordObservedSpy).toHaveBeenCalledTimes(1);
    // The identity should be of THIS DEVICE'S new meta (after rewrap)
    const newMeta = localToServerMeta(handle.loadVault()!);
    const expectedIdentity = vaultIdentityOf(newMeta);
    expect(recordObservedSpy).toHaveBeenCalledWith({
      identity: expectedIdentity,
    });
  });

  // ===== Case 20: noop-already-in-sync push path records this device's identity =====

  test("20: noop-already-in-sync push path calls recordObservedVaultIdentity with this device's identity", async () => {
    const handle = await setupHandle(owner, passphrase);
    const api = createApiDouble();
    const recordObservedSpy = jest.spyOn(handle, 'recordObservedVaultIdentity');

    const localMeta = localToServerMeta(handle.loadVault()!);
    await handle.recordVaultMetaAgreement({ meta: localMeta });

    // Server holds same meta
    api.getVaultMeta.mockResolvedValue({
      data: { etag: 'etag-server', updatedAt: 't1', meta: localMeta },
    } as AxiosResponse);

    const result = await settleVaultMeta({
      api,
      handle,
      prompt: jest.fn(),
    });

    expect(result).toEqual({ kind: 'noop-already-in-sync' });
    expect(recordObservedSpy).toHaveBeenCalledTimes(1);
    // The identity should be of THIS DEVICE'S meta (unchanged, still in sync)
    const expectedIdentity = vaultIdentityOf(localMeta);
    expect(recordObservedSpy).toHaveBeenCalledWith({
      identity: expectedIdentity,
    });
  });

  // ===== Case 21: Converge records SERVER's identity on different-vault divergence (standoff case) =====

  test("21: converge with different-vault divergence records SERVER's identity (standoff case), not local", async () => {
    const handle = await setupHandle(owner, passphrase);
    const api = createApiDouble();
    const recordObservedSpy = jest.spyOn(handle, 'recordObservedVaultIdentity');

    const baseLocalMeta = localToServerMeta(handle.loadVault()!);
    await handle.recordVaultMetaAgreement({ meta: baseLocalMeta });

    // Change passphrase locally (changes local identity)
    await handle.resetPassphrase({ newPassphrase: 'new-pass' });
    const newLocalMeta = localToServerMeta(handle.loadVault()!);

    // Server holds a completely different vault (different salt)
    const differentServerMeta = makeServerMeta({ kdf_salt: 'different-salt' });
    api.getVaultMeta.mockResolvedValue({
      data: { etag: 'etag-server', updatedAt: 't1', meta: differentServerMeta },
    } as AxiosResponse);

    const prompt = jest.fn().mockResolvedValue('defer');
    const result = await settleVaultMeta({
      api,
      handle,
      prompt,
    });

    // Should have fallen through to converge
    expect(result.kind).toBe('converged');

    // recordObservedVaultIdentity should be called exactly once (from converge result)
    expect(recordObservedSpy).toHaveBeenCalledTimes(1);
    // The identity should be of SERVER's meta, not local's
    const serverIdentity = vaultIdentityOf(differentServerMeta);
    const localIdentity = vaultIdentityOf(newLocalMeta);
    expect(serverIdentity).not.toBe(localIdentity);
    expect(recordObservedSpy).toHaveBeenCalledWith({
      identity: serverIdentity,
    });
  });

  // ===== Case 22: skipped-not-authenticated does NOT record observed identity =====

  test('22: skipped-not-authenticated from initial getServerVaultMeta does NOT call recordObservedVaultIdentity', async () => {
    const handle = await setupHandle(owner, passphrase);
    const api = createApiDouble();
    const recordObservedSpy = jest.spyOn(handle, 'recordObservedVaultIdentity');

    const baseLocalMeta = localToServerMeta(handle.loadVault()!);
    await handle.recordVaultMetaAgreement({ meta: baseLocalMeta });

    // getVaultMeta rejects with 401
    const authError = new Error('Unauthorized') as Error & {
      response?: { status: number };
    };
    authError.response = { status: 401 };
    api.getVaultMeta.mockRejectedValue(authError);

    const result = await settleVaultMeta({
      api,
      handle,
      prompt: jest.fn(),
    });

    expect(result).toEqual({ kind: 'skipped-not-authenticated' });
    expect(recordObservedSpy).not.toHaveBeenCalled();
  });

  // ===== Case 23: skipped-no-server-meta does NOT record observed identity =====

  test('23: skipped-no-server-meta from converge does NOT call recordObservedVaultIdentity', async () => {
    const handle = await setupHandle(owner, passphrase);
    const api = createApiDouble();
    const recordObservedSpy = jest.spyOn(handle, 'recordObservedVaultIdentity');

    // Do NOT set a bookmark (device never agreed)
    // Just ensure we have a local vault
    expect(handle.loadVault()).not.toBeNull();

    // getVaultMeta rejects with 404 (server has no Vault Meta)
    const notFoundError = new Error('Not Found') as Error & {
      response?: { status: number };
    };
    notFoundError.response = { status: 404 };
    api.getVaultMeta.mockRejectedValue(notFoundError);

    const result = await settleVaultMeta({
      api,
      handle,
      prompt: jest.fn(),
    });

    // Falls through to converge, which returns skipped-no-server-meta
    expect(result.kind).toBe('converged');
    if (result.kind === 'converged') {
      expect(result.result.kind).toBe('skipped-no-server-meta');
    }
    // Should not have called recordObservedVaultIdentity
    expect(recordObservedSpy).not.toHaveBeenCalled();
  });

  // ===== Case 24: Regression test for #691 — unresolved prompt records SERVER identity =====

  test('24: unresolved prompt (different-vault standoff) records SERVER identity through onObserved callback', async () => {
    const handle = await setupHandle(owner, passphrase);
    const api = createApiDouble();
    const recordObservedSpy = jest.spyOn(handle, 'recordObservedVaultIdentity');

    const baseLocalMeta = localToServerMeta(handle.loadVault()!);
    await handle.recordVaultMetaAgreement({ meta: baseLocalMeta });

    // Server holds a completely different vault (different salt = different-vault)
    const differentServerMeta = makeServerMeta({ kdf_salt: 'different-salt' });
    api.getVaultMeta.mockResolvedValue({
      data: { etag: 'etag-server', updatedAt: 't1', meta: differentServerMeta },
    } as AxiosResponse);

    // Return a promise that never resolves (simulating a dialog left open)
    const neverResolvingPromise = new Promise<VaultMetaDecision>(() => {
      // intentionally never resolve or reject
    });

    const prompt = jest.fn().mockReturnValue(neverResolvingPromise);

    // Start settleVaultMeta but don't await it (to avoid hanging)
    const settlePromise = settleVaultMeta({
      api,
      handle,
      prompt,
    });

    // Give it a tick to call onObserved (via convergeVaultMeta's callback)
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The identity should be recorded even though the prompt never resolved
    expect(recordObservedSpy).toHaveBeenCalledTimes(1);
    // The recorded identity should be the SERVER's identity, not this device's
    const serverIdentity = vaultIdentityOf(differentServerMeta);
    const localIdentity = vaultIdentityOf(baseLocalMeta);
    expect(serverIdentity).not.toBe(localIdentity);
    expect(recordObservedSpy).toHaveBeenCalledWith({
      identity: serverIdentity,
    });

    // The pass has not settled, so the recording above was not simply it
    // finishing early — and the deliberate hang stays inside this test.
    await expectStillPending(settlePromise);
  });

  // ===== Cases 25-27: adoption is written from a fresh read, after the prompt (ADR 0143) =====

  /**
   * A prompt the test answers when it chooses. The pass is held open at the
   * dialog until `answer` is called, which is how a User who has not yet
   * decided is modelled.
   */
  function holdPrompt() {
    const pending: { resolve?: (decision: VaultMetaDecision) => void } = {};
    const prompt = jest.fn(
      () =>
        new Promise<VaultMetaDecision>((resolve) => {
          pending.resolve = resolve;
        }),
    );
    return {
      prompt,
      answer: (decision: VaultMetaDecision) => pending.resolve?.(decision),
    };
  }

  /** Lets the converge pass reach the prompt, which is after a few microtasks. */
  async function flushAsyncWork() {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  /** Every key in localStorage and its raw value, for byte-level comparison. */
  function storageSnapshot(): Record<string, string | null> {
    return Object.fromEntries(
      Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]),
    );
  }

  /** The local meta with only its passphrase wrapping changed, same salt. */
  function withRemotePassphraseWrapping(meta: VaultMetaV1): VaultMetaV1 {
    return {
      ...meta,
      wrapped_mk_passphrase: {
        version: 1,
        iv: 'remote-iv',
        ciphertext: 'remote-ct',
      },
    };
  }

  function serverHolds(api: jest.Mocked<VaultMetaApi>, meta: VaultMetaV1) {
    api.getVaultMeta.mockResolvedValue({
      data: { etag: 'etag-server', updatedAt: 't1', meta },
    } as AxiosResponse);
  }

  test('25: adoption after the prompt keeps Ciphertext saved while the prompt was open and takes the server wrapping', async () => {
    const handle = await setupHandle(owner, passphrase);
    await handle.saveEncryptedData({
      type: 'addresses',
      value: { label: 'saved before prompt' },
    });
    const savedBeforePrompt = handle.loadVault()!.data.addresses;

    const api = createApiDouble();
    const remoteMeta = withRemotePassphraseWrapping(
      localToServerMeta(handle.loadVault()!),
    );
    serverHolds(api, remoteMeta);
    const { prompt, answer } = holdPrompt();

    const settled = settleVaultMeta({ api, handle, prompt });
    await flushAsyncWork();
    expect(prompt).toHaveBeenCalledTimes(1);

    await handle.saveEncryptedData({
      type: 'addresses',
      value: { label: 'saved during prompt' },
    });
    const savedDuringPrompt = handle.loadVault()!.data.addresses;
    expect(savedDuringPrompt).not.toEqual(savedBeforePrompt);

    answer('adopt-remote');

    await expect(settled).resolves.toEqual({
      kind: 'adopted-remote',
      change: 'passphrase',
    });
    const stored = handle.loadVault()!;
    expect(stored.masterKeyWrappedWithPassphrase).toEqual({
      iv: 'remote-iv',
      ciphertext: 'remote-ct',
    });
    expect(stored.data.addresses).toEqual(savedDuringPrompt);
    expect(
      await handle.loadDecryptedData({ type: 'addresses', defaultValue: null }),
    ).toEqual({ label: 'saved during prompt' });
  });

  test('26: adoption is superseded as wrapping-moved when the wrapping changed during the prompt, and writes nothing', async () => {
    const handle = await setupHandle(owner, passphrase);
    const api = createApiDouble();
    serverHolds(
      api,
      withRemotePassphraseWrapping(localToServerMeta(handle.loadVault()!)),
    );
    const { prompt, answer } = holdPrompt();

    const settled = settleVaultMeta({ api, handle, prompt });
    await flushAsyncWork();
    expect(prompt).toHaveBeenCalledTimes(1);

    // The passphrase is rewrapped while the dialog is open.
    await handle.resetPassphrase({ newPassphrase: 'other-pass' });
    const snapshotAtAnswer = storageSnapshot();

    answer('adopt-remote');

    await expect(settled).resolves.toEqual({
      kind: 'adoption-superseded',
      change: 'passphrase',
      reason: 'wrapping-moved',
    });
    expect(handle.loadVault()!.masterKeyWrappedWithPassphrase).not.toEqual({
      iv: 'remote-iv',
      ciphertext: 'remote-ct',
    });
    expect(storageSnapshot()).toEqual(snapshotAtAnswer);
  });

  test('27: adoption is superseded as no-local-vault when the Local Vault is removed during the prompt, and writes nothing', async () => {
    const handle = await setupHandle(owner, passphrase);
    const api = createApiDouble();
    serverHolds(
      api,
      withRemotePassphraseWrapping(localToServerMeta(handle.loadVault()!)),
    );
    const { prompt, answer } = holdPrompt();

    const settled = settleVaultMeta({ api, handle, prompt });
    await flushAsyncWork();
    expect(prompt).toHaveBeenCalledTimes(1);

    handle.removeVault();
    const snapshotAtAnswer = storageSnapshot();

    answer('adopt-remote');

    await expect(settled).resolves.toEqual({
      kind: 'adoption-superseded',
      change: 'passphrase',
      reason: 'no-local-vault',
    });
    expect(handle.hasVault()).toBe(false);
    expect(storageSnapshot()).toEqual(snapshotAtAnswer);
  });
});
