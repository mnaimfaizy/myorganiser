/**
 * Tests for `masterKeyOpensLocalVault` (ADR 0136, ADR 0054).
 *
 * Real WebCrypto through the real Vault Handle: the check is whether a recovered
 * Master Key decrypts a Vault Blob this device actually stored, so a mocked
 * primitive would prove nothing. Each test builds its own Local Vault.
 */

import {
  aesGcmDecrypt,
  base64ToBytes,
  importAesGcmKey,
  randomBytes,
} from './crypto';
import { masterKeyOpensLocalVault } from './masterKeyOpensLocalVault';
import { localVaultStorageKey, type VaultStorageV1 } from './localVaultStorage';
import { createVaultHandle } from './vaultHandle';

const OWNER = 'owner-a';
// 14 characters: within the fixture passphrase rule (docs/testing/README.md).
const PASSPHRASE = 'vault-secret-1';

beforeEach(() => {
  localStorage.clear();
});

/** Recover the Master Key a real Local Vault was created with, through its recovery wrapping. */
async function recoverMasterKey(recoveryKey: string): Promise<Uint8Array> {
  const stored = JSON.parse(
    localStorage.getItem(localVaultStorageKey(OWNER)) ?? 'null',
  ) as { vault: VaultStorageV1 } | null;
  if (!stored) throw new Error('No Local Vault was stored for this owner');
  const wrapped = stored.vault.masterKeyWrappedWithRecoveryKey;
  return aesGcmDecrypt({
    key: await importAesGcmKey(base64ToBytes(recoveryKey)),
    iv: base64ToBytes(wrapped.iv),
    ciphertext: base64ToBytes(wrapped.ciphertext),
  });
}

describe('masterKeyOpensLocalVault', () => {
  test('1: true for the Master Key that wrapped the Vault Blob this device stored', async () => {
    const handle = createVaultHandle({ owner: OWNER });
    const { recoveryKey } = await handle.initialize({ passphrase: PASSPHRASE });
    await handle.unlockWithPassphrase({ passphrase: PASSPHRASE });
    await handle.saveEncryptedData({ type: 'tasks', value: [] });
    const masterKeyBytes = await recoverMasterKey(recoveryKey);

    await expect(
      masterKeyOpensLocalVault({ owner: OWNER, masterKeyBytes }),
    ).resolves.toBe(true);
  }, 30_000);

  test('2: false for a different key once the Local Vault holds a Vault Blob', async () => {
    const handle = createVaultHandle({ owner: OWNER });
    const { recoveryKey } = await handle.initialize({ passphrase: PASSPHRASE });
    await handle.unlockWithPassphrase({ passphrase: PASSPHRASE });
    await handle.saveEncryptedData({ type: 'tasks', value: [] });
    const masterKeyBytes = await recoverMasterKey(recoveryKey);
    // Flip one byte: a different 32-byte key that is not the one that wrapped the blob.
    const otherKey = Uint8Array.from(masterKeyBytes, (byte, i) =>
      i === 0 ? byte ^ 0xff : byte,
    );

    await expect(
      masterKeyOpensLocalVault({ owner: OWNER, masterKeyBytes: otherKey }),
    ).resolves.toBe(false);
  }, 30_000);

  test('3: true for any key while the owned Local Vault has no Vault Blob yet', async () => {
    const handle = createVaultHandle({ owner: OWNER });
    await handle.initialize({ passphrase: PASSPHRASE });

    await expect(
      masterKeyOpensLocalVault({
        owner: OWNER,
        masterKeyBytes: randomBytes(32),
      }),
    ).resolves.toBe(true);
  }, 30_000);

  test('4: throws when this owner has no Local Vault to check the key against', async () => {
    await expect(
      masterKeyOpensLocalVault({
        owner: OWNER,
        masterKeyBytes: randomBytes(32),
      }),
    ).rejects.toThrow('No Local Vault to check the Master Key against');
  });
});
