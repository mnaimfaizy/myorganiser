/**
 * Tests for useTasksPage.
 *
 * Focus: the page behaviour above useTasksWorkflow — every mutation's
 * collaborator call, the toast wording reported for each outcome, the Undo
 * action on a completed Task, and the in-flight gate that serialises writes.
 * The workflow itself is mocked at the `../workflow` boundary.
 */

/* eslint-disable import/first -- jest.mock must precede application imports */
const mockToast = jest.fn();
const mockUseTasksWorkflow = jest.fn();

jest.mock('@myorganiser/web-ui', () => ({
  useToast: () => ({ toast: mockToast }),
  ToastAction: () => null,
}));

jest.mock('../workflow', () => ({
  useTasksWorkflow: (options: unknown) => mockUseTasksWorkflow(options),
}));

import type { Task } from '@myorganiser/vault-core';
import type { VaultHandle } from '@myorganiser/web-vault';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { TaskFormInput } from '../workflow';
import { useTasksPage } from './use-tasks-page';

type MutationResult =
  | { ok: true; kind: string }
  | { ok: false; error: { code: 'save_failed'; message: string } };

type Page = ReturnType<typeof useTasksPage>;

const OK: MutationResult = { ok: true, kind: 'updated' };
const SAVE_FAILED: MutationResult = {
  ok: false,
  error: { code: 'save_failed', message: 'disk full' },
};

const SAVE_FAILED_TOAST = {
  title: 'Failed to save',
  description: 'disk full',
  variant: 'destructive',
};

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

function makeWorkflow(
  tasks: Task[],
  overrides: Partial<{
    loadError: { code: 'load_failed'; message: string };
  }> = {},
) {
  return {
    tasks,
    loading: false,
    loadError: null,
    ...overrides,
    addTask: jest.fn().mockResolvedValue({ ok: true, kind: 'created' }),
    updateTask: jest.fn().mockResolvedValue(OK),
    deleteTask: jest.fn().mockResolvedValue({ ok: true, kind: 'deleted' }),
    archiveTask: jest.fn().mockResolvedValue({ ok: true, kind: 'archived' }),
    unarchiveTask: jest
      .fn()
      .mockResolvedValue({ ok: true, kind: 'unarchived' }),
  };
}

type Workflow = ReturnType<typeof makeWorkflow>;

const handle = {} as VaultHandle;

function renderTasksPage() {
  return renderHook(() => useTasksPage(handle));
}

const ARCHIVE_FAMILY_ACTIONS: Array<{
  label: string;
  mockName: 'archiveTask' | 'unarchiveTask' | 'deleteTask';
  run: (page: Page) => Promise<boolean>;
}> = [
  {
    label: 'archive',
    mockName: 'archiveTask',
    run: (page) => page.archive('task-1'),
  },
  {
    label: 'unarchive',
    mockName: 'unarchiveTask',
    run: (page) => page.unarchive('task-1'),
  },
  {
    label: 'delete',
    mockName: 'deleteTask',
    run: (page) => page.deleteTask('task-1'),
  },
];

