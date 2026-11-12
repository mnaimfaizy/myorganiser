import type { VaultBlobType } from '@myorganiser/app-api-client';
import type { IdentifiedRecord } from '@myorganiser/vault-core';

import {
  normalizeAddresses,
  normalizeMobileNumbers,
} from './contactRecordNormalization';
import type { VaultRecordType } from './localVaultStorage';
import { normalizeSubscriptions } from './subscriptionRecordNormalization';
import { normalizeTasks } from './taskNormalization';

/** Reads a stored payload's records as the page would after loading them. */
export type StoredRecordNormalizer = (
  payload: unknown,
) => readonly IdentifiedRecord[];

/**
 * Each Vault Blob Type's normalizer, applied to the stored side before a page
 * save merges into it
 * ([ADR 0143](../../../../../../docs/adr/0143-a-local-vault-write-is-conditional-on-the-ciphertext-it-read-and-a-contended-save-merges.md)
 * decision 3).
 *
 * A page writes its normalized list back on load. Normalizing repairs fields
 * without moving `updatedAt` and drops records it cannot repair, and a merge
 * tie keeps the stored copy, so merging that write-back into the raw stored
 * records would keep the raw copies and bring the dropped ones back. With both
 * sides normalized, the tie is between equal records.
 *
 * Groceries is `null`: its save writes the composed payload on its first
 * attempt and merges only on contention, so it has no stored side to
 * normalize first (#1501 left Groceries out of scope).
 *
 * A legacy record stored with no `id` gets a fresh `randomId()` each time it
 * is normalized, so it can reach the merge under two ids and be kept twice.
 * That is a known residue, not fixed here.
 *
 * The `satisfies` clause is the guard (ADR 0053): a sixth Vault Blob Type fails
 * to compile here until somebody decides how its stored side is read.
 */
export const STORED_RECORD_NORMALIZERS = {
  addresses: (payload) => normalizeAddresses(payload).value,
  groceries: null,
  mobileNumbers: (payload) => normalizeMobileNumbers(payload).value,
  subscriptions: (payload) => normalizeSubscriptions(payload).value,
  tasks: (payload) => normalizeTasks(payload).value,
} as const satisfies Record<VaultBlobType, StoredRecordNormalizer | null> &
  Record<VaultRecordType, StoredRecordNormalizer | null>;
