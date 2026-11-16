import {
  PASSKEY_UNLOCK_RECORD_VERSION,
  type PasskeyUnlockRecord,
} from './passkeyUnlockStorage';

/**
 * A well-formed Passkey Unlock wrapping record for `owner`, for tests that
 * seed one into storage. It writes nothing: the caller stores it under
 * `passkeyUnlockStorageKey(owner)`, so no record writer joins the public
 * surface (ADR 0136). Its values are placeholders, not a real passkey's.
 */
export function passkeyUnlockRecordFixture(owner: string): PasskeyUnlockRecord {
  return {
    version: PASSKEY_UNLOCK_RECORD_VERSION,
    owner,
    credentialId: 'Y3JlZC1pZA==',
    prfSalt: 'c2FsdC1ieXRlcw==',
    wrappedMasterKey: { iv: 'aXYtYnl0ZXM=', ciphertext: 'Y2lwaGVy' },
  };
}
