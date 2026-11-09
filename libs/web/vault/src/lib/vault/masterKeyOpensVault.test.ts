/**
 * Tests for `masterKeyOpensVault` and `checkMasterKeyAgainstServerVault`
 * (ADR 0136, decision 6).
 *
 * The server's Ciphertext is the authority, and the Local Vault is only asked
 * when the server cannot answer. Real WebCrypto throughout: every Vault Blob on
 * both sides is sealed with the real AES-GCM helper, so a decrypt succeeds or
 * fails for the reason the code claims. Only the `api` object is faked.
 */

import type {
  EncryptedBlobV1,
  VaultBlobType,
} from '@myorganiser/app-api-client';

import {
  aesGcmEncrypt,
  bytesToBase64,
  importAesGcmKey,
  randomBytes,
  utf8ToBytes,
} from './crypto';
import { writeOwnedLocalVault } from './localVaultStorage';
import { masterKeyOpensLocalVault } from './masterKeyOpensLocalVault';
import {
  checkMasterKeyAgainstServerVault,
  masterKeyOpensVault,
} from './masterKeyOpensVault';

const OWNER = 'owner-a';
const TASKS: VaultBlobType = 'tasks';
const UPDATED_AT = '2026-01-01T00:00:00.000Z';
const PLACEHOLDER_BLOB = { iv: 'iv', ciphertext: 'ct' };

beforeEach(() => {
  localStorage.clear();
});

/** Seal a small payload under `masterKeyBytes` with the real AES-GCM helper. */
async function sealUnder(
  masterKeyBytes: Uint8Array,
): Promise<{ iv: string; ciphertext: string }> {
  const iv = randomBytes(12);
  const ciphertext = await aesGcmEncrypt({
    key: await importAesGcmKey(masterKeyBytes),
    plaintext: utf8ToBytes('[]'),
    iv,
  });
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(ciphertext) };
}

async function serverBlobUnder(
  masterKeyBytes: Uint8Array,
): Promise<EncryptedBlobV1> {
  return { version: 1, ...(await sealUnder(masterKeyBytes)) };
}

/** Store this owner's Local Vault with one Vault Blob sealed under `masterKeyBytes`. */
async function storeLocalVaultUnder(masterKeyBytes: Uint8Array): Promise<void> {
  // The check reads only `data`, so the wrapping fields and KDF are shape-only.
  writeOwnedLocalVault({
    owner: OWNER,
    vault: {
      version: 1,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 1, salt: 'salt' },
      masterKeyWrappedWithPassphrase: PLACEHOLDER_BLOB,
      masterKeyWrappedWithRecoveryKey: PLACEHOLDER_BLOB,
      data: { tasks: await sealUnder(masterKeyBytes) },
    },
  });
}

function inventoryListing(types: VaultBlobType[]) {
  return {
    data: {
      etag: 'inventory-1',
      message: '',
      blobs: types.map((type) => ({
        type,
        etag: 'blob-1',
        updatedAt: UPDATED_AT,
      })),
    },
  };
}

function blobResponse(blob: EncryptedBlobV1) {
  return {
    data: {
      etag: 'blob-1',
      updatedAt: UPDATED_AT,
      type: TASKS,
      message: '',
      blob,
    },
  };
}

function httpError(status: number): Error & { response: { status: number } } {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status } });
}

// Two distinct 32-byte Master Keys: `K` is the one the User holds now, `K2`
// stands in for the key a Vault replaced elsewhere was wrapped by.
const K = randomBytes(32);
const K2 = randomBytes(32);

