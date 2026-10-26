/**
 * Mints and opens a QA Account's vault with the app's own crypto.
 *
 * Not application code and shipped in nothing: the library's barrel does not
 * export it, and `tools/scripts/qa-accounts.mjs` bundles this file for Node, as
 * `check-escape-copy-reader.ts` bundles its harness. It lives in this library
 * because a tooling project may not import a vault library. It goes through `localToServerMeta`, the converter the web client's
 * Vault Push uses, so the row the seeder writes is the row a client would have
 * sent, and through `vault-core`'s primitives, so the wrap is the one web and
 * mobile unwrap ([ADR 0039](../../../../../docs/adr/0039-web-and-mobile-vaults-share-one-crypto-suite.md)).
 */
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  base64ToBytes,
  bytesToBase64,
  deriveKeyFromPassphrase,
  importAesGcmKey,
} from '@myorganiser/vault-core';
import { localToServerMeta } from '../lib/vault/vaultShapes';

/**
 * The iteration count this seeder wraps at. Pinned here, like
 * `mintFreshEscapeCopy.ts`'s: both clients unwrap with the count the meta
 * carries, so the vault opens whatever this number is. The app's own
 * parameters are held by `libs/vault-core/src/lib/cryptoCompatibility.test.ts`.
 */
const KDF_ITERATIONS = 310_000;

type QaKeyMaterial = {
  salt: string;
  masterKey: string;
  recoveryKey: string;
  passphraseIv: string;
  recoveryIv: string;
};

type WrappedKey = { iv: string; ciphertext: string };

async function wrap(
  key: CryptoKey,
  masterKey: Uint8Array,
  iv: string,
): Promise<WrappedKey> {
  return {
    iv,
    ciphertext: bytesToBase64(
      await aesGcmEncrypt({
        key,
        plaintext: masterKey,
        iv: base64ToBytes(iv),
      }),
    ),
  };
}

async function unwrap(key: CryptoKey, wrapped: WrappedKey): Promise<string> {
  return bytesToBase64(
    await aesGcmDecrypt({
      key,
      ciphertext: base64ToBytes(wrapped.ciphertext),
      iv: base64ToBytes(wrapped.iv),
    }),
  );
}

/** The vault meta a client would have pushed for this passphrase and key material. */
export async function mintQaVaultMeta(options: {
  passphrase: string;
  keys: QaKeyMaterial;
}): Promise<ReturnType<typeof localToServerMeta>> {
  const { passphrase, keys } = options;
  const masterKey = base64ToBytes(keys.masterKey);
  const passphraseKey = await deriveKeyFromPassphrase({
    passphrase,
    salt: base64ToBytes(keys.salt),
    iterations: KDF_ITERATIONS,
  });
  const recoveryKey = await importAesGcmKey(base64ToBytes(keys.recoveryKey));

  return localToServerMeta({
    version: 1,
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: KDF_ITERATIONS,
      salt: keys.salt,
    },
    masterKeyWrappedWithPassphrase: await wrap(
      passphraseKey,
      masterKey,
      keys.passphraseIv,
    ),
    masterKeyWrappedWithRecoveryKey: await wrap(
      recoveryKey,
      masterKey,
      keys.recoveryIv,
    ),
    data: {},
  });
}

/**
 * Unwraps the Master Key both ways a User can, as base64. Throws when either
 * secret does not open the meta.
 */
export async function openQaVaultMeta(options: {
  meta: {
    kdf_salt: string;
    kdf_params: { iterations: number };
    wrapped_mk_passphrase: WrappedKey;
    wrapped_mk_recovery: WrappedKey;
  };
  passphrase: string;
  recoveryKey: string;
}): Promise<{ byPassphrase: string; byRecoveryKey: string }> {
  const { meta, passphrase, recoveryKey } = options;
  const passphraseKey = await deriveKeyFromPassphrase({
    passphrase,
    salt: base64ToBytes(meta.kdf_salt),
    iterations: meta.kdf_params.iterations,
  });
  return {
    byPassphrase: await unwrap(passphraseKey, meta.wrapped_mk_passphrase),
    byRecoveryKey: await unwrap(
      await importAesGcmKey(base64ToBytes(recoveryKey)),
      meta.wrapped_mk_recovery,
    ),
  };
}

/** Whether a stored Vault Blob's ciphertext opens under this Master Key. */
export async function qaVaultBlobOpens(options: {
  masterKey: string;
  blob: unknown;
}): Promise<boolean> {
  const blob = options.blob as Partial<WrappedKey> | null;
  if (typeof blob?.iv !== 'string' || typeof blob.ciphertext !== 'string') {
    return false;
  }
  try {
    await unwrap(await importAesGcmKey(base64ToBytes(options.masterKey)), {
      iv: blob.iv,
      ciphertext: blob.ciphertext,
    });
    return true;
  } catch {
    return false;
  }
}
