/**
 * Test support for the unknown-field round trip (ADR 0114 decision 3): a
 * stored envelope is read by a normalizer, the normalized records are saved
 * through the real save in `vaultRecordWrite`, and the envelope that save
 * writes is what the test asserts on.
 *
 * Not a `.test.ts` file: it holds no tests, and the `.testutil.ts` suffix keeps
 * it out of the shipped library (see `promisePending.testutil.ts`).
 */
import type { EncryptedBlob, VaultRecordType } from './localVaultStorage';
import type { VaultRecordStore } from './vaultRecordWrite';

/** The Ciphertext every stored fixture in this round trip is read under. */
export const STORED_CIPHERTEXT: EncryptedBlob = {
  iv: 'round-trip-iv',
  ciphertext: 'round-trip-ciphertext',
};

/**
 * A store whose decrypted read returns `stored` and whose encrypted write is
 * recorded. The stored envelope is plaintext fixture data, so no crypto is on
 * the path: this suite decides over shapes (see the web-vault testing guide).
 */
export function storeHolding(stored: unknown): {
  store: VaultRecordStore;
  saveEncryptedData: jest.Mock;
} {
  const saveEncryptedData = jest.fn().mockResolvedValue(undefined);
  const store: VaultRecordStore = {
    loadDecryptedDataWithCiphertext: jest.fn().mockResolvedValue({
      value: stored,
      ciphertext: stored === null ? null : STORED_CIPHERTEXT,
    }),
    saveEncryptedData,
  };
  return { store, saveEncryptedData };
}

/**
 * The one save a round trip makes: `type`, the envelope it writes, and the
 * stored Ciphertext it was conditioned on (ADR 0143).
 */
export function expectSavedEnvelope(
  saveEncryptedData: jest.Mock,
  saved: { type: VaultRecordType; value: unknown },
): void {
  expect(saveEncryptedData).toHaveBeenCalledTimes(1);
  expect(saveEncryptedData).toHaveBeenCalledWith({
    ...saved,
    expectedCiphertext: STORED_CIPHERTEXT,
  });
}
