import {
  EncryptedBlobV1,
  VaultBlobType,
  VaultMetaV1,
} from '@myorganiser/app-api-client';

import { EncryptedBlob, VaultStorageV1 } from './localVaultStorage';
import { VAULT_BLOB_FIELDS, VAULT_BLOB_TYPES } from './vaultBlobFields';

export function toEncryptedBlobV1(blob: EncryptedBlob): EncryptedBlobV1 {
  return {
    version: 1,
    iv: blob.iv,
    ciphertext: blob.ciphertext,
  };
}

export function normalizeEncryptedBlobV1(value: any): EncryptedBlobV1 | null {
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as any).version === 'number' &&
    (value as any).version !== 1
  ) {
    throw new Error(
      `Unsupported encrypted blob version: ${(value as any).version}`,
    );
  }

  return isEncryptedBlobV1(value) ? value : null;
}

export function localToServerMeta(vault: VaultStorageV1): VaultMetaV1 {
  return {
    version: 1,
    kdf_name: vault.kdf.name,
    kdf_salt: vault.kdf.salt,
    kdf_params: {
      hash: vault.kdf.hash,
      iterations: vault.kdf.iterations,
    },
    wrapped_mk_passphrase: toEncryptedBlobV1(
      vault.masterKeyWrappedWithPassphrase,
    ),
    wrapped_mk_recovery: toEncryptedBlobV1(
      vault.masterKeyWrappedWithRecoveryKey,
    ),
  };
}

export function serverEncryptedBlobToLocal(
  blob: EncryptedBlobV1,
): EncryptedBlob {
  return {
    iv: blob.iv,
    ciphertext: blob.ciphertext,
  };
}

export function serverMetaToLocalVault(options: {
  meta: VaultMetaV1;
  blobs: Partial<Record<VaultBlobType, EncryptedBlobV1 | null>>;
}): VaultStorageV1 {
  const { meta, blobs } = options;

  const wrappedPassphrase = normalizeEncryptedBlobV1(
    meta.wrapped_mk_passphrase,
  );
  const wrappedRecovery = normalizeEncryptedBlobV1(meta.wrapped_mk_recovery);

  if (!wrappedPassphrase || !wrappedRecovery) {
    throw new Error('Server vault meta is missing wrapped keys');
  }

  if (meta.kdf_params?.hash && meta.kdf_params.hash !== 'SHA-256') {
    throw new Error(
      `Unsupported KDF hash in server vault meta: ${meta.kdf_params.hash}`,
    );
  }

  const hash = 'SHA-256';
  const iterations =
    typeof meta.kdf_params?.iterations === 'number'
      ? meta.kdf_params.iterations
      : 310_000;

  const next: VaultStorageV1 = {
    version: 1,
    kdf: {
      name: 'PBKDF2',
      hash,
      iterations,
      salt: meta.kdf_salt,
    },
    masterKeyWrappedWithPassphrase:
      serverEncryptedBlobToLocal(wrappedPassphrase),
    masterKeyWrappedWithRecoveryKey:
      serverEncryptedBlobToLocal(wrappedRecovery),
    data: serverBlobsToLocalData(blobs),
  };

  return next;
}

/**
 * The Local Vault `data` a set of server Vault Blobs becomes.
 *
 * One fan-out over `VAULT_BLOB_TYPES` rather than one per caller: every place
 * that turns the server's Ciphertext into a Local Vault reaches this, so a
 * sixth Vault Blob Type cannot be carried by one path and dropped by
 * another ([ADR 0053](../../../../../docs/adr/0053-a-fan-out-over-a-domain-enum-is-pinned-at-its-call-site.md)).
 */
function serverBlobsToLocalData(
  blobs: Partial<Record<VaultBlobType, EncryptedBlobV1 | null>>,
): VaultStorageV1['data'] {
  const data: VaultStorageV1['data'] = {};

  for (const type of VAULT_BLOB_TYPES) {
    const blob = blobs[type];
    if (blob) {
      data[VAULT_BLOB_FIELDS[type]] = serverEncryptedBlobToLocal(blob);
    }
  }

  return data;
}

/**
 * The Local Vault that adopting a remote Vault Meta produces: the server's
 * wrapping over this device's Ciphertext.
 *
 * The Ciphertext is carried across rather than re-read from the server on
 * purpose. Adopting a wrapping is a statement about how the Vault is opened,
 * never about what it contains — a passphrase change rewraps the same Master
 * Key, so every Vault Blob here stays exactly as readable, exactly as unsent,
 * and exactly as mergeable as it was. Passing `blobs: {}` is what makes that
 * structural: there is no remote Ciphertext in scope to leak in.
 *
 * The wrapping still goes through `serverMetaToLocalVault`, so a meta missing
 * a wrapped key or carrying an unsupported KDF hash is rejected here rather
 * than saved and discovered at the next unlock.
 *
 * `localVault` must be a read taken immediately before the write, with no
 * await between: its Ciphertext is what gets written back, so a Local Vault
 * read any earlier reverts every Vault Blob saved since. The one writer is
 * `LocalVaultAccess.adoptVaultMetaWrapping` ([ADR 0143](../../../../../docs/adr/0143-a-local-vault-write-is-conditional-on-the-ciphertext-it-read-and-a-contended-save-merges.md)).
 */
export function adoptServerMetaIntoLocalVault(options: {
  localVault: VaultStorageV1;
  meta: VaultMetaV1;
}): VaultStorageV1 {
  const wrapping = serverMetaToLocalVault({ meta: options.meta, blobs: {} });

  return { ...wrapping, data: { ...options.localVault.data } };
}

function isEncryptedBlobV1(value: any): value is EncryptedBlobV1 {
  return (
    value &&
    typeof value === 'object' &&
    value.version === 1 &&
    typeof value.iv === 'string' &&
    typeof value.ciphertext === 'string'
  );
}
