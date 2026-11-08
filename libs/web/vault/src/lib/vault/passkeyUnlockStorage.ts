/**
 * Passkey Unlock storage — two per-User, per-device records (ADR 0136).
 *
 * **The wrapping record** holds what a passkey needs to recover the Master
 * Key on this device: the credential id, the PRF salt, and the Master Key
 * wrapped with AES-GCM by a key imported from the passkey's 32-byte PRF
 * output. It is never the Master Key itself, so nothing readable rests on the
 * device (CONTEXT.md, "Passkey Unlock"). It is client-only: it is not part of
 * the Local Vault's stored wrappings, not part of Vault Meta, and nothing in
 * it is ever sent to the server.
 *
 * **The offer record** says the one-time offer was answered for this owner on
 * this device. It carries no answer: declining and accepting both end the
 * offer, and turning Passkey Unlock on later is the Vault page's job.
 *
 * Keyed by owner in the storage key — `myorganiser_passkey_unlock_v1:<owner>`
 * and `myorganiser_passkey_unlock_offer_v1:<owner>` — and the owner is
 * repeated in the value, so an entry naming somebody else is rejected rather
 * than trusted. Another User signed in on the same browser can never read
 * this User's record.
 *
 * Failure direction: a missing, corrupt, mis-keyed or unreadable wrapping
 * record reads as "not enrolled", which costs a passkey option that is not
 * shown — the passphrase is still there. A missing or unreadable offer record
 * reads as "not offered", which costs the offer being shown again. Both are
 * the direction these records are allowed to be wrong in, the same choice
 * ADR 0058 made for the Sync Bookmark.
 */

import type { Base64String } from '@myorganiser/vault-core';

/** The storage key prefix every per-User passkey wrapping record key is built from. */
export const PASSKEY_UNLOCK_STORAGE_KEY = 'myorganiser_passkey_unlock_v1';

/** The storage key prefix every per-User Passkey Unlock offer record key is built from. */
export const PASSKEY_UNLOCK_OFFER_STORAGE_KEY =
  'myorganiser_passkey_unlock_offer_v1';

/** Record version written for a passkey wrapping record. */
export const PASSKEY_UNLOCK_RECORD_VERSION = 1;

/** Record version written for a Passkey Unlock offer record. */
export const PASSKEY_UNLOCK_OFFER_RECORD_VERSION = 1;

/** One User's Passkey Unlock enrolment on this device. */
export type PasskeyUnlockRecord = {
  version: 1;
  owner: string;
  /** The passkey's raw credential id, base64. */
  credentialId: Base64String;
  /** The PRF salt evaluated at enrolment and on every unlock, base64. */
  prfSalt: Base64String;
  /** The Master Key, AES-GCM-encrypted under the PRF-derived key. */
  wrappedMasterKey: { iv: Base64String; ciphertext: Base64String };
};

/** The one-time offer was answered for this owner on this device. */
export type PasskeyUnlockOfferRecord = {
  version: 1;
  owner: string;
};

function assertOwner(owner: string): void {
  if (typeof owner !== 'string' || owner.trim().length === 0) {
    throw new Error('Passkey Unlock cannot be resolved without an owner');
  }
}

/** The storage key one User's passkey wrapping record lives under. */
export function passkeyUnlockStorageKey(owner: string): string {
  assertOwner(owner);
  return `${PASSKEY_UNLOCK_STORAGE_KEY}:${owner}`;
}

/** The storage key one User's Passkey Unlock offer record lives under. */
export function passkeyUnlockOfferStorageKey(owner: string): string {
  assertOwner(owner);
  return `${PASSKEY_UNLOCK_OFFER_STORAGE_KEY}:${owner}`;
}

function readableStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    // A browser that refuses storage access throws on the property read.
    return null;
  }
}

function writableStorage(): Storage {
  const storage = readableStorage();
  if (!storage) {
    throw new Error(
      'Passkey Unlock storage is unavailable outside the browser',
    );
  }
  return storage;
}

