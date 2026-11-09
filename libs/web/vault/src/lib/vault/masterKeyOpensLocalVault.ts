import { aesGcmDecrypt, base64ToBytes, importAesGcmKey } from './crypto';
import { ownedLocalVaultSlot, type EncryptedBlob } from './localVaultStorage';

/**
 * Whether `masterKeyBytes` decrypts `blob`. Established by trying it, as
 * `decryptCiphertext` does (ADR 0054): a wrong key fails AES-GCM's tag check.
 */
export async function masterKeyOpensBlob(
  masterKeyBytes: Uint8Array,
  blob: EncryptedBlob,
): Promise<boolean> {
  try {
    const key = await importAesGcmKey(masterKeyBytes);
    await aesGcmDecrypt({
      key,
      iv: base64ToBytes(blob.iv),
      ciphertext: base64ToBytes(blob.ciphertext),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether `masterKeyBytes` opens `owner`'s Local Vault Ciphertext.
 *
 * The fallback Passkey Unlock uses when the server's Ciphertext cannot be read
 * (see `masterKeyOpensVault`). It catches a Vault replaced on this device; a
 * Vault replaced on another device leaves this copy wrapped by the old Master
 * Key, which is why the server is asked first.
 *
 * A Local Vault with no blob yet has nothing to contradict the key, so it
 * reads as open. Throws when there is no owned Local Vault to check against.
 */
export async function masterKeyOpensLocalVault(options: {
  owner: string;
  masterKeyBytes: Uint8Array;
}): Promise<boolean> {
  const read = ownedLocalVaultSlot(options.owner).read();
  if (read.status !== 'owned') {
    throw new Error('No Local Vault to check the Master Key against');
  }
  const blob = Object.values(read.vault.data).find(Boolean);
  if (!blob) return true;
  return masterKeyOpensBlob(options.masterKeyBytes, blob);
}