describe('useTasksPage', () => {
  let workflow: Workflow;

  beforeEach(() => {
    // Pin only the clock. Every other fakeable API stays real so waitFor and
    // React scheduling are unaffected. localDateKey reads only `new Date()`.
    jest.useFakeTimers({
      now: new Date(2026, 9, 21, 12, 0),
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
    mockToast.mockReset();
    mockUseTasksWorkflow.mockReset();
    workflow = makeWorkflow([TASK]);
    mockUseTasksWorkflow.mockReturnValue(workflow);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports a load failure with the fixed destructive toast wording', async () => {
    workflow = makeWorkflow([], {
      loadError: { code: 'load_failed', message: 'stale ciphertext detail' },
    });
    mockUseTasksWorkflow.mockReturnValue(workflow);

    renderTasksPage();

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Failed to load tasks',
        description: 'Could not decrypt saved data.',
        variant: 'destructive',
      });
    });
  });

  it('adds a task through the workflow and confirms with a toast', async () => {
    const { result } = renderTasksPage();
    const values: TaskFormInput = {
      title: 'Call the bank',
      priority: 'medium',
      status: 'pending',
    };

    await act(async () => {
      await result.current.addTask(values);
    });

    expect(workflow.addTask).toHaveBeenCalledWith(values);
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Task created',
      description: 'Your task has been saved (encrypted).',
    });
  });

  it('reports a failed add with the workflow message and rejects', async () => {
    workflow.addTask.mockResolvedValue(SAVE_FAILED);
    const { result } = renderTasksPage();

    await act(async () => {
      await expect(
        result.current.addTask({
          title: 'Call the bank',
          priority: 'medium',
          status: 'pending',
        }),
      ).rejects.toThrow('disk full');
    });

    expect(mockToast).toHaveBeenCalledWith(SAVE_FAILED_TOAST);
  });

  it('quick-adds a high-priority task due today and resolves true', async () => {
    const { result } = renderTasksPage();
    let added: boolean | undefined;

    await act(async () => {
      added = await result.current.quickAdd({
        title: 'Pay rent',
        dueToday: true,
        high: true,
      });
    });

    expect(added).toBe(true);
    expect(workflow.addTask).toHaveBeenCalledWith({
      title: 'Pay rent',
      status: 'pending',
      priority: 'high',
      dueDate: '2026-10-21',
      context: undefined,
    });
  });

  it('quick-adds a medium-priority task with no due date when neither flag is set', async () => {
    const { result } = renderTasksPage();

    await act(async () => {
      await result.current.quickAdd({
        title: 'Water plants',
        dueToday: false,
        high: false,
      });
    });

    const input = workflow.addTask.mock.calls[0][0] as TaskFormInput;
    expect(input.title).toBe('Water plants');
    expect(input.priority).toBe('medium');
    expect(input.dueDate).toBeUndefined();
  });

  it('captures a personal task with its chosen due date', async () => {
    const { result } = renderTasksPage();
    let saved: boolean | undefined;

    await act(async () => {
      saved = await result.current.capture({
        title: 'Call dentist',
        dueDate: '2026-10-24',
        high: false,
        personal: true,
      });
    });

    expect(saved).toBe(true);
    expect(workflow.addTask).toHaveBeenCalledWith({
      title: 'Call dentist',
      priority: 'medium',
      status: 'pending',
      context: 'personal',
      dueDate: '2026-10-24',
    });
  });

  it('resolves false from capture when the save fails', async () => {
    workflow.addTask.mockResolvedValue(SAVE_FAILED);
    const { result } = renderTasksPage();
    let saved: boolean | undefined;

    await act(async () => {
      saved = await result.current.capture({
        title: 'Call dentist',
        high: false,
        personal: false,
      });
    });

    expect(saved).toBe(false);
    expect(mockToast).toHaveBeenCalledWith(SAVE_FAILED_TOAST);
  });

  it('marks a task done with every field carried over and offers Undo', async () => {
    const { result } = renderTasksPage();
    let done: boolean | undefined;

    await act(async () => {
      done = await result.current.toggleDone(TASK, true);
    });

    expect(done).toBe(true);
    expect(workflow.updateTask).toHaveBeenCalledWith('task-1', {
      title: 'Draft report',
      description: 'Q4 numbers',
      priority: 'high',
      status: 'done',
      context: 'work',
      dueDate: '2026-10-30',
      estimatedMinutes: 45,
    });
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Task done',
      action: expect.objectContaining({
        props: expect.objectContaining({
          altText: 'Undo',
          children: 'Undo',
        }),
      }),
    });
  });

  it('resolves false from toggleDone when the save fails, with no Task done toast', async () => {
    workflow.updateTask.mockResolvedValue(SAVE_FAILED);
    const { result } = renderTasksPage();
    let done: boolean | undefined;

    await act(async () => {
      done = await result.current.toggleDone(TASK, true);
    });

    expect(done).toBe(false);
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(SAVE_FAILED_TOAST);
  });

  it('restores the previous status when the Undo action is invoked', async () => {
    const { result } = renderTasksPage();

    await act(async () => {
      await result.current.toggleDone(TASK, true);
    });

    const toastArgs = mockToast.mock.calls[0][0] as {
      action: { props: { onClick: () => Promise<void> } };
    };
    await act(async () => {
      await toastArgs.action.props.onClick();
    });

    expect(workflow.updateTask).toHaveBeenCalledTimes(2);
    expect(workflow.updateTask).toHaveBeenNthCalledWith(
      2,
      'task-1',
      expect.objectContaining({
        title: 'Draft report',
        status: 'in_progress',
      }),
    );
  });

  it('reopens a task without a success toast', async () => {
    const { result } = renderTasksPage();
    let reopened: boolean | undefined;

    await act(async () => {
      reopened = await result.current.toggleDone(TASK, false);
    });

    expect(reopened).toBe(true);
    expect(workflow.updateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ status: 'pending' }),
    );
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('clears one field while keeping the others and stays silent on success', async () => {
    const { result } = renderTasksPage();
    let saved: boolean | undefined;

    await act(async () => {
      saved = await result.current.updateFields(TASK, { context: undefined });
    });

    expect(saved).toBe(true);
    const [taskId, input] = workflow.updateTask.mock.calls[0];
    expect(taskId).toBe('task-1');
    expect(input.context).toBeUndefined();
    expect(input).toMatchObject({
      title: 'Draft report',
      description: 'Q4 numbers',
      priority: 'high',
      status: 'in_progress',
      dueDate: '2026-10-30',
      estimatedMinutes: 45,
    });
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('resolves false and reports the failure when a field update fails', async () => {
    workflow.updateTask.mockResolvedValue(SAVE_FAILED);
    const { result } = renderTasksPage();
    let saved: boolean | undefined;

    await act(async () => {
      saved = await result.current.updateFields(TASK, { title: 'Renamed' });
    });

    expect(saved).toBe(false);
    expect(mockToast).toHaveBeenCalledWith(SAVE_FAILED_TOAST);
  });

  it('archives, restores, and deletes with the matching confirmations', async () => {
    const { result } = renderTasksPage();

    await act(async () => {
      await result.current.archive('task-1');
    });
    expect(workflow.archiveTask).toHaveBeenCalledWith('task-1');
    expect(mockToast).toHaveBeenNthCalledWith(1, {
      title: 'Task archived',
      description: 'Task moved to archive.',
    });

    await act(async () => {
      await result.current.unarchive('task-1');
    });
    expect(workflow.unarchiveTask).toHaveBeenCalledWith('task-1');
    expect(mockToast).toHaveBeenNthCalledWith(2, {
      title: 'Task restored',
      description: 'Task moved back to active.',
    });

    await act(async () => {
      await result.current.deleteTask('task-1');
    });
    expect(workflow.deleteTask).toHaveBeenCalledWith('task-1');
    expect(mockToast).toHaveBeenNthCalledWith(3, {
      title: 'Task deleted',
      description: 'Your task has been deleted.',
    });
  });

  it.each(ARCHIVE_FAMILY_ACTIONS)(
    '$label reports a save failure, resolves false, and shows no success toast',
    async ({ mockName, run }) => {
      workflow[mockName].mockResolvedValue(SAVE_FAILED);
      const { result } = renderTasksPage();
      let ok: boolean | undefined;

      await act(async () => {
        ok = await run(result.current);
      });

      expect(ok).toBe(false);
      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith(SAVE_FAILED_TOAST);
    },
  );

  it('refuses archive and add while a write is in flight, then accepts writes again', async () => {
    let releaseUpdate: (result: MutationResult) => void = () => undefined;
    workflow.updateTask.mockImplementation(
      () =>
        new Promise<MutationResult>((resolve) => {
          releaseUpdate = resolve;
        }),
    );
    const { result } = renderTasksPage();
    let firstWrite: Promise<boolean> | undefined;

    await act(async () => {
      firstWrite = result.current.updateFields(TASK, { title: 'Renamed' });
    });
    await waitFor(() => expect(result.current.busy).toBe(true));

    let blocked: boolean | undefined;
    await act(async () => {
      blocked = await result.current.archive('task-1');
    });
    expect(blocked).toBe(false);

    await act(async () => {
      await expect(
        result.current.addTask({
          title: 'Call the bank',
          priority: 'medium',
          status: 'pending',
        }),
      ).rejects.toThrow('Another change is still saving. Try again.');
    });

    expect(workflow.archiveTask).not.toHaveBeenCalled();
    expect(workflow.addTask).not.toHaveBeenCalled();

    await act(async () => {
      releaseUpdate(OK);
      await firstWrite;
    });
    await waitFor(() => expect(result.current.busy).toBe(false));

    let accepted: boolean | undefined;
    await act(async () => {
      accepted = await result.current.archive('task-1');
    });
    expect(accepted).toBe(true);
    expect(workflow.archiveTask).toHaveBeenCalledWith('task-1');
  });

  it('holds an Undo fired during an in-flight write until that write settles, then restores the previous status', async () => {
    // Stateful: once the held edit settles, the next render carries its result.
    let currentTasks: Task[] = [TASK];
    let releaseEdit!: () => void;
    workflow.updateTask.mockResolvedValueOnce(OK).mockImplementationOnce(
      () =>
        new Promise<MutationResult>((resolve) => {
          releaseEdit = () => {
            currentTasks = [{ ...TASK, description: 'changed' }];
            resolve(OK);
          };
        }),
    );
    mockUseTasksWorkflow.mockImplementation(() => ({
      ...workflow,
      tasks: currentTasks,
    }));
    const { result } = renderTasksPage();

    await act(async () => {
      await result.current.toggleDone(TASK, true);
    });
    const toastArgs = mockToast.mock.calls[0][0] as {
      action: { props: { onClick: () => Promise<void> } };
    };

    let firstWrite: Promise<boolean> | undefined;
    await act(async () => {
      firstWrite = result.current.updateFields(TASK, {
        description: 'changed',
      });
    });
    await waitFor(() => expect(workflow.updateTask).toHaveBeenCalledTimes(2));

    let undo: Promise<void> | undefined;
    await act(async () => {
      undo = toastArgs.action.props.onClick();
    });
    expect(workflow.updateTask).toHaveBeenCalledTimes(2);

    // Release the held write first; the commit that carries it flushes after this act.
    await act(async () => {
      releaseEdit();
      await firstWrite;
    });
    await act(async () => {
      await undo;
    });

    expect(workflow.updateTask).toHaveBeenCalledTimes(3);
    expect(workflow.updateTask).toHaveBeenNthCalledWith(
      3,
      'task-1',
      expect.objectContaining({
        description: 'changed',
        status: 'in_progress',
      }),
    );
  });
});
