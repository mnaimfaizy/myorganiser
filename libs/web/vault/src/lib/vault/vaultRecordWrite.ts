import {
  deleteVaultRecord,
  toVaultBlobEnvelope,
  mergeDeletionLogs,
  readDeletionLog,
  readEnvelopeUnknownFields,
  type DeletionLog,
  type GroceriesVaultPayload,
  type IdentifiedRecord,
  type IsoDateTimeString,
  type VaultBlobEnvelope,
} from '@myorganiser/vault-core';

import { VaultWriteContendedError } from './localVaultAccess';
import type { VaultRecordType } from './localVaultStorage';
import { STORED_RECORD_NORMALIZERS } from './storedRecordNormalizers';
import {
  VAULT_BLOB_CONVERGE_STRATEGIES,
  VAULT_BLOB_TYPE_BY_FIELD,
} from './vaultBlobFields';
import type { VaultHandle } from './vaultHandle';

/**
 * The Local Vault fields a page edits one record at a time.
 *
 * Groceries' `{ catalog, lists }` payload has no top-level records, and
 * `deleteVaultRecord` refuses it for the same reason.
 */
export type EditableVaultRecordType = Exclude<VaultRecordType, 'groceries'>;

/** The two Vault Handle calls a record write needs, and nothing else. */
export type VaultRecordStore = Pick<
  VaultHandle,
  'loadDecryptedDataWithCiphertext' | 'saveEncryptedData'
>;

/**
 * How many times a save tries to write before it gives up: the first write,
 * then two merges against whatever moved in (ADR 0143, decision 4).
 */
export const VAULT_WRITE_ATTEMPTS = 3;

/**
 * What a save's first attempt writes.
 *
 * - `merge`: the save's envelope merged into what is stored, exactly as every
 *   retry is. A page holds a record list that can be stale, so writing it as
 *   it is would replace records another tab added (#1501).
 * - `compose`: the save's envelope as composed. Only Groceries still does
 *   this; its nested payload is out of #1501's scope.
 *
 * Required, not defaulted, so a new caller decides which it is.
 */
type FirstAttempt = 'merge' | 'compose';

/**
 * Write what a save composed from the stored blob, merging into what is
 * stored and retrying when another writer moves the type's Ciphertext first.
 * Resolves with the envelope actually written.
 *
 * `compose(stored)` builds the save's own envelope: the caller's records beside
 * the stored Deletion Log and the envelope keys this build does not know. Both
 * are read at write time rather than carried in page state, because
 * convergence and the mobile Vault Push both add to the log without passing
 * through the page that is about to save, and a newer client's envelope fields
 * must survive this save (ADR 0114 decision 3).
 *
 * Every merge takes what is stored, read through the type's pinned normalizer
 * (`STORED_RECORD_NORMALIZERS`), as `local` and this save's envelope as
 * `remote` in the type's pinned merge
 * ([ADR 0143](../../../../../../docs/adr/0143-a-local-vault-write-is-conditional-on-the-ciphertext-it-read-and-a-contended-save-merges.md)).
 * The User's edit wins on its newer timestamp, a record the other writer added
 * is kept, and the other writer's envelope fields are not put back to this
 * save's stale copy. `firstAttempt` says whether the first attempt merges too.
 * Every retry merges the save's own envelope into what is stored then, never a
 * merge that already lost.
 *
 * Throws `VaultWriteContendedError`, having written nothing, after
 * `VAULT_WRITE_ATTEMPTS` contended attempts.
 */
async function writeMergingOnContention<TPayload>(
  store: VaultRecordStore,
  type: VaultRecordType,
  firstAttempt: FirstAttempt,
  compose: (stored: unknown) => VaultBlobEnvelope<TPayload>,
): Promise<VaultBlobEnvelope<TPayload>> {
  // Every type is pinned to `mergeById`. A type later pinned to
  // `promptOnConflict` has no merge, and fails to compile here until somebody
  // decides what its save does.
  const { merge } =
    VAULT_BLOB_CONVERGE_STRATEGIES[VAULT_BLOB_TYPE_BY_FIELD[type]];

  let saved: VaultBlobEnvelope<TPayload> | undefined;
  for (let attempt = 1; attempt <= VAULT_WRITE_ATTEMPTS; attempt++) {
    const stored = await store.loadDecryptedDataWithCiphertext<unknown>({
      type,
      defaultValue: null,
    });
    saved ??= compose(stored.value);
    const envelope =
      attempt === 1 && firstAttempt === 'compose'
        ? saved
        : (merge(
            readStored(type, stored.value),
            saved,
          ) as VaultBlobEnvelope<TPayload>);
    try {
      await store.saveEncryptedData({
        type,
        value: envelope,
        expectedCiphertext: stored.ciphertext,
      });
      return envelope;
    } catch (error) {
      if (!(error instanceof VaultWriteContendedError)) throw error;
    }
  }
  throw new VaultWriteContendedError(type);
}

/**
 * The stored blob of `type` as a merge's `local` side, its records read
 * through the type's pinned normalizer. A type the table pins to `null`
 * (Groceries) is read as it is stored.
 *
 * A stored entry with no usable `id` (a legacy string address or mobile
 * number, or a record a pre-id client wrote) is dropped before normalizing.
 * Normalizing would mint it a fresh `randomId()`, and the page's own write-back
 * mints another, so the merge would keep two copies. The merge already drops
 * an entry it cannot match by `id` (`mergeRecordsById`). A legacy entry the
 * page loaded survives: the page's write-back carries its normalized copy,
 * with an id. One the page never loaded is dropped, by decision (ADR 0143):
 * only a pre-id client writing after the page loaded could leave one. Only the
 * stored side is filtered, never the save's own envelope.
 */
