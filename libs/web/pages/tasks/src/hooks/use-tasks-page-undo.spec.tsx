/**
 * Tests for Undo on the Tasks page, against the real workflow.
 *
 * Focus: an Undo pressed while a write is in flight waits on the workflow's
 * write queue, then restores the Task, so the Vault ends with both the change
 * that was in flight and the undo. `../workflow` is not mocked here; the
 * use-tasks-page.spec.tsx suite covers the page with the workflow mocked.
 *
 * The Vault Handle is an in-memory fake that stores records as plain objects.
 * It does no crypto: this suite is about write ordering, not the Ciphertext.
 */

/* eslint-disable import/first -- jest.mock must precede application imports */
const mockToast = jest.fn();

jest.mock('@myorganiser/web-ui', () => ({
  useToast: () => ({ toast: mockToast }),
  ToastAction: () => null,
}));

import type { Task } from '@myorganiser/vault-core';
import type { VaultHandle } from '@myorganiser/web-vault';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useTasksPage } from './use-tasks-page';

const TASK: Task = {
  id: 'task-1',
  title: 'Draft report',
  description: 'Q4 numbers',
  status: 'in_progress',
  priority: 'high',
  context: 'work',
  dueDate: '2026-10-30',
  estimatedMinutes: 45,
  archived: false,
  createdAt: '2026-10-01T00:00:00.000Z',
};

interface FakeVault {
  handle: VaultHandle;
  saves: jest.Mock;
  /** The Task records the Vault currently holds. */
  storedTasks(): Task[];
  /** Holds the next save until the returned function is called. */
  holdNextSave(): () => void;
}

function createFakeVault(initialTasks: Task[]): FakeVault {
  const records = new Map<string, unknown>([
    ['tasks', { records: initialTasks, deletions: {} }],
  ]);
  let gate: Promise<void> | null = null;

  const loadDecryptedData = jest.fn(
    async ({ type, defaultValue }: { type: string; defaultValue: unknown }) =>
      records.has(type) ? records.get(type) : defaultValue,
  );
  const saveEncryptedData = jest.fn(
    async ({ type, value }: { type: string; value: unknown }) => {
      const wait = gate;
      gate = null;
      if (wait) await wait;
      records.set(type, value);
    },
  );

  return {
    handle: { loadDecryptedData, saveEncryptedData } as unknown as VaultHandle,
    saves: saveEncryptedData,
    storedTasks: () => (records.get('tasks') as { records: Task[] }).records,
    holdNextSave() {
      let release!: () => void;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
}

/** The Undo action on the most recent "Task done" toast. */
function undoFromDoneToast(): () => Promise<void> {
  const call = mockToast.mock.calls.find(
    ([args]) => args.title === 'Task done',
  );
  if (!call) throw new Error('no "Task done" toast was shown');
  const action = call[0].action as {
    props: { onClick: () => Promise<void> };
  };
  return action.props.onClick;
}

describe('useTasksPage Undo against the real workflow', () => {
  beforeEach(() => {
    mockToast.mockReset();
  });

  it('an Undo pressed while a write is in flight waits for it, then restores the task, and the Vault keeps both changes', async () => {
    const vault = createFakeVault([TASK]);
    const { result } = renderHook(() => useTasksPage(vault.handle));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.toggleDone(TASK, true);
    });
    expect(vault.storedTasks()[0].status).toBe('done');
    const undo = undoFromDoneToast();
    const savesBeforeEdit = vault.saves.mock.calls.length;

    // An edit that the Vault holds open, so it is in flight when Undo fires.
    const releaseEdit = vault.holdNextSave();
    let edit!: Promise<boolean>;
    await act(async () => {
      edit = result.current.updateFields(TASK, { description: 'changed' });
    });
    await waitFor(() =>
      expect(vault.saves).toHaveBeenCalledTimes(savesBeforeEdit + 1),
    );

    let undoing!: Promise<void>;
    await act(async () => {
      undoing = undo();
    });
    // Undo has not written while the edit is still held.
    expect(vault.saves).toHaveBeenCalledTimes(savesBeforeEdit + 1);

    await act(async () => {
      releaseEdit();
      await edit;
    });
    await act(async () => {
      await undoing;
    });

    await expect(edit).resolves.toBe(true);
    expect(vault.saves).toHaveBeenCalledTimes(savesBeforeEdit + 2);
    expect(vault.storedTasks()).toEqual([
      expect.objectContaining({
        id: 'task-1',
        status: 'in_progress',
        description: 'changed',
      }),
    ]);
    expect(result.current.tasks[0]).toMatchObject({
      status: 'in_progress',
      description: 'changed',
    });
  });
});
