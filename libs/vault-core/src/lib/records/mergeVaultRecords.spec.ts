import {
  hasMergeableId,
  mergeRecordsById,
  type IdentifiedRecord,
} from './mergeVaultRecords';
import type { VaultBlobEnvelope } from './vaultBlobEnvelope';

interface TestRecord extends IdentifiedRecord {
  at?: string;
}

describe('mergeRecordsById', () => {
  const changedAt = (record: TestRecord) => record.at;

  describe('unknown fields', () => {
    it('unions unknown envelope fields from both sides and keeps local on a shared key', () => {
      const local = {
        records: [],
        deletions: {},
        sharedKey: 'local',
        localOnly: 1,
      } as VaultBlobEnvelope<TestRecord[]>;
      const remote = {
        records: [],
        deletions: {},
        sharedKey: 'remote',
        remoteOnly: 2,
      } as VaultBlobEnvelope<TestRecord[]>;

      const result = mergeRecordsById(local, remote, changedAt);

      expect(result).toMatchObject({
        sharedKey: 'local',
        localOnly: 1,
        remoteOnly: 2,
      });
    });

    it('keeps the unknown fields of a newer remote record that wins whole', () => {
      const local: VaultBlobEnvelope<TestRecord[]> = {
        records: [{ id: '1', at: '2026-01-01T00:00:00.000Z' }],
        deletions: {},
      };
      const remote: VaultBlobEnvelope<TestRecord[]> = {
        records: [
          {
            id: '1',
            at: '2026-01-02T00:00:00.000Z',
            futureField: 'remote',
          } as TestRecord,
        ],
        deletions: {},
      };

      const result = mergeRecordsById(local, remote, changedAt);

      expect(result.records).toEqual([
        { id: '1', at: '2026-01-02T00:00:00.000Z', futureField: 'remote' },
      ]);
    });

    it('keeps the local record and its unknown fields when changedAt ties', () => {
      const local: VaultBlobEnvelope<TestRecord[]> = {
        records: [
          {
            id: '1',
            at: '2026-01-01T00:00:00.000Z',
            futureField: 'local',
          } as TestRecord,
        ],
        deletions: {},
      };
      const remote: VaultBlobEnvelope<TestRecord[]> = {
        records: [
          {
            id: '1',
            at: '2026-01-01T00:00:00.000Z',
            futureField: 'remote',
          } as TestRecord,
        ],
        deletions: {},
      };

      const result = mergeRecordsById(local, remote, changedAt);

      expect(result.records).toEqual([
        { id: '1', at: '2026-01-01T00:00:00.000Z', futureField: 'local' },
      ]);
    });
  });

  describe('union by id', () => {
    it('keeps a record only in local', () => {
      const local: VaultBlobEnvelope<TestRecord[]> = {
        records: [{ id: '1', at: '2026-01-01T00:00:00.000Z' }],
        deletions: {},
      };
      const remote: VaultBlobEnvelope<TestRecord[]> = {
        records: [],
        deletions: {},
      };
      const result = mergeRecordsById(local, remote, changedAt);
      expect(result.records).toEqual([
        { id: '1', at: '2026-01-01T00:00:00.000Z' },
      ]);
    });

    it('keeps a record only in remote', () => {
      const local: VaultBlobEnvelope<TestRecord[]> = {
        records: [],
        deletions: {},
      };
      const remote: VaultBlobEnvelope<TestRecord[]> = {
        records: [{ id: '1', at: '2026-01-01T00:00:00.000Z' }],
        deletions: {},
      };
      const result = mergeRecordsById(local, remote, changedAt);
      expect(result.records).toEqual([
        { id: '1', at: '2026-01-01T00:00:00.000Z' },
      ]);
    });

    it('keeps both when they have different ids', () => {
      const local: VaultBlobEnvelope<TestRecord[]> = {
        records: [{ id: '1', at: '2026-01-01T00:00:00.000Z' }],
        deletions: {},
      };
      const remote: VaultBlobEnvelope<TestRecord[]> = {
        records: [{ id: '2', at: '2026-01-02T00:00:00.000Z' }],
        deletions: {},
      };
      const result = mergeRecordsById(local, remote, changedAt);
      expect(result.records).toHaveLength(2);
      expect(result.records[0]).toEqual({
        id: '1',
        at: '2026-01-01T00:00:00.000Z',
      });
      expect(result.records[1]).toEqual({
        id: '2',
        at: '2026-01-02T00:00:00.000Z',
      });
    });
  });

  describe('timestamp-based collision resolution', () => {
    it('keeps remote when remote is newer', () => {
      const local: VaultBlobEnvelope<TestRecord[]> = {
        records: [{ id: '1', at: '2026-01-01T00:00:00.000Z' }],
        deletions: {},
      };
      const remote: VaultBlobEnvelope<TestRecord[]> = {
        records: [{ id: '1', at: '2026-01-02T00:00:00.000Z' }],
        deletions: {},
      };
      const result = mergeRecordsById(local, remote, changedAt);
      expect(result.records).toEqual([
        { id: '1', at: '2026-01-02T00:00:00.000Z' },
      ]);
    });

    it('keeps local when local is newer', () => {
      const local: VaultBlobEnvelope<TestRecord[]> = {
        records: [{ id: '1', at: '2026-01-02T00:00:00.000Z' }],
        deletions: {},
      };
      const remote: VaultBlobEnvelope<TestRecord[]> = {
        records: [{ id: '1', at: '2026-01-01T00:00:00.000Z' }],
        deletions: {},
      };
      const result = mergeRecordsById(local, remote, changedAt);
      expect(result.records).toEqual([
        { id: '1', at: '2026-01-02T00:00:00.000Z' },
      ]);
    });

    it('keeps local when timestamps are identical (tie)', () => {
      const localRecord = { id: '1', at: '2026-01-01T00:00:00.000Z' };
      const remoteRecord = { id: '1', at: '2026-01-01T00:00:00.000Z' };
      const local: VaultBlobEnvelope<TestRecord[]> = {
        records: [localRecord],
        deletions: {},
      };
      const remote: VaultBlobEnvelope<TestRecord[]> = {
        records: [remoteRecord],
        deletions: {},
      };
      const result = mergeRecordsById(local, remote, changedAt);
      expect(result.records).toEqual([localRecord]);
    });
  });

  describe('deletion log precedence', () => {
    it('buries a record whose at is before deletion', () => {
      const local: VaultBlobEnvelope<TestRecord[]> = {
        records: [{ id: '1', at: '2026-01-01T00:00:00.000Z' }],
        deletions: { '1': '2026-01-02T00:00:00.000Z' },
      };
      const remote: VaultBlobEnvelope<TestRecord[]> = {
        records: [],
        deletions: {},
      };
      const result = mergeRecordsById(local, remote, changedAt);
      expect(result.records).toEqual([]);
    });

    it('buries from deletion in remote', () => {
      const local: VaultBlobEnvelope<TestRecord[]> = {
        records: [{ id: '1', at: '2026-01-01T00:00:00.000Z' }],
        deletions: {},
      };
      const remote: VaultBlobEnvelope<TestRecord[]> = {
        records: [],
        deletions: { '1': '2026-01-02T00:00:00.000Z' },
      };
      const result = mergeRecordsById(local, remote, changedAt);
      expect(result.records).toEqual([]);
    });

    it('keeps record when edited after deletion', () => {
      const local: VaultBlobEnvelope<TestRecord[]> = {
        records: [{ id: '1', at: '2026-01-03T00:00:00.000Z' }],
        deletions: { '1': '2026-01-02T00:00:00.000Z' },
      };
      const remote: VaultBlobEnvelope<TestRecord[]> = {
        records: [],
        deletions: {},
      };
      const result = mergeRecordsById(local, remote, changedAt);
      expect(result.records).toEqual([
        { id: '1', at: '2026-01-03T00:00:00.000Z' },
      ]);
    });

    it('buries record when at equals deletion time (tie resolves toward deletion)', () => {
      const local: VaultBlobEnvelope<TestRecord[]> = {
        records: [{ id: '1', at: '2026-01-02T00:00:00.000Z' }],
        deletions: { '1': '2026-01-02T00:00:00.000Z' },
      };
      const remote: VaultBlobEnvelope<TestRecord[]> = {
        records: [],
        deletions: {},
      };
      const result = mergeRecordsById(local, remote, changedAt);
      expect(result.records).toEqual([]);
    });
  });

  describe('records without timestamps', () => {
    it('buries a record with no at when id is in deletion log', () => {
      const local: VaultBlobEnvelope<TestRecord[]> = {
        records: [{ id: '1' }],
        deletions: { '1': '2026-01-01T00:00:00.000Z' },
      };
      const remote: VaultBlobEnvelope<TestRecord[]> = {
        records: [],
        deletions: {},
      };
      const result = mergeRecordsById(local, remote, changedAt);
      expect(result.records).toEqual([]);
    });

    it('keeps record without at when id is not deleted', () => {
      const local: VaultBlobEnvelope<TestRecord[]> = {
        records: [{ id: '1' }],
        deletions: {},
      };
      const remote: VaultBlobEnvelope<TestRecord[]> = {
        records: [],
        deletions: {},
      };
      const result = mergeRecordsById(local, remote, changedAt);
      expect(result.records).toEqual([{ id: '1' }]);
    });
  });

  describe('deletion log in result', () => {
    it('includes deletions from both sides', () => {
      const local: VaultBlobEnvelope<TestRecord[]> = {
        records: [{ id: '1' }],
        deletions: { a: '2026-01-01T00:00:00.000Z' },
      };
      const remote: VaultBlobEnvelope<TestRecord[]> = {
        records: [{ id: '2' }],
        deletions: { b: '2026-01-02T00:00:00.000Z' },
      };
      const result = mergeRecordsById(local, remote, changedAt);
      expect(result.deletions).toEqual({
        a: '2026-01-01T00:00:00.000Z',
        b: '2026-01-02T00:00:00.000Z',
      });
    });

    it('keeps deletion for ids that survive', () => {
      const local: VaultBlobEnvelope<TestRecord[]> = {
        records: [{ id: '1', at: '2026-01-03T00:00:00.000Z' }],
        deletions: { '1': '2026-01-02T00:00:00.000Z' },
      };
      const remote: VaultBlobEnvelope<TestRecord[]> = {
        records: [],
        deletions: {},
      };
      const result = mergeRecordsById(local, remote, changedAt);
      expect(result.deletions).toEqual({ '1': '2026-01-02T00:00:00.000Z' });
    });

    it('keeps deletion for ids with no record', () => {
      const local: VaultBlobEnvelope<TestRecord[]> = {
        records: [],
        deletions: { orphan: '2026-01-01T00:00:00.000Z' },
      };
      const remote: VaultBlobEnvelope<TestRecord[]> = {
        records: [],
        deletions: {},
      };
      const result = mergeRecordsById(local, remote, changedAt);
      expect(result.deletions).toEqual({ orphan: '2026-01-01T00:00:00.000Z' });
    });
  });

  describe('input validation', () => {
    it('skips records with missing id', () => {
      const local: VaultBlobEnvelope<TestRecord[]> = {
        records: [{ id: '' } as TestRecord, { id: '1' }],
        deletions: {},
      };
      const remote: VaultBlobEnvelope<TestRecord[]> = {
        records: [],
        deletions: {},
      };
      const result = mergeRecordsById(local, remote, changedAt);
      expect(result.records).toEqual([{ id: '1' }]);
    });

    it('skips non-object entries', () => {
      const local = {
        records: [null, 'string', 123, { id: '1' }],
        deletions: {},
      };
      const remote: VaultBlobEnvelope<TestRecord[]> = {
        records: [],
        deletions: {},
      };
      const result = mergeRecordsById(
        local as unknown as VaultBlobEnvelope<TestRecord[]>,
        remote,
        changedAt,
      );
      expect(result.records).toEqual([{ id: '1' }]);
    });

    it('skips array entries', () => {
      const local = {
        records: [[], { id: '1' }],
        deletions: {},
      };
      const remote: VaultBlobEnvelope<TestRecord[]> = {
        records: [],
        deletions: {},
      };
      const result = mergeRecordsById(
        local as unknown as VaultBlobEnvelope<TestRecord[]>,
        remote,
        changedAt,
      );
      expect(result.records).toEqual([{ id: '1' }]);
    });

    it('handles non-array records as empty array', () => {
      const local = {
        records: 'not an array',
        deletions: {},
      };
      const remote: VaultBlobEnvelope<TestRecord[]> = {
        records: [{ id: '1' }],
        deletions: {},
      };
      const result = mergeRecordsById(
        local as unknown as VaultBlobEnvelope<TestRecord[]>,
        remote,
        changedAt,
      );
      expect(result.records).toEqual([{ id: '1' }]);
    });
  });

  describe('idempotence', () => {
    it('merging a blob with itself returns the same records', () => {
      const envelope: VaultBlobEnvelope<TestRecord[]> = {
        records: [{ id: '1', at: '2026-01-01T00:00:00.000Z' }],
        deletions: { a: '2026-01-02T00:00:00.000Z' },
      };
      const result = mergeRecordsById(envelope, envelope, changedAt);
      expect(result.records).toEqual(envelope.records);
      expect(result.deletions).toEqual(envelope.deletions);
    });
  });

  describe('order preservation', () => {
    it('maintains local order first, then remote order', () => {
      const local: VaultBlobEnvelope<TestRecord[]> = {
        records: [{ id: '1' }, { id: '2' }],
        deletions: {},
      };
      const remote: VaultBlobEnvelope<TestRecord[]> = {
        records: [{ id: '3' }, { id: '4' }],
        deletions: {},
      };
      const result = mergeRecordsById(local, remote, changedAt);
      expect(result.records.map((r) => r.id)).toEqual(['1', '2', '3', '4']);
    });

    it('replaces record in place when id exists in both', () => {
      const local: VaultBlobEnvelope<TestRecord[]> = {
        records: [
          { id: '1', at: '2026-01-01T00:00:00.000Z' },
          { id: '2', at: '2026-01-01T00:00:00.000Z' },
        ],
        deletions: {},
      };
      const remote: VaultBlobEnvelope<TestRecord[]> = {
        records: [{ id: '1', at: '2026-01-02T00:00:00.000Z' }],
        deletions: {},
      };
      const result = mergeRecordsById(local, remote, changedAt);
      expect(result.records.map((r) => r.id)).toEqual(['1', '2']);
      expect(result.records[0]).toEqual({
        id: '1',
        at: '2026-01-02T00:00:00.000Z',
      });
    });
  });
});

describe('hasMergeableId', () => {
  test.each([
    {
      name: 'an object with a non-empty string id',
      entry: { id: 'a' },
      expected: true,
    },
    { name: 'null', entry: null, expected: false },
    { name: 'a string', entry: 'a', expected: false },
    {
      name: 'an object with no id',
      entry: { title: 'no id' },
      expected: false,
    },
    { name: 'an object with an empty id', entry: { id: '' }, expected: false },
    { name: 'an object with a numeric id', entry: { id: 1 }, expected: false },
  ])('is $expected for $name', ({ entry, expected }) => {
    expect(hasMergeableId(entry)).toBe(expected);
  });
});
