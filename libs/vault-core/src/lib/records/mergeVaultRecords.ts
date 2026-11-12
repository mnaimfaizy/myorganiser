import {
  mergeDeletionLogs,
  mergeEnvelopeUnknownFields,
  toEpoch,
  type VaultBlobEnvelope,
} from './vaultBlobEnvelope';

/** The one field a record must carry to be merged: its identity. */
export interface IdentifiedRecord {
  id: string;
}

/**
 * Converges two copies of one Vault Blob's records, per
 * [ADR 0054](../../../../../docs/adr/0054-a-vault-blob-converges-by-record-and-absence-is-recorded.md).
 *
 * It is a plain function and stays one: no crypto, no storage, no HTTP, no
 * clock. Everything it needs arrives as an argument, which is what lets a
 * non-web consumer call it and what lets a test state a case in three lines.
 *
 * The rules, in order:
 *
 *   1. Records are unioned by `id`. Neither side is authoritative — a record
 *      only one side has is kept.
 *   2. Two versions of one `id` resolve to the one `changedAt` says is newer.
 *      A tie keeps `local`, so merging a blob against itself changes nothing.
 *   3. The Deletion Logs are unioned, keeping the newer instant per id, and
 *      nothing is ever dropped from the result.
 *   4. A record loses to a deletion at or after the instant it last changed;
 *      a record changed strictly after its deletion survives.
 *   5. Envelope keys other than `records` and `deletions` are unioned, `local`
 *      winning a key both carry (ADR 0114 decision 3). A winning record is
 *      kept whole, so its own unknown fields survive too.
 *
 * Rule 4 resolves the equal case toward the deletion, and resolves a record
 * with no usable timestamp the same way. Both are the direction that cannot
 * resurrect data the User deleted, which is the failure this whole mechanism
 * exists to prevent — a record wrongly buried is still in the loser's copy
 * until it is pushed, a record wrongly raised is back on every device.
 *
 * @param changedAt Reads the instant a record last changed. Record types
 *   differ on where that lives and whether it is there at all, so each type's
 *   own merge function supplies it rather than this function guessing.
 */
export function mergeRecordsById<TRecord extends IdentifiedRecord>(
  local: VaultBlobEnvelope<TRecord[]>,
  remote: VaultBlobEnvelope<TRecord[]>,
  changedAt: (record: TRecord) => string | undefined,
): VaultBlobEnvelope<TRecord[]> {
  const deletions = mergeDeletionLogs(local.deletions, remote.deletions);

  const winners = new Map<string, TRecord>();
  const order: string[] = [];

  for (const record of toRecordArray<TRecord>(local.records)) {
    if (!winners.has(record.id)) order.push(record.id);
    winners.set(record.id, record);
  }

  for (const record of toRecordArray<TRecord>(remote.records)) {
    const existing = winners.get(record.id);
    if (existing === undefined) {
      order.push(record.id);
      winners.set(record.id, record);
      continue;
    }
    if (toEpoch(changedAt(record)) > toEpoch(changedAt(existing))) {
      winners.set(record.id, record);
    }
  }

  const records: TRecord[] = [];
  for (const id of order) {
    const record = winners.get(id);
    if (record === undefined) continue;

    const deletedAt = deletions[id];
    if (
      deletedAt !== undefined &&
      toEpoch(changedAt(record)) <= toEpoch(deletedAt)
    ) {
      continue;
    }

    records.push(record);
  }

  return { ...mergeEnvelopeUnknownFields(local, remote), records, deletions };
}

/**
 * The usable records in one side of a merge.
 *
 * The parameter is `unknown` rather than `TRecord[]` because that is the
 * truth: an envelope is reconstituted from decrypted JSON, so its `records`
 * can be any shape the last writer left behind, whatever the type says. An
 * entry with no usable `id` cannot be merged — it has no identity to union
 * on — so it is dropped rather than crashing the merge.
 */
function toRecordArray<TRecord extends IdentifiedRecord>(
  value: unknown,
): TRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((record): record is TRecord => hasMergeableId(record));
}

/**
 * Whether an entry has the identity a merge unions on: an object whose `id` is
 * a non-empty string. Anything else is dropped by `mergeRecordsById`, and a
 * caller that pre-filters a side before merging uses this so the two never
 * disagree on what counts as an identity.
 */
export function hasMergeableId(entry: unknown): entry is IdentifiedRecord {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as IdentifiedRecord).id === 'string' &&
    (entry as IdentifiedRecord).id.length > 0
  );
}
