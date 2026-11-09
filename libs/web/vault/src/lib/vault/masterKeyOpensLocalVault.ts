import { aesGcmDecrypt, base64ToBytes, importAesGcmKey } from './crypto';
import { ownedLocalVaultSlot } from './localVaultStorage';

/**
 * Whether `masterKeyBytes` opens `owner`'s Local Vault Ciphertext.
 *
 * The check Passkey Unlock makes before it trusts a recovered Master Key: a
 * Vault replaced since enrolment is wrapped by a different Master Key, and the
 * passkey's wrapping then holds the old one. Established by trying it on one
 * stored Vault Blob, as `decryptCiphertext` does (ADR 0054).
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
  try {
    const key = await importAesGcmKey(options.masterKeyBytes);
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