function readRaw(key: string): string | null {
  const storage = readableStorage();
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function asPasskeyUnlockRecord(
  parsed: unknown,
  owner: string,
): PasskeyUnlockRecord | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Partial<PasskeyUnlockRecord>;
  if (candidate.version !== PASSKEY_UNLOCK_RECORD_VERSION) return null;
  if (candidate.owner !== owner) return null;
  if (!isNonEmptyString(candidate.credentialId)) return null;
  if (!isNonEmptyString(candidate.prfSalt)) return null;
  const wrapped = candidate.wrappedMasterKey as
    | Partial<PasskeyUnlockRecord['wrappedMasterKey']>
    | null
    | undefined;
  if (typeof wrapped !== 'object' || wrapped === null) return null;
  if (!isNonEmptyString(wrapped.iv)) return null;
  if (!isNonEmptyString(wrapped.ciphertext)) return null;

  return {
    version: PASSKEY_UNLOCK_RECORD_VERSION,
    owner,
    credentialId: candidate.credentialId,
    prfSalt: candidate.prfSalt,
    wrappedMasterKey: { iv: wrapped.iv, ciphertext: wrapped.ciphertext },
  };
}

/**
 * `owner`'s passkey wrapping record on this device, or `undefined` when they
 * have none — or when storage is unavailable, or the entry does not validate
 * as this owner's current-version record. `undefined` means "not enrolled".
 */
export function readPasskeyUnlockRecord(
  owner: string,
): PasskeyUnlockRecord | undefined {
  assertOwner(owner);
  const raw = readRaw(passkeyUnlockStorageKey(owner));
  if (raw === null) return undefined;
  return asPasskeyUnlockRecord(parseJson(raw), owner) ?? undefined;
}

/**
 * Write `owner`'s passkey wrapping record, replacing any earlier enrolment on
 * this device. Touches only the key `owner` is stored under. Throws when
 * storage is unavailable or refuses the write.
 */
export function writePasskeyUnlockRecord(options: {
  owner: string;
  credentialId: Base64String;
  prfSalt: Base64String;
  wrappedMasterKey: { iv: Base64String; ciphertext: Base64String };
}): void {
  assertOwner(options.owner);
  const record: PasskeyUnlockRecord = {
    version: PASSKEY_UNLOCK_RECORD_VERSION,
    owner: options.owner,
    credentialId: options.credentialId,
    prfSalt: options.prfSalt,
    wrappedMasterKey: {
      iv: options.wrappedMasterKey.iv,
      ciphertext: options.wrappedMasterKey.ciphertext,
    },
  };
  writableStorage().setItem(
    passkeyUnlockStorageKey(options.owner),
    JSON.stringify(record),
  );
}

/** Remove `owner`'s passkey wrapping record. Never touches another User's. */
export function removePasskeyUnlockRecord(owner: string): void {
  assertOwner(owner);
  writableStorage().removeItem(passkeyUnlockStorageKey(owner));
}

/**
 * Whether the one-time offer was answered for `owner` on this device. A
 * missing, corrupt or unreadable entry reads as `false`, so a lost record
 * offers again rather than never.
 */
export function readPasskeyUnlockOffered(owner: string): boolean {
  assertOwner(owner);
  const raw = readRaw(passkeyUnlockOfferStorageKey(owner));
  if (raw === null) return false;
  const parsed = parseJson(raw);
  if (typeof parsed !== 'object' || parsed === null) return false;
  const candidate = parsed as Partial<PasskeyUnlockOfferRecord>;
  return (
    candidate.version === PASSKEY_UNLOCK_OFFER_RECORD_VERSION &&
    candidate.owner === owner
  );
}

/** Record that `owner` answered the one-time offer on this device. Throws when storage is unavailable. */
export function writePasskeyUnlockOffered(owner: string): void {
  assertOwner(owner);
  const record: PasskeyUnlockOfferRecord = {
    version: PASSKEY_UNLOCK_OFFER_RECORD_VERSION,
    owner,
  };
  writableStorage().setItem(
    passkeyUnlockOfferStorageKey(owner),
    JSON.stringify(record),
  );
}

/** Remove `owner`'s offer record. Never touches another User's. */
export function removePasskeyUnlockOffered(owner: string): void {
  assertOwner(owner);
  writableStorage().removeItem(passkeyUnlockOfferStorageKey(owner));
}
