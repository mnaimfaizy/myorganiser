import type { Task } from '@myorganiser/vault-core';
import { createProductionTasksVaultAdapter } from './tasks-vault-adapter';
import {
  VaultWriteContendedError,
  type VaultHandle,
} from '@myorganiser/web-vault';

const FIXED_NOW = '2024-06-15T12:00:00.000Z';
const STORED_BLOB = { iv: 'iv-stored', ciphertext: 'ct-stored' };

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Test task',
    status: 'pending',
    priority: 'medium',
    archived: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('createProductionTasksVaultAdapter', () => {
  let mockHandle: Partial<VaultHandle>;

  beforeEach(() => {
    mockHandle = {
      loadDecryptedData: jest.fn(),
      loadDecryptedDataWithCiphertext: jest.fn(),
      saveEncryptedData: jest.fn(),
    };
  });

  describe('loadTasks', () => {
    it('loads tasks from vault handle with correct type', async () => {
      const task = makeTask({ id: 'task-1' });
      (mockHandle.loadDecryptedData as jest.Mock).mockResolvedValue([task]);

      const adapter = createProductionTasksVaultAdapter(
        mockHandle as VaultHandle,
      );
      const result = await adapter.loadTasks();

      expect(mockHandle.loadDecryptedData).toHaveBeenCalledWith({
        type: 'tasks',
        defaultValue: null,
      });
      expect(result).toEqual([task]);
    });

    it('returns null when no data is stored', async () => {
      (mockHandle.loadDecryptedData as jest.Mock).mockResolvedValue(null);

      const adapter = createProductionTasksVaultAdapter(
        mockHandle as VaultHandle,
      );
      const result = await adapter.loadTasks();

      expect(result).toBeNull();
    });
  });

  describe('saveTasks', () => {
    it('saves tasks merged with the stored tasks, keeping the deletion log', async () => {
      const task = makeTask({ id: 'task-1' });
      const storedEnvelope = {
        records: [task],
        deletions: { removed: '2024-01-01T00:00:00.000Z' },
      };
      (
        mockHandle.loadDecryptedDataWithCiphertext as jest.Mock
      ).mockResolvedValue({ value: storedEnvelope, ciphertext: STORED_BLOB });
      (mockHandle.saveEncryptedData as jest.Mock).mockResolvedValue(undefined);

      const adapter = createProductionTasksVaultAdapter(
        mockHandle as VaultHandle,
      );
      const newTask = makeTask({ id: 'task-2', title: 'New task' });
      const written = await adapter.saveTasks([newTask]);

      // The stored task is kept beside the saved one: the save merges, it does not replace.
      expect(written).toEqual([task, newTask]);
      expect(mockHandle.saveEncryptedData).toHaveBeenCalledWith({
        type: 'tasks',
        expectedCiphertext: STORED_BLOB,
        value: {
          records: [task, newTask],
          deletions: { removed: '2024-01-01T00:00:00.000Z' },
        },
      });
    });

    it('saveTasks from a stale list keeps a task another tab stored', async () => {
      // Another tab stored task-a after this list was read, so the list saved here does not hold it.
      const stored = makeTask({
        id: 'task-a',
        title: 'Added on another tab',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-03-01T00:00:00.000Z',
      });
      const mine = makeTask({ id: 'task-b', title: 'Saved from stale list' });
      (
        mockHandle.loadDecryptedDataWithCiphertext as jest.Mock
      ).mockResolvedValue({
        value: { records: [stored], deletions: {} },
        ciphertext: STORED_BLOB,
      });
      (mockHandle.saveEncryptedData as jest.Mock).mockResolvedValue(undefined);

      const adapter = createProductionTasksVaultAdapter(
        mockHandle as VaultHandle,
      );
      const written = await adapter.saveTasks([mine]);

      expect(mockHandle.saveEncryptedData).toHaveBeenCalledTimes(1);
      expect(mockHandle.saveEncryptedData).toHaveBeenCalledWith({
        type: 'tasks',
        expectedCiphertext: STORED_BLOB,
        value: { records: [stored, mine], deletions: {} },
      });
      expect(written).toEqual([stored, mine]);
    });
  });

  describe('saveTasks after a contended write', () => {
    it('resolves with the merged tasks, including one another writer stored meanwhile', async () => {
      const mine = makeTask({ id: 'task-2', title: 'New task' });
      const theirs = makeTask({ id: 'task-3', title: 'Added elsewhere' });
      (
        mockHandle.loadDecryptedDataWithCiphertext as jest.Mock
      ).mockResolvedValue({
        value: { records: [theirs], deletions: {} },
        ciphertext: STORED_BLOB,
      });
      let saveCalls = 0;
      (mockHandle.saveEncryptedData as jest.Mock).mockImplementation(
        async () => {
          saveCalls += 1;
          if (saveCalls === 1) throw new VaultWriteContendedError('tasks');
        },
      );

      const adapter = createProductionTasksVaultAdapter(
        mockHandle as VaultHandle,
      );
      const written = await adapter.saveTasks([mine]);

      expect(written.map((task) => task.id).sort()).toEqual([
        'task-2',
        'task-3',
      ]);
      expect(mockHandle.saveEncryptedData).toHaveBeenCalledTimes(2);
      expect(mockHandle.saveEncryptedData).toHaveBeenLastCalledWith(
        expect.objectContaining({ expectedCiphertext: STORED_BLOB }),
      );
    });
  });

  describe('deleteTask', () => {
    it('removes task and records deletion, preserving existing log', async () => {
      const keep = makeTask({ id: 'keep' });
      const remove = makeTask({ id: 'remove' });
      const storedEnvelope = {
        records: [keep, remove],
        deletions: { old: '2024-01-01T00:00:00.000Z' },
      };
      (
        mockHandle.loadDecryptedDataWithCiphertext as jest.Mock
      ).mockResolvedValue({ value: storedEnvelope, ciphertext: STORED_BLOB });
      (mockHandle.saveEncryptedData as jest.Mock).mockResolvedValue(undefined);

      const adapter = createProductionTasksVaultAdapter(
        mockHandle as VaultHandle,
      );
      const result = await adapter.deleteTask(
        [keep, remove],
        'remove',
        FIXED_NOW,
      );

      expect(result).toEqual([keep]);
      expect(mockHandle.saveEncryptedData).toHaveBeenCalledWith({
        type: 'tasks',
        expectedCiphertext: STORED_BLOB,
        value: {
          records: [keep],
          deletions: {
            old: '2024-01-01T00:00:00.000Z',
            remove: FIXED_NOW,
          },
        },
      });
    });

    it('creates new deletion log entry when none exists', async () => {
      const keep = makeTask({ id: 'keep' });
      const remove = makeTask({ id: 'remove' });
      const storedEnvelope = {
        records: [keep, remove],
        deletions: {},
      };
      (
        mockHandle.loadDecryptedDataWithCiphertext as jest.Mock
      ).mockResolvedValue({ value: storedEnvelope, ciphertext: STORED_BLOB });
      (mockHandle.saveEncryptedData as jest.Mock).mockResolvedValue(undefined);

      const adapter = createProductionTasksVaultAdapter(
        mockHandle as VaultHandle,
      );
      const result = await adapter.deleteTask(
        [keep, remove],
        'remove',
        FIXED_NOW,
      );

      expect(result).toEqual([keep]);
      expect(mockHandle.saveEncryptedData).toHaveBeenCalledWith({
        type: 'tasks',
        expectedCiphertext: STORED_BLOB,
        value: {
          records: [keep],
          deletions: {
            remove: FIXED_NOW,
          },
        },
      });
    });
  });
});
