import type {
  GroceriesVaultPayload,
  VaultBlobEnvelope,
} from '@myorganiser/vault-core';

import {
  normalizeAddresses,
  normalizeMobileNumbers,
} from './contactRecordNormalization';
import {
  sameStoredCiphertext,
  VaultWriteContendedError,
} from './localVaultAccess';
import type { EncryptedBlob, VaultRecordType } from './localVaultStorage';
import { normalizeSubscriptions } from './subscriptionRecordNormalization';
import { normalizeTasks } from './taskNormalization';
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

const TASK_CREATED_AT = '2026-01-01T00:00:00.000Z';

/**
 * A Task in the exact shape the Task normalizer returns for it. A stored copy
 * is normalized before a merge, so a fixture already in that shape comes back
 * equal to what the test wrote.
 */
function validTask(id: string, title: string, updatedAt: string) {
  return {
    id,
    title,
    status: 'pending' as const,
    priority: 'medium' as const,
    archived: false,
    createdAt: TASK_CREATED_AT,
    updatedAt,
  };
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
      const oldTask = validTask('old-task', 'Old', '2026-01-01T09:00:00.000Z');
      const record1 = validTask('task-1', 'Task 1', '2026-01-01T10:00:00.000Z');
      const record2 = validTask('task-2', 'Task 2', '2026-01-01T10:00:00.000Z');
      const records = [record1, record2];

      const storedEnvelope: VaultBlobEnvelope<unknown> = {
        records: [oldTask],
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
          records: [oldTask, record1, record2],
          deletions: { 'deleted-task': '2026-01-01T10:00:00.000Z' },
        },
        expectedCiphertext: STORED,
      });
    });

    test('should save envelope with empty deletions from bare legacy array', async () => {
      const legacyTask = validTask(
        'old-task',
        'Old',
        '2026-01-01T09:00:00.000Z',
      );
      const records = [
        validTask('task-1', 'Task 1', '2026-01-01T10:00:00.000Z'),
        validTask('task-2', 'Task 2', '2026-01-01T10:00:00.000Z'),
      ];

      const legacyPayload = [legacyTask];
      loadWithCiphertextMock.mockResolvedValue(holding(legacyPayload));

      await saveVaultRecords(store, type, records);

      expect(saveEncryptedDataMock).toHaveBeenCalledWith({
        type,
        value: {
          records: [legacyTask, ...records],
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

  describe('merge into stored records on every save (ADR 0143 decision 3, #1501)', () => {
    const type: EditableVaultRecordType = 'tasks';
    const EARLIER = '2026-01-01T09:00:00.000Z';
    const LATER = '2026-01-01T10:00:00.000Z';

    test('a stale list that omits a record another tab added keeps that record in the write and the result', async () => {
      const tabOne = validTask('A', 'Added in tab one', EARLIER);
      const tabTwo = validTask('B', 'Added in tab two', LATER);
      loadWithCiphertextMock.mockResolvedValue(
        holding({ records: [tabOne], deletions: {} }),
      );

      const result = await saveVaultRecords(store, type, [tabTwo]);

      expect(saveEncryptedDataMock).toHaveBeenCalledTimes(1);
      expect(saveEncryptedDataMock).toHaveBeenCalledWith({
        type,
        value: { records: [tabOne, tabTwo], deletions: {} },
        expectedCiphertext: STORED,
      });
      expect(result).toEqual([tabOne, tabTwo]);
    });

    test('a stale copy of a record loses to the newer copy stored', async () => {
      const newer = validTask('X', 'Newer', LATER);
      const older = validTask('X', 'Older', EARLIER);
      loadWithCiphertextMock.mockResolvedValue(
        holding({ records: [newer], deletions: {} }),
      );

      const result = await saveVaultRecords(store, type, [older]);

      expect(result).toEqual([newer]);
      expect(saveEncryptedDataMock).toHaveBeenCalledWith({
        type,
        value: { records: [newer], deletions: {} },
        expectedCiphertext: STORED,
      });
    });

    test('a newer copy of a record from the page replaces the stored copy', async () => {
      const stored = validTask('X', 'Stored', EARLIER);
      const edited = validTask('X', 'Edited', LATER);
      loadWithCiphertextMock.mockResolvedValue(
        holding({ records: [stored], deletions: {} }),
      );

      const result = await saveVaultRecords(store, type, [edited]);

      expect(result).toEqual([edited]);
      expect(saveEncryptedDataMock).toHaveBeenCalledWith({
        type,
        value: { records: [edited], deletions: {} },
        expectedCiphertext: STORED,
      });
    });

    test('a deletion from a stale tab removes the record from the write and records it in the log', async () => {
      const x = validTask('X', 'Deleted here', EARLIER);
      const y = validTask('Y', 'Kept', EARLIER);
      loadWithCiphertextMock.mockResolvedValue(
        holding({ records: [x, y], deletions: {} }),
      );

      const result = await saveVaultRecords(store, type, [y], {
        deletedId: 'X',
        deletedAt: LATER,
      });

      expect(result).toEqual([y]);
      expect(saveEncryptedDataMock).toHaveBeenCalledWith({
        type,
        value: { records: [y], deletions: { X: LATER } },
        expectedCiphertext: STORED,
      });
    });

    test('a stored deletion is not undone by a stale list that still holds the record', async () => {
      const staleX = validTask('X', 'Stale copy', EARLIER);
      const y = validTask('Y', 'Kept', EARLIER);
      loadWithCiphertextMock.mockResolvedValue(
        holding({ records: [y], deletions: { X: LATER } }),
      );

      const result = await saveVaultRecords(store, type, [staleX, y]);

      expect(result).toEqual([y]);
      expect(saveEncryptedDataMock).toHaveBeenCalledWith({
        type,
        value: { records: [y], deletions: { X: LATER } },
        expectedCiphertext: STORED,
      });
    });

    test('a record the page leaves out is kept, and no deletion is recorded for it', async () => {
      const x = validTask('X', 'Stored', EARLIER);
      const y = validTask('Y', 'Kept', EARLIER);
      loadWithCiphertextMock.mockResolvedValue(
        holding({ records: [x, y], deletions: {} }),
      );

      const result = await saveVaultRecords(store, type, [y]);

      expect(result).toEqual([x, y]);
      expect(saveEncryptedDataMock).toHaveBeenCalledWith({
        type,
        value: { records: [x, y], deletions: {} },
        expectedCiphertext: STORED,
      });
    });

    test('a first save with nothing stored writes its records with an empty Deletion Log, and resolves with them', async () => {
      const records = [
        validTask('A', 'First', EARLIER),
        validTask('B', 'Second', LATER),
      ];
      loadWithCiphertextMock.mockResolvedValue(holding(null));

      const result = await saveVaultRecords(store, type, records);

      expect(saveEncryptedDataMock).toHaveBeenCalledTimes(1);
      expect(saveEncryptedDataMock).toHaveBeenCalledWith({
        type,
        value: { records, deletions: {} },
        expectedCiphertext: null,
      });
      expect(result).toEqual(records);
    });

    test('an envelope key this build does not know is carried through an uncontended save', async () => {
      loadWithCiphertextMock.mockResolvedValue(
        holding({
          records: [],
          deletions: {},
          futureEnvelopeKey: { schema: 2 },
        }),
      );

      await saveVaultRecords(store, type, [validTask('A', 'Mine', EARLIER)]);

      expect(saveEncryptedDataMock).toHaveBeenCalledWith({
        type,
        value: {
          futureEnvelopeKey: { schema: 2 },
          records: [validTask('A', 'Mine', EARLIER)],
          deletions: {},
        },
        expectedCiphertext: STORED,
      });
    });

    test('the stored side is normalized before the merge, so a raw stored copy and a record the normalizer drops do not come back', async () => {
      // A raw stored copy: untrimmed title and an invalid status. The page
      // loaded it, normalized it, and saves the normalized copy with the same
      // updatedAt. A malformed record with no title is dropped by the page.
      const rawStored = {
        id: 'T1',
        title: '  Pay rent  ',
        status: 'bogus',
        priority: 'medium',
        archived: false,
        createdAt: TASK_CREATED_AT,
        updatedAt: EARLIER,
      };
      const malformed = { id: 'T2', updatedAt: EARLIER };
      loadWithCiphertextMock.mockResolvedValue(
        holding({ records: [rawStored, malformed], deletions: {} }),
      );
      const normalizedPage = validTask('T1', 'Pay rent', EARLIER);

      const result = await saveVaultRecords(store, type, [normalizedPage]);

      expect(result).toEqual([normalizedPage]);
      expect(saveEncryptedDataMock).toHaveBeenCalledWith({
        type,
        value: { records: [normalizedPage], deletions: {} },
        expectedCiphertext: STORED,
      });
    });

    const RECORD_CREATED_AT = '2026-01-01T00:00:00.000Z';

    /**
     * One case per editable type whose normalizer repairs a stored field. The
     * page copy is what the page holds after its load-time normalization; the
     * stored copy has the same id and updatedAt but the raw field. `dropped` is
     * a non-object entry, the only kind these three normalizers drop.
     */
    test.each([
      {
        type: 'addresses' as const,
        normalize: (payload: unknown) => normalizeAddresses(payload).value,
        stored: {
          id: 'AD1',
          label: '  Home  ',
          status: 'banana',
          usageLocations: [],
          createdAt: RECORD_CREATED_AT,
          updatedAt: EARLIER,
        },
        repaired: { label: 'Home', status: 'current' },
        omitted: {
          id: 'AD2',
          label: 'Kept',
          status: 'current',
          usageLocations: [],
          createdAt: RECORD_CREATED_AT,
          updatedAt: EARLIER,
        },
      },
      {
        type: 'mobileNumbers' as const,
        normalize: (payload: unknown) => normalizeMobileNumbers(payload).value,
        stored: {
          id: 'MN1',
          label: '  Work ',
          mobileNumber: ' 0400 ',
          usageLocations: [],
          createdAt: RECORD_CREATED_AT,
          updatedAt: EARLIER,
        },
        repaired: { label: 'Work', mobileNumber: '0400' },
        omitted: {
          id: 'MN2',
          label: 'Kept',
          mobileNumber: '0411',
          usageLocations: [],
          createdAt: RECORD_CREATED_AT,
          updatedAt: EARLIER,
        },
      },
      {
        type: 'subscriptions' as const,
        normalize: (payload: unknown) => normalizeSubscriptions(payload).value,
        stored: {
          id: 'SB1',
          name: '  Streamer  ',
          startDate: RECORD_CREATED_AT,
          status: 'bogus',
          updatedAt: EARLIER,
        },
        repaired: { name: 'Streamer', status: 'active' },
        omitted: {
          id: 'SB2',
          name: 'Kept',
          startDate: RECORD_CREATED_AT,
          status: 'active',
          updatedAt: EARLIER,
        },
      },
    ])(
      'a stored $type copy the normalizer repairs is merged in its normalized form, a dropped entry does not come back, and a record the page leaves out is kept',
      async ({ type, normalize, stored, repaired, omitted }) => {
        const pageCopy = normalize([stored])[0];
        expect(pageCopy).toMatchObject(repaired);
        const omittedCopy = normalize([omitted])[0];
        loadWithCiphertextMock.mockResolvedValue(
          holding({ records: [stored, omitted, null], deletions: {} }),
        );

        const result = await saveVaultRecords(store, type, [pageCopy]);

        expect(result).toEqual([pageCopy, omittedCopy]);
        expect(saveEncryptedDataMock).toHaveBeenCalledWith({
          type,
          value: { records: [pageCopy, omittedCopy], deletions: {} },
          expectedCiphertext: STORED,
        });
      },
    );

    /**
     * The #1501 two-tab add, for the types the per-type case above does not
     * cover in this shape. Tab A wrote record A, which is stored. This page's
     * stale list holds only record B, which A never saw. No contention: one
     * save, writing both. Both records go through the real normalizer, so the
     * expected records are exactly what a page would hold.
     */
    test.each([
      {
        type: 'addresses' as const,
        normalize: (payload: unknown) => normalizeAddresses(payload).value,
        tabA: {
          id: 'AD-A',
          label: 'Home',
          status: 'current',
          usageLocations: [],
          createdAt: RECORD_CREATED_AT,
          updatedAt: EARLIER,
        },
        tabB: {
          id: 'AD-B',
          label: 'Work',
          status: 'current',
          usageLocations: [],
          createdAt: RECORD_CREATED_AT,
          updatedAt: LATER,
        },
      },
      {
        type: 'mobileNumbers' as const,
        normalize: (payload: unknown) => normalizeMobileNumbers(payload).value,
        tabA: {
          id: 'MN-A',
          label: 'Work',
          mobileNumber: '0411',
          usageLocations: [],
          createdAt: RECORD_CREATED_AT,
          updatedAt: EARLIER,
        },
        tabB: {
          id: 'MN-B',
          label: 'Personal',
          mobileNumber: '0422',
          usageLocations: [],
          createdAt: RECORD_CREATED_AT,
          updatedAt: LATER,
        },
      },
      {
        type: 'subscriptions' as const,
        normalize: (payload: unknown) => normalizeSubscriptions(payload).value,
        tabA: {
          id: 'SB-A',
          name: 'Streamer',
          startDate: RECORD_CREATED_AT,
          status: 'active',
          updatedAt: EARLIER,
        },
        tabB: {
          id: 'SB-B',
          name: 'Cloud Storage',
          startDate: RECORD_CREATED_AT,
          status: 'active',
          updatedAt: LATER,
        },
      },
    ])(
      'a stale $type list adds its new record beside the stored record another tab wrote, in one save, and resolves with both',
      async ({ type, normalize, tabA, tabB }) => {
        const storedA = normalize([tabA])[0];
        const addedB = normalize([tabB])[0];
        loadWithCiphertextMock.mockResolvedValue(
          holding({ records: [storedA], deletions: {} }),
        );

        const result = await saveVaultRecords(store, type, [addedB]);

        expect(saveEncryptedDataMock).toHaveBeenCalledTimes(1);
        expect(saveEncryptedDataMock).toHaveBeenCalledWith({
          type,
          value: { records: [storedA, addedB], deletions: {} },
          expectedCiphertext: STORED,
        });
        expect(result).toEqual([storedA, addedB]);
      },
    );
  });

  describe('legacy stored entries with no usable id (#1501)', () => {
    const EARLIER = '2026-01-01T09:00:00.000Z';
    const LATER = '2026-01-01T10:00:00.000Z';
    const CREATED_AT = '2026-01-01T00:00:00.000Z';

    // The page loads a legacy entry, normalizes it (minting an id), and saves
    // that normalized list back. The stored side must not mint a second copy.

    test('a legacy string address is written once, under the id the page write-back holds', async () => {
      const stored = ['1 Main St'];
      loadWithCiphertextMock.mockResolvedValue(holding(stored));
      const pageCopies = normalizeAddresses(stored).value;

      const result = await saveVaultRecords(store, 'addresses', pageCopies);

      expect(pageCopies).toHaveLength(1);
      expect(pageCopies[0]).toMatchObject({ address: '1 Main St' });
      expect(typeof pageCopies[0].id).toBe('string');
      expect(pageCopies[0].id.length).toBeGreaterThan(0);
      expect(saveEncryptedDataMock).toHaveBeenCalledTimes(1);
      expect(saveEncryptedDataMock).toHaveBeenCalledWith({
        type: 'addresses',
        value: { records: [pageCopies[0]], deletions: {} },
        expectedCiphertext: STORED,
      });
      expect(result).toEqual(pageCopies);
    });

    test('a legacy string mobile number is written once, under the id the page write-back holds', async () => {
      const stored = ['0400111222'];
      loadWithCiphertextMock.mockResolvedValue(holding(stored));
      const pageCopies = normalizeMobileNumbers(stored).value;

      const result = await saveVaultRecords(store, 'mobileNumbers', pageCopies);

      expect(pageCopies).toHaveLength(1);
      expect(pageCopies[0]).toMatchObject({ mobileNumber: '0400111222' });
      expect(saveEncryptedDataMock).toHaveBeenCalledTimes(1);
      expect(saveEncryptedDataMock).toHaveBeenCalledWith({
        type: 'mobileNumbers',
        value: { records: [pageCopies[0]], deletions: {} },
        expectedCiphertext: STORED,
      });
      expect(result).toEqual(pageCopies);
    });

    test('a stored Task with no id is written once, under the id the page write-back holds', async () => {
      const stored = [
        {
          title: 'Legacy task',
          status: 'pending',
          priority: 'medium',
          archived: false,
          createdAt: CREATED_AT,
        },
      ];
      loadWithCiphertextMock.mockResolvedValue(holding(stored));
      const pageCopies = normalizeTasks(stored).value;

      const result = await saveVaultRecords(store, 'tasks', pageCopies);

      expect(pageCopies).toHaveLength(1);
      expect(pageCopies[0]).toMatchObject({ title: 'Legacy task' });
      expect(saveEncryptedDataMock).toHaveBeenCalledTimes(1);
      expect(saveEncryptedDataMock).toHaveBeenCalledWith({
        type: 'tasks',
        value: { records: [pageCopies[0]], deletions: {} },
        expectedCiphertext: STORED,
      });
      expect(result).toEqual(pageCopies);
    });

    test('a stored Subscription with no id is written once, under the id the page write-back holds', async () => {
      const stored = [
        {
          name: 'Streamer',
          startDate: CREATED_AT,
          status: 'active',
          updatedAt: EARLIER,
        },
      ];
      loadWithCiphertextMock.mockResolvedValue(holding(stored));
      const pageCopies = normalizeSubscriptions(stored).value;

      const result = await saveVaultRecords(store, 'subscriptions', pageCopies);

      expect(pageCopies).toHaveLength(1);
      expect(pageCopies[0]).toMatchObject({ name: 'Streamer' });
      expect(saveEncryptedDataMock).toHaveBeenCalledTimes(1);
      expect(saveEncryptedDataMock).toHaveBeenCalledWith({
        type: 'subscriptions',
        value: { records: [pageCopies[0]], deletions: {} },
        expectedCiphertext: STORED,
      });
      expect(result).toEqual(pageCopies);
    });

    test('a stale list saved over a stored legacy string adds no copy minted from it: the write is the id-bearing records only', async () => {
      const addressA = normalizeAddresses([
        {
          id: 'AD1',
          label: 'Home',
          address: '2 High St',
          createdAt: CREATED_AT,
          updatedAt: EARLIER,
        },
      ]).value[0];
      const addressB = normalizeAddresses([
        {
          id: 'AD2',
          label: 'Work',
          address: '3 Low Rd',
          createdAt: CREATED_AT,
          updatedAt: LATER,
        },
      ]).value[0];
      loadWithCiphertextMock.mockResolvedValue(
        holding({ records: ['1 Main St', addressA], deletions: {} }),
      );

      const result = await saveVaultRecords(store, 'addresses', [
        addressA,
        addressB,
      ]);

      expect(saveEncryptedDataMock).toHaveBeenCalledTimes(1);
      expect(saveEncryptedDataMock).toHaveBeenCalledWith({
        type: 'addresses',
        value: { records: [addressA, addressB], deletions: {} },
        expectedCiphertext: STORED,
      });
      expect(result).toEqual([addressA, addressB]);
    });

    test('a stored id-less entry the page never loaded is dropped, by decision (ADR 0143)', async () => {
      const addressA = normalizeAddresses([
        {
          id: 'AD1',
          label: 'Home',
          address: '2 High St',
          createdAt: CREATED_AT,
          updatedAt: EARLIER,
        },
      ]).value[0];
      const addressB = normalizeAddresses([
        {
          id: 'AD2',
          label: 'Work',
          address: '3 Low Rd',
          createdAt: CREATED_AT,
          updatedAt: LATER,
        },
      ]).value[0];
      loadWithCiphertextMock.mockResolvedValue(
        holding({ records: ['9 Unseen Rd', addressA], deletions: {} }),
      );

      const result = await saveVaultRecords(store, 'addresses', [
        addressA,
        addressB,
      ]);

      expect(saveEncryptedDataMock).toHaveBeenCalledTimes(1);
      expect(saveEncryptedDataMock).toHaveBeenCalledWith({
        type: 'addresses',
        value: { records: [addressA, addressB], deletions: {} },
        expectedCiphertext: STORED,
      });
      expect(result).toEqual([addressA, addressB]);
    });

    test('a stored null entry and an object whose id is a number are dropped, and each page record is written once', async () => {
      // A numeric id is not a usable id, but the address normalizer would mint
      // a fresh string id for it. Without the filter that copy would survive.
      const addressA = normalizeAddresses([
        {
          id: 'AD1',
          label: 'Home',
          address: '2 High St',
          createdAt: CREATED_AT,
          updatedAt: EARLIER,
        },
      ]).value[0];
      loadWithCiphertextMock.mockResolvedValue(
        holding({
          records: [null, { id: 42, label: 'x', address: 'y' }, addressA],
          deletions: {},
        }),
      );

      const result = await saveVaultRecords(store, 'addresses', [addressA]);

      expect(saveEncryptedDataMock).toHaveBeenCalledTimes(1);
      expect(saveEncryptedDataMock).toHaveBeenCalledWith({
        type: 'addresses',
        value: { records: [addressA], deletions: {} },
        expectedCiphertext: STORED,
      });
      expect(result).toEqual([addressA]);
    });

    test('stored records that are not an array are read as empty, and the page records are written', async () => {
      const taskA = validTask('T1', 'Mine', EARLIER);
      loadWithCiphertextMock.mockResolvedValue(
        holding({ records: 'garbage', deletions: {} }),
      );

      const result = await saveVaultRecords(store, 'tasks', [taskA]);

      expect(saveEncryptedDataMock).toHaveBeenCalledTimes(1);
      expect(saveEncryptedDataMock).toHaveBeenCalledWith({
        type: 'tasks',
        value: { records: [taskA], deletions: {} },
        expectedCiphertext: STORED,
      });
      expect(result).toEqual([taskA]);
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

    test('an uncontended first save writes the payload as composed, even when the stored lists are not in it (out of #1501 scope)', async () => {
      const payload: GroceriesVaultPayload = { catalog: [], lists: [] };
      loadWithCiphertextMock.mockResolvedValue(
        holding({
          records: { catalog: [], lists: [{ id: 'list-stored' }] },
          deletions: {},
        }),
      );

      await saveGroceriesPayload(store, payload);

      expect(saveEncryptedDataMock).toHaveBeenCalledTimes(1);
      expect(saveEncryptedDataMock).toHaveBeenCalledWith({
        type: 'groceries',
        value: { records: payload, deletions: {} },
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
      const pulledRecord = validTask('R', 'Pulled', '2026-01-01T11:00:00.000Z');
      const pulledNew = validTask(
        'P',
        'Added by pull',
        '2026-01-01T11:30:00.000Z',
      );
      const userEdit = validTask('E', 'User edit', '2026-01-01T12:00:00.000Z');
      const userRecords = [
        validTask('R', 'Before pull', '2026-01-01T10:00:00.000Z'),
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
                validTask('E', 'Old', '2026-01-01T09:00:00.000Z'),
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
      const otherRecord = validTask(
        'X',
        'Other tab',
        '2026-01-01T09:00:00.000Z',
      );
      const mine = validTask('M', 'Mine', '2026-01-01T10:00:00.000Z');
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
      const otherRecord = validTask(
        'X',
        'Other writer',
        '2026-01-01T09:00:00.000Z',
      );
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
      expect(written[0].value).toEqual({ records, deletions: {} });
    });

    test('deleteVaultRecordAndSave contended: resolves the merged records, records the deletion, and the deleted record stays absent even where the other writer still holds it', async () => {
      const deletedAt = '2026-01-01T12:00:00.000Z';
      const stillHeldElsewhere = validTask(
        't1',
        'Held by other writer',
        '2026-01-01T09:00:00.000Z',
      );
      const kept = validTask('t2', 'Kept', '2026-01-01T09:30:00.000Z');
      const addedByPull = validTask(
        't3',
        'Added by pull',
        '2026-01-01T11:00:00.000Z',
      );
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