describe('masterKeyOpensVault', () => {
  test('1: opens when the server Ciphertext decrypts, without consulting the Local Vault', async () => {
    // The Local Vault is wrapped by K2, so it would answer false. A true
    // result therefore can only have come from the server.
    await storeLocalVaultUnder(K2);
    await expect(
      masterKeyOpensLocalVault({ owner: OWNER, masterKeyBytes: K }),
    ).resolves.toBe(false);

    const api = {
      getVaultBlobInventory: jest
        .fn()
        .mockResolvedValue(inventoryListing([TASKS])),
      getVaultBlob: jest
        .fn()
        .mockResolvedValue(blobResponse(await serverBlobUnder(K))),
    };

    await expect(
      checkMasterKeyAgainstServerVault({ api, masterKeyBytes: K }),
    ).resolves.toBe('opens');
    await expect(
      masterKeyOpensVault({ owner: OWNER, masterKeyBytes: K, api }),
    ).resolves.toBe(true);
  });

  test('2: false when the server Vault was replaced elsewhere, even though the Local Vault still opens', async () => {
    // Cross-device replacement: the server is wrapped by K2, this device's
    // Local Vault still opens with K. The Local Vault must not be what answers.
    await storeLocalVaultUnder(K);
    await expect(
      masterKeyOpensLocalVault({ owner: OWNER, masterKeyBytes: K }),
    ).resolves.toBe(true);

    const api = {
      getVaultBlobInventory: jest
        .fn()
        .mockResolvedValue(inventoryListing([TASKS])),
      getVaultBlob: jest
        .fn()
        .mockResolvedValue(blobResponse(await serverBlobUnder(K2))),
    };

    await expect(
      checkMasterKeyAgainstServerVault({ api, masterKeyBytes: K }),
    ).resolves.toBe('does-not-open');
    await expect(
      masterKeyOpensVault({ owner: OWNER, masterKeyBytes: K, api }),
    ).resolves.toBe(false);
  });

  test('3: an empty inventory defers to the Local Vault, which opens with the key', async () => {
    await storeLocalVaultUnder(K);
    const api = {
      getVaultBlobInventory: jest.fn().mockResolvedValue(inventoryListing([])),
      getVaultBlob: jest.fn(),
    };

    await expect(
      checkMasterKeyAgainstServerVault({ api, masterKeyBytes: K }),
    ).resolves.toBe('nothing-to-check');
    await expect(
      masterKeyOpensVault({ owner: OWNER, masterKeyBytes: K, api }),
    ).resolves.toBe(true);
    expect(api.getVaultBlob).not.toHaveBeenCalled();
  });

  test('4: an empty inventory defers to the Local Vault, which does not open with a different key', async () => {
    await storeLocalVaultUnder(K);
    const api = {
      getVaultBlobInventory: jest.fn().mockResolvedValue(inventoryListing([])),
      getVaultBlob: jest.fn(),
    };

    await expect(
      masterKeyOpensVault({ owner: OWNER, masterKeyBytes: K2, api }),
    ).resolves.toBe(false);
  });

  test('5: a Vault Blob that answers 404 is nothing to check, so the Local Vault answers', async () => {
    // The Local Vault is wrapped by K2 and answers false for K, so a false
    // result shows the fallback actually ran.
    await storeLocalVaultUnder(K2);
    const api = {
      getVaultBlobInventory: jest
        .fn()
        .mockResolvedValue(inventoryListing([TASKS])),
      getVaultBlob: jest.fn().mockRejectedValue(httpError(404)),
    };

    await expect(
      checkMasterKeyAgainstServerVault({ api, masterKeyBytes: K }),
    ).resolves.toBe('nothing-to-check');
    await expect(
      masterKeyOpensVault({ owner: OWNER, masterKeyBytes: K, api }),
    ).resolves.toBe(false);
  });

  test('6: a network failure is unreachable, and the Local Vault that opens with the key answers true', async () => {
    await storeLocalVaultUnder(K);
    const api = {
      getVaultBlobInventory: jest
        .fn()
        .mockRejectedValue(new Error('Network Error')),
      getVaultBlob: jest.fn(),
    };

    await expect(
      checkMasterKeyAgainstServerVault({ api, masterKeyBytes: K }),
    ).resolves.toBe('unreachable');
    await expect(
      masterKeyOpensVault({ owner: OWNER, masterKeyBytes: K, api }),
    ).resolves.toBe(true);
  });

  test('7: a network failure falls back to the Local Vault, which does not open with a different key', async () => {
    await storeLocalVaultUnder(K);
    const api = {
      getVaultBlobInventory: jest
        .fn()
        .mockRejectedValue(new Error('Network Error')),
      getVaultBlob: jest.fn(),
    };

    await expect(
      masterKeyOpensVault({ owner: OWNER, masterKeyBytes: K2, api }),
    ).resolves.toBe(false);
  });

  test('8: a 304 on the inventory is unreachable, because no If-None-Match was sent', async () => {
    await storeLocalVaultUnder(K);
    const api = {
      getVaultBlobInventory: jest.fn().mockRejectedValue(httpError(304)),
      getVaultBlob: jest.fn(),
    };

    await expect(
      checkMasterKeyAgainstServerVault({ api, masterKeyBytes: K }),
    ).resolves.toBe('unreachable');
    expect(api.getVaultBlob).not.toHaveBeenCalled();
  });

  test('9: a read that never settles is aborted at timeoutMs, and the Local Vault answers', async () => {
    await storeLocalVaultUnder(K);
    let signalSeen: AbortSignal | undefined;
    const api = {
      getVaultBlobInventory: jest.fn(
        (_params: unknown, options: { signal?: AbortSignal }) =>
          new Promise<never>((_resolve, reject) => {
            signalSeen = options.signal;
            options.signal?.addEventListener('abort', () =>
              reject(new Error('aborted')),
            );
          }),
      ),
      getVaultBlob: jest.fn(),
    };

    await expect(
      masterKeyOpensVault({
        owner: OWNER,
        masterKeyBytes: K,
        api,
        timeoutMs: 10,
      }),
    ).resolves.toBe(true);
    expect(signalSeen?.aborted).toBe(true);
  });

  test('10: throws when the server cannot answer and this owner holds no Local Vault', async () => {
    const api = {
      getVaultBlobInventory: jest
        .fn()
        .mockRejectedValue(new Error('Network Error')),
      getVaultBlob: jest.fn(),
    };

    await expect(
      masterKeyOpensVault({ owner: OWNER, masterKeyBytes: K, api }),
    ).rejects.toThrow('No Local Vault to check the Master Key against');
  });

  test('11: the inventory is read with no If-None-Match and a signal, and the blob with the first listed type', async () => {
    await storeLocalVaultUnder(K);
    const api = {
      getVaultBlobInventory: jest
        .fn()
        .mockResolvedValue(inventoryListing([TASKS, 'addresses'])),
      getVaultBlob: jest
        .fn()
        .mockResolvedValue(blobResponse(await serverBlobUnder(K))),
    };

    await expect(
      masterKeyOpensVault({ owner: OWNER, masterKeyBytes: K, api }),
    ).resolves.toBe(true);
    expect(api.getVaultBlobInventory).toHaveBeenCalledWith(
      { ifNoneMatch: undefined },
      { signal: expect.any(AbortSignal) },
    );
    expect(api.getVaultBlob).toHaveBeenCalledTimes(1);
    expect(api.getVaultBlob).toHaveBeenCalledWith(
      { type: TASKS },
      { signal: expect.any(AbortSignal) },
    );
  });
});
