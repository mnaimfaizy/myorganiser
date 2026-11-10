import type {
  GroceriesVaultPayload,
  VaultBlobEnvelope,
} from '@myorganiser/vault-core';

import {
  sameStoredCiphertext,
  VaultWriteContendedError,
} from './localVaultAccess';
import type { EncryptedBlob, VaultRecordType } from './localVaultStorage';
import {
  type EditableVaultRecordType,
  type VaultRecordStore,
  deleteVaultRecordAndSave,
  saveGroceriesPayload,
  saveVaultRecords,
} from './vaultRecordWrite';

/** The Ciphertext a store holds for a type when a save starts reading it. */
const STORED: EncryptedBlob = { iv: 'iv-stored', ciphertext: 'ct-stored' };

/** The Ciphertext another writer leaves behind between a read and a write. */
const OTHER: EncryptedBlob = { iv: 'iv-other', ciphertext: 'ct-other' };

/** What `loadDecryptedDataWithCiphertext` answers for a stored value. */
function holding(value: unknown) {
  return { value, ciphertext: value === null ? null : STORED };
}

describe('vaultRecordWrite', () => {
  let store: VaultRecordStore;
  let loadWithCiphertextMock: jest.Mock;
  let saveEncryptedDataMock: jest.Mock;

  beforeEach(() => {
    loadWithCiphertextMock = jest.fn();
    saveEncryptedDataMock = jest.fn().mockResolvedValue(undefined);
    store = {
      loadDecryptedDataWithCiphertext: loadWithCiphertextMock,
      saveEncryptedData: saveEncryptedDataMock,
    };
  });

  describe('saveVaultRecords', () => {
    const type: EditableVaultRecordType = 'tasks';

    test('should save envelope with deletions from stored payload', async () => {
      const record1 = { id: 'task-1', title: 'Task 1' };
      const record2 = { id: 'task-2', title: 'Task 2' };
      const records = [record1, record2];

      const storedEnvelope: VaultBlobEnvelope<unknown> = {
        records: [{ id: 'old-task', title: 'Old' }],
        deletions: { 'deleted-task': '2026-01-01T10:00:00.000Z' },
      };
      loadWithCiphertextMock.mockResolvedValue(holding(storedEnvelope));

      await saveVaultRecords(store, type, records);

      expect(loadWithCiphertextMock).toHaveBeenCalledWith({
        type,
        defaultValue: null,
      });
      expect(saveEncryptedDataMock).toHaveBeenCalledWith({
        type,
        value: {
          records,
          deletions: { 'deleted-task': '2026-01-01T10:00:00.000Z' },
        },
        expectedCiphertext: STORED,
      });
    });

    test('should save envelope with empty deletions from bare legacy array', async () => {
      const records = [
        { id: 'task-1', title: 'Task 1' },
        { id: 'task-2', title: 'Task 2' },
      ];

      const legacyPayload = [{ id: 'old-task', title: 'Old' }];
      loadWithCiphertextMock.mockResolvedValue(holding(legacyPayload));

      await saveVaultRecords(store, type, records);

      expect(saveEncryptedDataMock).toHaveBeenCalledWith({
        type,
        value: {
          records,
          deletions: {},
        },
        expectedCiphertext: STORED,
      });
    });

    test('should save envelope with empty deletions when nothing stored', async () => {
      const records = [{ id: 'task-1', title: 'Task 1' }];
      loadWithCiphertextMock.mockResolvedValue(holding(null));

      await saveVaultRecords(store, type, records);

      expect(saveEncryptedDataMock).toHaveBeenCalledWith({
        type,
        value: {
          records,
          deletions: {},
        },
        expectedCiphertext: null,
      });
    });

    test('should sanitize deletion log by dropping unusable entries', async () => {
      const records = [{ id: 'task-1', title: 'Task 1' }];

      const storedEnvelope: VaultBlobEnvelope<unknown> = {
        records: [],
        deletions: {
          a: null as unknown as string,
          b: 'not-a-date',
          c: '2026-01-01T10:00:00.000Z',
          d: '', // empty id
        },
      };
      loadWithCiphertextMock.mockResolvedValue(holding(storedEnvelope));

      await saveVaultRecords(store, type, records);

      const savedValue = (saveEncryptedDataMock.mock.calls[0] as unknown[])[0];
      const envelope = (savedValue as Record<string, unknown>)
        .value as VaultBlobEnvelope<unknown>;
      expect(envelope.deletions).toEqual({
        c: '2026-01-01T10:00:00.000Z',
      });
    });

    test('should reject when loadDecryptedDataWithCiphertext rejects', async () => {
      const records = [{ id: 'task-1', title: 'Task 1' }];
      const error = new Error('Decryption failed');
      loadWithCiphertextMock.mockRejectedValue(error);

      await expect(saveVaultRecords(store, type, records)).rejects.toThrow(
        'Decryption failed',
      );
      expect(saveEncryptedDataMock).not.toHaveBeenCalled();
    });

    test('should delete record from records and record deletion with explicit deletedAt', async () => {
      const record1 = { id: 'task-1', title: 'Task 1' };
      const record2 = { id: 'task-2', title: 'Task 2' };
      const records = [record1, record2];
      const deletedAt = '2026-01-15T14:30:00.000Z';

      loadWithCiphertextMock.mockResolvedValue(holding(null));

      await saveVaultRecords(store, type, records, {
        deletedId: 'task-1',
        deletedAt,
      });

      const savedValue = (saveEncryptedDataMock.mock.calls[0] as unknown[])[0];
      const envelope = (savedValue as Record<string, unknown>)
        .value as VaultBlobEnvelope<unknown>;

      expect(envelope.records).toEqual([record2]);
      expect(envelope.deletions).toEqual({ 'task-1': deletedAt });
    });

    test('should record deletion even when deletedId not in records', async () => {
      const records = [{ id: 'task-1', title: 'Task 1' }];
      const deletedAt = '2026-01-15T14:30:00.000Z';

      loadWithCiphertextMock.mockResolvedValue(holding(null));

      await saveVaultRecords(store, type, records, {
        deletedId: 'task-999',
        deletedAt,
      });

      const savedValue = (saveEncryptedDataMock.mock.calls[0] as unknown[])[0];
      const envelope = (savedValue as Record<string, unknown>)
        .value as VaultBlobEnvelope<unknown>;

      expect(envelope.records).toEqual(records);
      expect(envelope.deletions).toEqual({ 'task-999': deletedAt });
    });

    test('should use current time when deletedAt not provided', async () => {
      const record1 = { id: 'task-1', title: 'Task 1' };
      const record2 = { id: 'task-2', title: 'Task 2' };
      const records = [record1, record2];

      jest.useFakeTimers();
      const now = new Date('2026-01-15T10:00:00.000Z');
      jest.setSystemTime(now);

      loadWithCiphertextMock.mockResolvedValue(holding(null));

      await saveVaultRecords(store, type, records, {
        deletedId: 'task-1',
      });

      jest.useRealTimers();

      const savedValue = (saveEncryptedDataMock.mock.calls[0] as unknown[])[0];
      const envelope = (savedValue as Record<string, unknown>)
        .value as VaultBlobEnvelope<unknown>;

      expect(envelope.records).toEqual([record2]);
      expect(envelope.deletions['task-1']).toBe(now.toISOString());
    });
  });

  describe('unknown envelope keys (ADR 0114 decision 3)', () => {
    test('should keep an unknown envelope key when a deletion is written in the same save', async () => {
      const records = [
        { id: 'task-1', title: 'Task 1' },
        { id: 'task-2', title: 'Task 2' },
      ];
      const deletedAt = '2026-01-15T14:30:00.000Z';
      loadWithCiphertextMock.mockResolvedValue(
        holding({
          records: [],
          deletions: {},
          futureEnvelopeKey: { schema: 2 },
        }),
      );

      await saveVaultRecords(store, 'tasks', records, {
        deletedId: 'task-1',
        deletedAt,
      });

      expect(saveEncryptedDataMock).toHaveBeenCalledWith({
        type: 'tasks',
        value: {
          futureEnvelopeKey: { schema: 2 },
          records: [{ id: 'task-2', title: 'Task 2' }],
          deletions: { 'task-1': deletedAt },
        },
        expectedCiphertext: STORED,
      });
    });
  });

  describe('deleteVaultRecordAndSave', () => {
    const type: EditableVaultRecordType = 'tasks';
    const deletedAt = '2026-01-01T12:00:00.000Z';

    test('should remove record by id and record deletion', async () => {
      const record1 = { id: 'task-1', title: 'Task 1' };
      const record2 = { id: 'task-2', title: 'Task 2' };
      const records = [record1, record2];

      loadWithCiphertextMock.mockResolvedValue(holding(null));

      const remaining = await deleteVaultRecordAndSave(
        store,
        type,
        records,
        'task-1',
        deletedAt,
      );

      expect(remaining).toEqual([record2]);
      expect(saveEncryptedDataMock).toHaveBeenCalledWith({
        type,
        value: {
          records: [record2],
          deletions: { 'task-1': deletedAt },
        },
        expectedCiphertext: null,
      });
    });

    test('should keep existing deletion log entries', async () => {
      const records = [
        { id: 'task-1', title: 'Task 1' },
        { id: 'task-2', title: 'Task 2' },
      ];

      const storedEnvelope: VaultBlobEnvelope<unknown> = {
        records: [],
        deletions: {
          'task-3': '2026-01-01T10:00:00.000Z',
          'task-4': '2026-01-01T11:00:00.000Z',
        },
      };
      loadWithCiphertextMock.mockResolvedValue(holding(storedEnvelope));

      await deleteVaultRecordAndSave(store, type, records, 'task-1', deletedAt);

      const savedValue = (saveEncryptedDataMock.mock.calls[0] as unknown[])[0];
      const envelope = (savedValue as Record<string, unknown>)
        .value as VaultBlobEnvelope<unknown>;
      expect(envelope.deletions).toEqual({
        'task-3': '2026-01-01T10:00:00.000Z',
        'task-4': '2026-01-01T11:00:00.000Z',
        'task-1': deletedAt,
      });
    });

    test('should replace old deletion entry with newer one for same id', async () => {
      const records = [{ id: 'task-1', title: 'Task 1' }];
      const olderDeletionTime = '2026-01-01T10:00:00.000Z';
      const newerDeletionTime = '2026-01-01T12:00:00.000Z';

      const storedEnvelope: VaultBlobEnvelope<unknown> = {
        records: [],
        deletions: { 'task-1': olderDeletionTime },
      };
      loadWithCiphertextMock.mockResolvedValue(holding(storedEnvelope));

      await deleteVaultRecordAndSave(
        store,
        type,
        records,
        'task-1',
        newerDeletionTime,
      );

      const savedValue = (saveEncryptedDataMock.mock.calls[0] as unknown[])[0];
      const envelope = (savedValue as Record<string, unknown>)
        .value as VaultBlobEnvelope<unknown>;
      expect(envelope.deletions['task-1']).toBe(newerDeletionTime);
    });

    test('should keep older deletion entry when new deletion time is older', async () => {
      const records = [{ id: 'task-1', title: 'Task 1' }];
      const newerStoredTime = '2026-01-01T12:00:00.000Z';
      const olderDeletionTime = '2026-01-01T10:00:00.000Z';

      const storedEnvelope: VaultBlobEnvelope<unknown> = {
        records: [],
        deletions: { 'task-1': newerStoredTime },
      };
      loadWithCiphertextMock.mockResolvedValue(holding(storedEnvelope));

      await deleteVaultRecordAndSave(
        store,
        type,
        records,
        'task-1',
        olderDeletionTime,
      );

      const savedValue = (saveEncryptedDataMock.mock.calls[0] as unknown[])[0];
      const envelope = (savedValue as Record<string, unknown>)
        .value as VaultBlobEnvelope<unknown>;
      expect(envelope.deletions['task-1']).toBe(newerStoredTime);
    });

    test('should record deletion even when record not in list', async () => {
      const records = [{ id: 'task-1', title: 'Task 1' }];
      loadWithCiphertextMock.mockResolvedValue(holding(null));

      const remaining = await deleteVaultRecordAndSave(
        store,
        type,
        records,
        'task-999', // not in list
        deletedAt,
      );

      expect(remaining).toEqual(records);
      expect(saveEncryptedDataMock).toHaveBeenCalledWith({
        type,
        value: {
          records,
          deletions: { 'task-999': deletedAt },
        },
        expectedCiphertext: null,
      });
    });

    test('should return remaining records with same object references', async () => {
      const record1 = { id: 'task-1', title: 'Task 1' };
      const record2 = { id: 'task-2', title: 'Task 2' };
      const record3 = { id: 'task-3', title: 'Task 3' };
      const records = [record1, record2, record3];

      loadWithCiphertextMock.mockResolvedValue(holding(null));

      const remaining = await deleteVaultRecordAndSave(
        store,
        type,
        records,
        'task-2',
        deletedAt,
      );

      expect(remaining).toHaveLength(2);
      expect(remaining[0]).toBe(record1);
      expect(remaining[1]).toBe(record3);
    });

    test('should reject when loadDecryptedDataWithCiphertext rejects', async () => {
      const records = [{ id: 'task-1', title: 'Task 1' }];
      const error = new Error('Decryption failed');
      loadWithCiphertextMock.mockRejectedValue(error);

      await expect(
        deleteVaultRecordAndSave(store, type, records, 'task-1', deletedAt),
      ).rejects.toThrow('Decryption failed');
      expect(saveEncryptedDataMock).not.toHaveBeenCalled();
    });
  });

  describe('saveGroceriesPayload', () => {
    const samplePayload = {
      catalog: [
        {
          id: 'cat-1',
          name: 'Produce',
          category: 'produce' as const,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      lists: [],
    } satisfies GroceriesVaultPayload;

    test('should save envelope with empty deletions when store holds bare legacy payload', async () => {
      const payload = samplePayload;
      loadWithCiphertextMock.mockResolvedValue(holding([{ id: 'legacy' }]));

      await saveGroceriesPayload(store, payload);

      expect(loadWithCiphertextMock).toHaveBeenCalledWith({
        type: 'groceries',
        defaultValue: null,
      });
      expect(saveEncryptedDataMock).toHaveBeenCalledWith({
        type: 'groceries',
        value: {
          records: payload,
          deletions: {},
        },
        expectedCiphertext: STORED,
      });
    });

    test('should merge deletedIds with existing deletion log', async () => {
      const payload = samplePayload;
      const deletedAt = '2026-02-01T12:00:00.000Z';

      const storedEnvelope: VaultBlobEnvelope<unknown> = {
        records: { catalog: [], lists: [] },
        deletions: { 'old-delete': '2026-01-01T10:00:00.000Z' },
      };
      loadWithCiphertextMock.mockResolvedValue(holding(storedEnvelope));

      await saveGroceriesPayload(store, payload, {
        deletedIds: ['line-1', 'line-2'],
        deletedAt,
      });

      expect(saveEncryptedDataMock).toHaveBeenCalledWith({
        type: 'groceries',
        value: {
          records: payload,
          deletions: {
            'old-delete': '2026-01-01T10:00:00.000Z',
            'line-1': deletedAt,
            'line-2': deletedAt,
          },
        },
        expectedCiphertext: STORED,
      });
    });
  });

  describe('contended saves (ADR 0143)', () => {
    type SaveCall = {
      type: VaultRecordType;
      value: unknown;
      expectedCiphertext?: EncryptedBlob | null;
    };
    type StoredState = { value: unknown; ciphertext: EncryptedBlob | null };

    /**
     * A store another writer keeps changing. Each state in `otherWriterWrites`
     * lands just before the save that follows it is checked, so every save
     * meets Ciphertext it did not read, the way a pull or another tab would.
     * The write rule is the real one: a save goes ahead only while the
     * Ciphertext it was conditioned on is still the stored one.
     */
    function contendedStore(
      read: unknown,
      otherWriterWrites: StoredState[] = [],
    ) {
      let stored: StoredState = { value: read, ciphertext: STORED };
      const pending = [...otherWriterWrites];
      const attempts: SaveCall[] = [];
      const written: SaveCall[] = [];

      const loadMock = jest.fn();
      loadMock.mockImplementation(async () => stored);
      const saveMock = jest.fn(async (call: SaveCall) => {
        attempts.push(call);
        const landed = pending.shift();
        if (landed) stored = landed;
        if (
          !sameStoredCiphertext(
            stored.ciphertext,
            call.expectedCiphertext ?? null,
          )
        ) {
          throw new VaultWriteContendedError(call.type);
        }
        written.push(call);
        stored = {
          value: call.value,
          ciphertext: {
            iv: `iv-written-${written.length}`,
            ciphertext: `ct-written-${written.length}`,
          },
        };
      });

      const contendedStoreMock: VaultRecordStore = {
        loadDecryptedDataWithCiphertext: loadMock,
        saveEncryptedData: saveMock,
      };
      return {
        store: contendedStoreMock,
        attempts,
        written,
        current: () => stored,
      };
    }

    test('a pull and a User edit made during a save: the stored newer record survives, a pulled record is kept, and the newer User edit wins', async () => {
      const pulledRecord = {
        id: 'R',
        title: 'Pulled',
        updatedAt: '2026-01-01T11:00:00.000Z',
      };
      const pulledNew = {
        id: 'P',
        title: 'Added by pull',
        updatedAt: '2026-01-01T11:30:00.000Z',
      };
      const userEdit = {
        id: 'E',
        title: 'User edit',
        updatedAt: '2026-01-01T12:00:00.000Z',
      };
      const userRecords = [
        {
          id: 'R',
          title: 'Before pull',
          updatedAt: '2026-01-01T10:00:00.000Z',
        },
        userEdit,
      ];
      const { store, written } = contendedStore(
        { records: [], deletions: {} },
        [
          {
            value: {
              records: [
                pulledRecord,
                pulledNew,
                {
                  id: 'E',
                  title: 'Old',
                  updatedAt: '2026-01-01T09:00:00.000Z',
                },
              ],
              deletions: {},
            },
            ciphertext: OTHER,
          },
        ],
      );

      const result = await saveVaultRecords(store, 'tasks', userRecords);

      expect(result).toHaveLength(3);
      expect(result).toEqual(
        expect.arrayContaining([pulledRecord, pulledNew, userEdit]),
      );
      expect(written).toHaveLength(1);
      expect(written[0].value).toEqual({ records: result, deletions: {} });
    });

    test('an envelope key a newer client wrote meanwhile is kept, not restored to the stale copy this save read', async () => {
      const { store, written } = contendedStore(
        { records: [], deletions: {}, futureKey: { schema: 1 } },
        [
          {
            value: { records: [], deletions: {}, futureKey: { schema: 2 } },
            ciphertext: OTHER,
          },
        ],
      );

      await saveVaultRecords(store, 'tasks', [
        { id: 'T', title: 'Mine', updatedAt: '2026-01-01T10:00:00.000Z' },
      ]);

      expect(written).toHaveLength(1);
      expect(written[0].value).toEqual({
        futureKey: { schema: 2 },
        records: [
          { id: 'T', title: 'Mine', updatedAt: '2026-01-01T10:00:00.000Z' },
        ],
        deletions: {},
      });
    });

    test('one contended write: the first write is conditioned on what was read, the retry on the other writer Ciphertext, and the save resolves with the merged records', async () => {
      const otherRecord = {
        id: 'X',
        title: 'Other tab',
        updatedAt: '2026-01-01T09:00:00.000Z',
      };
      const mine = {
        id: 'M',
        title: 'Mine',
        updatedAt: '2026-01-01T10:00:00.000Z',
      };
      const { store, attempts, written } = contendedStore(
        { records: [], deletions: {} },
        [
          {
            value: { records: [otherRecord], deletions: {} },
            ciphertext: OTHER,
          },
        ],
      );

      const result = await saveVaultRecords(store, 'tasks', [mine]);

      expect(attempts.map((call) => call.expectedCiphertext)).toEqual([
        STORED,
        OTHER,
      ]);
      expect(written).toHaveLength(1);
      expect(result).toEqual([otherRecord, mine]);
    });

    test('three contended attempts reject with VaultWriteContendedError and write nothing, leaving the other writer Ciphertext stored', async () => {
      const moves: StoredState[] = [1, 2, 3].map((n) => ({
        value: { records: [], deletions: {} },
        ciphertext: { iv: `iv-move-${n}`, ciphertext: `ct-move-${n}` },
      }));
      const { store, attempts, written, current } = contendedStore(
        { records: [], deletions: {} },
        moves,
      );

      await expect(
        saveVaultRecords(store, 'tasks', [
          { id: 'M', title: 'Mine', updatedAt: '2026-01-01T10:00:00.000Z' },
        ]),
      ).rejects.toMatchObject({
        name: 'VaultWriteContendedError',
        type: 'tasks',
      });
      expect(attempts).toHaveLength(3);
      expect(written).toEqual([]);
      expect(current().ciphertext).toEqual(moves[2].ciphertext);
    });

    test('two contended attempts and a third that succeeds: three attempts, one write, and the result is the merge made on the third attempt', async () => {
      const otherRecord = {
        id: 'X',
        title: 'Other writer',
        updatedAt: '2026-01-01T09:00:00.000Z',
      };
      const mine = {
        id: 'M',
        title: 'Mine',
        updatedAt: '2026-01-01T10:00:00.000Z',
      };
      const { store, attempts, written } = contendedStore(
        { records: [], deletions: {} },
        [
          {
            value: { records: [], deletions: {} },
            ciphertext: { iv: 'iv-move-1', ciphertext: 'ct-move-1' },
          },
          {
            value: { records: [otherRecord], deletions: {} },
            ciphertext: { iv: 'iv-move-2', ciphertext: 'ct-move-2' },
          },
        ],
      );

      const result = await saveVaultRecords(store, 'tasks', [mine]);

      expect(attempts).toHaveLength(3);
      expect(attempts[2].expectedCiphertext).toEqual({
        iv: 'iv-move-2',
        ciphertext: 'ct-move-2',
      });
      expect(written).toHaveLength(1);
      expect(result).toEqual([otherRecord, mine]);
      expect(written[0].value).toEqual({ records: result, deletions: {} });
    });

    test('saveVaultRecords resolves with the caller records when nothing moved', async () => {
      const records = [
        { id: 'task-1', title: 'Task 1' },
        { id: 'task-2', title: 'Task 2' },
      ];
      const { store, written } = contendedStore({
        records: [],
        deletions: {},
      });

      await expect(saveVaultRecords(store, 'tasks', records)).resolves.toEqual(
        records,
      );
      expect(written).toHaveLength(1);
    });

    test('deleteVaultRecordAndSave contended: resolves the merged records, records the deletion, and the deleted record stays absent even where the other writer still holds it', async () => {
      const deletedAt = '2026-01-01T12:00:00.000Z';
      const stillHeldElsewhere = {
        id: 't1',
        title: 'Held by other writer',
        updatedAt: '2026-01-01T09:00:00.000Z',
      };
      const kept = {
        id: 't2',
        title: 'Kept',
        updatedAt: '2026-01-01T09:30:00.000Z',
      };
      const addedByPull = {
        id: 't3',
        title: 'Added by pull',
        updatedAt: '2026-01-01T11:00:00.000Z',
      };
      const { store, written } = contendedStore(
        { records: [], deletions: {} },
        [
          {
            value: {
              records: [stillHeldElsewhere, addedByPull],
              deletions: {},
            },
            ciphertext: OTHER,
          },
        ],
      );

      const result = await deleteVaultRecordAndSave(
        store,
        'tasks',
        [stillHeldElsewhere, kept],
        't1',
        deletedAt,
      );

      expect(result).toHaveLength(2);
      expect(result).toEqual(expect.arrayContaining([kept, addedByPull]));
      expect(result.map((record) => record.id)).not.toContain('t1');
      expect(written).toHaveLength(1);
      expect(written[0].value).toMatchObject({
        deletions: { t1: deletedAt },
      });
    });

    test('saveGroceriesPayload contended: resolves the nested merge, keeping a list the other writer added alongside this save list', async () => {
      const catalogItem = {
        id: 'cat-1',
        name: 'Produce',
        category: 'produce' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      const listAddedElsewhere = {
        id: 'list-other',
        name: 'Added in another tab',
        lines: [],
        createdAt: '2026-01-01T08:00:00.000Z',
        updatedAt: '2026-01-01T08:00:00.000Z',
      };
      const listMine = {
        id: 'list-mine',
        name: 'Mine',
        lines: [],
        createdAt: '2026-01-01T09:00:00.000Z',
        updatedAt: '2026-01-01T09:00:00.000Z',
      };
      const { store, written } = contendedStore(
        { records: { catalog: [], lists: [] }, deletions: {} },
        [
          {
            value: {
              records: { catalog: [catalogItem], lists: [listAddedElsewhere] },
              deletions: {},
            },
            ciphertext: OTHER,
          },
        ],
      );

      const result = await saveGroceriesPayload(store, {
        catalog: [catalogItem],
        lists: [listMine],
      });

      expect(result.lists.map((list) => list.id)).toEqual(
        expect.arrayContaining(['list-other', 'list-mine']),
      );
      expect(result.catalog.map((item) => item.id)).toEqual(['cat-1']);
      expect(written[0].value).toEqual({ records: result, deletions: {} });
    });

    test('a store failure that is not a contention is rethrown without a retry', async () => {
      const failure = new Error('disk full');
      const failingStore: VaultRecordStore = {
        loadDecryptedDataWithCiphertext: jest.fn(async () => ({
          value: null,
          ciphertext: null,
        })) as unknown as VaultRecordStore['loadDecryptedDataWithCiphertext'],
        saveEncryptedData: jest.fn().mockRejectedValue(failure),
      };

      await expect(
        saveVaultRecords(failingStore, 'tasks', [{ id: 'T', title: 'Mine' }]),
      ).rejects.toBe(failure);
      expect(failingStore.saveEncryptedData).toHaveBeenCalledTimes(1);
    });
  });
});