function readStored(
  type: VaultRecordType,
  stored: unknown,
): VaultBlobEnvelope<unknown> {
  const envelope = toVaultBlobEnvelope(stored);
  const normalize = STORED_RECORD_NORMALIZERS[type];
  if (normalize === null) return envelope;
  const records = Array.isArray(envelope.records)
    ? envelope.records.filter(hasUsableId)
    : envelope.records;
  return { ...envelope, records: normalize(records) };
}

/**
 * The identity a merge matches on: the same test `mergeRecordsById` applies
 * to each side's entries (`toRecordArray` in `mergeVaultRecords.ts`).
 */
function hasUsableId(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) return false;
  const id = (entry as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0;
}

/** A deletion to write down in the same save. */
export interface VaultRecordDeletion {
  /** The id of the record being deleted. */
  deletedId: string;
  /** When it was deleted. Defaults to now. */
  deletedAt?: IsoDateTimeString;
}

/**
 * Merges `records` into what `type` stores, with the stored Deletion Log and
 * any envelope keys this build does not know kept beside them. Resolves with
 * the records actually written, which include every stored record `records`
 * left out; a caller shows those, not its own `records`.
 *
 * A page's list can be stale: another tab may have saved since the page
 * loaded. So the save never replaces the stored records. It merges into them
 * with the type's pinned `mergeById`, on the first attempt as on every retry
 * (ADR 0143 decision 3, #1501). A record the page does not hold is kept, and a
 * stale copy of a record loses to the newer one stored.
 *
 * A page that saves bare records drops the log, and every deletion another
 * device recorded is resurrected by the next merge with a copy that still
 * holds the record
 * ([ADR 0054](../../../../../../docs/adr/0054-a-vault-blob-converges-by-record-and-absence-is-recorded.md)).
 * Reading both halves and writing both back is what keeps it.
 *
 * Leaving a record out of `records` does not delete it, here or in a later
 * merge. Pass `deletedId`, and the deletion is written into the log as well:
 * the record is dropped from `records` if it is still there, and recorded as
 * deleted even if it is not, and the merge drops it from what is stored.
 *
 * The write is conditional on the type's Ciphertext not moving meanwhile; see
 * `writeMergingOnContention` for what happens when it does.
 */
export async function saveVaultRecords<TRecord extends IdentifiedRecord>(
  store: VaultRecordStore,
  type: EditableVaultRecordType,
  records: readonly TRecord[],
  deletion?: VaultRecordDeletion,
): Promise<TRecord[]> {
  // Stamped once, so every attempt records the deletion at the same instant.
  const deleted =
    deletion === undefined
      ? undefined
      : {
          id: deletion.deletedId,
          at: deletion.deletedAt ?? new Date().toISOString(),
        };
  const written = await writeMergingOnContention<unknown>(
    store,
    type,
    'merge',
    (stored) => {
      const envelope: VaultBlobEnvelope<unknown> = {
        ...readEnvelopeUnknownFields(stored),
        records: [...records],
        deletions: readDeletionLog(stored),
      };
      return deleted === undefined
        ? envelope
        : deleteVaultRecord(envelope, deleted.id, deleted.at);
    },
  );
  return written.records as TRecord[];
}

/**
 * Saves `records` without the record `id`, and records its deletion in the
 * Deletion Log at `deletedAt`, keeping every entry the log already holds.
 *
 * Resolves with the records written, for the caller to show. They are the
 * merged records, not `records` minus `id`: what is stored and `records` has
 * not seen is kept.
 */
export async function deleteVaultRecordAndSave<
  TRecord extends IdentifiedRecord,
>(
  store: VaultRecordStore,
  type: EditableVaultRecordType,
  records: readonly TRecord[],
  id: string,
  deletedAt: IsoDateTimeString,
): Promise<TRecord[]> {
  return saveVaultRecords(
    store,
    type,
    records.filter((record) => record.id !== id),
    { deletedId: id, deletedAt },
  );
}

/** Ids to record as absent in the same Groceries save. */
export interface GroceriesDeletion {
  /** Catalog Item, Grocery List, or List Line ids. */
  deletedIds: readonly string[];
  /** When they were deleted. Defaults to now. One instant covers the whole set. */
  deletedAt?: IsoDateTimeString;
}

/**
 * Saves a Groceries payload as an envelope, writing the stored Deletion Log
 * back beside it.
 *
 * A bare `{ catalog, lists }` save drops every deletion another device
 * recorded, and the next merge puts those records back
 * ([ADR 0113](../../../../../../docs/adr/0113-groceries-converges-by-nested-record-and-a-destroyed-parent-stays-absent.md)).
 * `deleteVaultRecord` cannot do this: it refuses a non-array payload.
 *
 * Resolves with the payload actually written. After a contended save it is
 * the nested Groceries merge of what was stored and `payload`.
 */
export async function saveGroceriesPayload(
  store: VaultRecordStore,
  payload: GroceriesVaultPayload,
  deletion?: GroceriesDeletion,
): Promise<GroceriesVaultPayload> {
  const additions: DeletionLog = {};
  if (deletion !== undefined) {
    const deletedAt = deletion.deletedAt ?? new Date().toISOString();
    for (const id of deletion.deletedIds) {
      additions[id] = deletedAt;
    }
  }
  const written = await writeMergingOnContention<GroceriesVaultPayload>(
    store,
    'groceries',
    // A stale Groceries tab still replaces what is stored on a first attempt
    // that meets no contention; its nested merge is outside #1501.
    'compose',
    (stored) => ({
      ...readEnvelopeUnknownFields(stored),
      records: payload,
      deletions: mergeDeletionLogs(readDeletionLog(stored), additions),
    }),
  );
  return written.records;
}
