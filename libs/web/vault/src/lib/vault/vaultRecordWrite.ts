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
 * Write what a save composed from the stored blob, merging and retrying when
 * another writer moves the type's Ciphertext first. Resolves with the envelope
 * actually written.
 *
 * The first attempt writes `compose(stored)`: the caller's records beside the
 * stored Deletion Log and the envelope keys this build does not know. Both are
 * read at write time rather than carried in page state, because convergence
 * and the mobile Vault Push both add to the log without passing through the
 * page that is about to save, and a newer client's envelope fields must
 * survive this save (ADR 0114 decision 3).
 *
 * If the Ciphertext moved, what is now stored is `local` and this save's
 * envelope is `remote` in the type's pinned merge
 * ([ADR 0143](../../../../../../docs/adr/0143-a-local-vault-write-is-conditional-on-the-ciphertext-it-read-and-a-contended-save-merges.md)).
 * The User's edit wins on its newer timestamp, a record the other writer added
 * is kept, and the other writer's envelope fields are not put back to this
 * save's stale copy. Every retry merges the save's own envelope into what is
 * stored then, never a merge that already lost.
 *
 * Throws `VaultWriteContendedError`, having written nothing, after
 * `VAULT_WRITE_ATTEMPTS` contended attempts.
 */
async function writeMergingOnContention<TPayload>(
  store: VaultRecordStore,
  type: VaultRecordType,
  compose: (stored: unknown) => VaultBlobEnvelope<TPayload>,
): Promise<VaultBlobEnvelope<TPayload>> {
  // Every type is pinned to `mergeById`. A type later pinned to
  // `promptOnConflict` has no merge, and fails to compile here until somebody
  // decides what its contended save does.
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
      attempt === 1
        ? saved
        : (merge(
            toVaultBlobEnvelope(stored.value),
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

/** A deletion to write down in the same save. */
export interface VaultRecordDeletion {
  /** The id of the record being deleted. */
  deletedId: string;
  /** When it was deleted. Defaults to now. */
  deletedAt?: IsoDateTimeString;
}

/**
 * Saves `records` as the whole records half of `type`, with the stored
 * Deletion Log and any envelope keys this build does not know written back
 * beside them. Resolves with the records actually written, which after a
 * contended save include what another writer brought; a caller shows those,
 * not its own `records`.
 *
 * A page that saves bare records drops the log, and every deletion another
 * device recorded is resurrected by the next merge with a copy that still
 * holds the record
 * ([ADR 0054](../../../../../../docs/adr/0054-a-vault-blob-converges-by-record-and-absence-is-recorded.md)).
 * Reading both halves and writing both back is what keeps it.
 *
 * Leaving a record out of `records` does not delete it. Pass `deletedId`,
 * and the deletion is written into the log as well: the record is dropped
 * from `records` if it is still there, and recorded as deleted even if it
 * is not.
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
 * Resolves with the records written, for the caller to show. After a
 * contended save they are the merged records, not `records` minus `id`.
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
    (stored) => ({
      ...readEnvelopeUnknownFields(stored),
      records: payload,
      deletions: mergeDeletionLogs(readDeletionLog(stored), additions),
    }),
  );
  return written.records;
}
