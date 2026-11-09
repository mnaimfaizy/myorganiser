import type { VaultApi } from '@myorganiser/app-api-client';

import {
  masterKeyOpensBlob,
  masterKeyOpensLocalVault,
} from './masterKeyOpensLocalVault';
import {
  checkServerVaultBlobInventory,
  getServerVaultBlob,
} from './serverVaultSync';
import { serverEncryptedBlobToLocal } from './vaultShapes';

/**
 * How long Passkey Unlock waits for the server before it checks the Local
 * Vault instead. The User has just verified with their device and is waiting
 * at the vault gate; a slow server must not hold them there.
 */
export const SERVER_CHECK_TIMEOUT_MS = 5_000;

/** What trying a Master Key on the server's Ciphertext found. */
export type ServerMasterKeyCheck =
  /** It decrypted one of the server's Vault Blobs. */
  | 'opens'
  /** The server's Ciphertext is wrapped by a different Master Key. */
  | 'does-not-open'
  /** The server holds no Vault Blob to try it on. */
  | 'nothing-to-check'
  /** The server could not be read: offline, timed out, or refused. */
  | 'unreachable';

/**
 * Try `masterKeyBytes` on one Vault Blob the server holds.
 *
 * One blob is enough: every Vault Blob is encrypted under the same Master Key,
 * so a Vault re-initialized elsewhere fails on any of them. The Vault Blob
 * Inventory names which types exist without carrying Ciphertext (ADR 0068).
 */
export async function checkMasterKeyAgainstServerVault(options: {
  api: Pick<VaultApi, 'getVaultBlobInventory' | 'getVaultBlob'>;
  masterKeyBytes: Uint8Array;
  signal?: AbortSignal;
}): Promise<ServerMasterKeyCheck> {
  const { api, masterKeyBytes, signal } = options;
  try {
    const inventory = await checkServerVaultBlobInventory(
      api,
      undefined,
      signal,
    );
    // No If-None-Match was sent, so a 304 is not an answer about this Vault.
    if (inventory.kind !== 'inventory') return 'unreachable';
    const first = inventory.inventory.blobs[0];
    if (!first) return 'nothing-to-check';

    const remote = await getServerVaultBlob(api, first.type, signal);
    if (!remote) return 'nothing-to-check';

    return (await masterKeyOpensBlob(
      masterKeyBytes,
      serverEncryptedBlobToLocal(remote.blob),
    ))
      ? 'opens'
      : 'does-not-open';
  } catch {
    return 'unreachable';
  }
}

/**
 * What each server answer means for the key: settled either way, or `null`
 * when the Local Vault must answer instead (ADR 0053).
 */
const SERVER_ANSWER = {
  opens: true,
  'does-not-open': false,
  'nothing-to-check': null,
  unreachable: null,
} as const satisfies Record<ServerMasterKeyCheck, boolean | null>;

/**
 * The verifier Passkey Unlock gives `unlockWithPasskey` (ADR 0136, decision 6):
 * whether the Master Key a passkey recovered still opens the Vault.
 *
 * The server's Ciphertext is the authority, because a Vault replaced on another
 * device changes it there first and leaves this device's Local Vault wrapped by
 * the old Master Key. When the server cannot answer — offline, slow, or holding
 * no Vault Blob yet — the Local Vault is checked instead, so Passkey Unlock
 * keeps working offline and still catches a Vault replaced on this device.
 *
 * A Vault with no Ciphertext anywhere has nothing to contradict the key, so it
 * reads as open: there is nothing to decrypt with the wrong key yet.
 */
export async function masterKeyOpensVault(options: {
  owner: string;
  masterKeyBytes: Uint8Array;
  api: Pick<VaultApi, 'getVaultBlobInventory' | 'getVaultBlob'>;
  timeoutMs?: number;
}): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? SERVER_CHECK_TIMEOUT_MS,
  );
  let server: ServerMasterKeyCheck;
  try {
    server = await checkMasterKeyAgainstServerVault({
      api: options.api,
      masterKeyBytes: options.masterKeyBytes,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const settled = SERVER_ANSWER[server];
  if (settled !== null) return settled;
  return masterKeyOpensLocalVault({
    owner: options.owner,
    masterKeyBytes: options.masterKeyBytes,
  });
}
