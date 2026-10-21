/**
 * Tests for useTaskDetailDraft.
 *
 * Focus: the draft contract shared by the desktop panel and the phone screen.
 * Choices are optimistic and revert when a save is refused. Text fields commit
 * on blur and only save a real change. Drafts reset when the task id changes.
 * `onUpdate` is the only collaborator, so it is the only thing mocked.
 */

import { act, renderHook } from '@testing-library/react';
import type { ChangeEvent } from 'react';
import type { Task } from '@myorganiser/vault-core';

import type { TaskDetailPatch } from './use-task-detail-draft';
import { useTaskDetailDraft } from './use-task-detail-draft';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Original title',
    status: 'pending',
    priority: 'medium',
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeOnUpdate(saved = true) {
  return jest.fn((_patch: TaskDetailPatch) => Promise.resolve(saved));
}

function renderDraft(task: Task, onUpdate = makeOnUpdate()) {
  return renderHook(
    ({ task: current }: { task: Task }) =>
      useTaskDetailDraft({ task: current, onUpdate }),
    { initialProps: { task } },
  );
}

/** Stands in for an input or textarea change event; both reads are covered. */
function changeEvent<T extends HTMLInputElement | HTMLTextAreaElement>(
  value: string,
  badInput = false,
): ChangeEvent<T> {
  const element = { value, validity: { badInput } };
  return {
    target: element,
    currentTarget: element,
  } as unknown as ChangeEvent<T>;
}

describe('useTaskDetailDraft', () => {
  it('saves only the changed status and shows the draft at once', async () => {
    const onUpdate = makeOnUpdate(true);
    const { result } = renderDraft(makeTask(), onUpdate);

    await act(async () => {
      result.current.changeStatus('done');
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(Object.keys(onUpdate.mock.calls[0][0])).toEqual(['status']);
    expect(onUpdate.mock.calls[0][0]).toEqual({ status: 'done' });
    expect(result.current.draft.status).toBe('done');
    expect(result.current.saveState).toBe('saved');
  });

  it('saves only the changed priority', async () => {
    const onUpdate = makeOnUpdate(true);
    const { result } = renderDraft(makeTask(), onUpdate);

    await act(async () => {
      result.current.changePriority('high');
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(Object.keys(onUpdate.mock.calls[0][0])).toEqual(['priority']);
    expect(onUpdate.mock.calls[0][0]).toEqual({ priority: 'high' });
    expect(result.current.draft.priority).toBe('high');
  });

  it('saves a chosen context, and saves an undefined context for None', async () => {
    const onUpdate = makeOnUpdate(true);
    const { result, rerender } = renderDraft(makeTask(), onUpdate);

    await act(async () => {
      result.current.changeContext('work');
    });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenLastCalledWith({ context: 'work' });
    expect(result.current.draft.context).toBe('work');

    // The page re-renders with the saved context before the next choice.
    rerender({ task: makeTask({ context: 'work' }) });
    await act(async () => {
      result.current.changeContext('none');
    });

    expect(onUpdate).toHaveBeenCalledTimes(2);
    // The key must be present so the page merge clears the saved context.
    expect(Object.keys(onUpdate.mock.calls[1][0])).toEqual(['context']);
    expect(onUpdate.mock.calls[1][0]).toEqual({ context: undefined });
    expect(result.current.draft.context).toBe('none');
  });

  it('reverts a refused choice to the saved value and sets the error state', async () => {
    const onUpdate = makeOnUpdate(false);
    const { result } = renderDraft(makeTask({ status: 'pending' }), onUpdate);

    await act(async () => {
      result.current.changeStatus('done');
    });

    expect(onUpdate).toHaveBeenCalledWith({ status: 'done' });
    expect(result.current.draft.status).toBe('pending');
    expect(result.current.saveState).toBe('error');
  });

  it('commits a trimmed title, and does not save a title equal to the saved one', async () => {
    const onUpdate = makeOnUpdate(true);
    const { result } = renderDraft(makeTask(), onUpdate);

    act(() => {
      result.current.changeTitle(
        changeEvent<HTMLInputElement>('  Original title '),
      );
    });
    await act(async () => {
      result.current.commitTitle();
    });
    expect(onUpdate).not.toHaveBeenCalled();

    act(() => {
      result.current.changeTitle(changeEvent<HTMLInputElement>('  Renamed  '));
    });
    await act(async () => {
      result.current.commitTitle();
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({ title: 'Renamed' });
    expect(result.current.draft.title).toBe('Renamed');
  });

  it('refuses a blank title: no save, reverts to the saved title, and shows the error', async () => {
    const onUpdate = makeOnUpdate(true);
    const { result } = renderDraft(makeTask(), onUpdate);

    act(() => {
      result.current.changeTitle(changeEvent<HTMLInputElement>('   '));
    });
    await act(async () => {
      result.current.commitTitle();
    });

    expect(onUpdate).not.toHaveBeenCalled();
    expect(result.current.draft.title).toBe('Original title');
    expect(result.current.errors.title).toBe('Give the task a title.');
  });

  it('saves a typed estimate as minutes', async () => {
    const onUpdate = makeOnUpdate(true);
    const { result } = renderDraft(makeTask(), onUpdate);

    act(() => {
      result.current.changeEstimate(changeEvent<HTMLInputElement>('30 min'));
    });
    await act(async () => {
      result.current.commitEstimate();
    });

    expect(onUpdate).toHaveBeenCalledWith({ estimatedMinutes: 30 });
  });

  it('clears a set estimate by saving an undefined estimate when the field is emptied', async () => {
    const onUpdate = makeOnUpdate(true);
    const { result } = renderDraft(
      makeTask({ estimatedMinutes: 30 }),
      onUpdate,
    );
    expect(result.current.draft.estimate).toBe('30 min');

    act(() => {
      result.current.changeEstimate(changeEvent<HTMLInputElement>(''));
    });
    await act(async () => {
      result.current.commitEstimate();
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(Object.keys(onUpdate.mock.calls[0][0])).toEqual([
      'estimatedMinutes',
    ]);
    expect(onUpdate.mock.calls[0][0]).toEqual({ estimatedMinutes: undefined });
  });

  it('refuses an invalid estimate: no save, and shows the error', async () => {
    const onUpdate = makeOnUpdate(true);
    const { result } = renderDraft(makeTask(), onUpdate);

    act(() => {
      result.current.changeEstimate(changeEvent<HTMLInputElement>('abc'));
    });
    await act(async () => {
      result.current.commitEstimate();
    });

    expect(onUpdate).not.toHaveBeenCalled();
    expect(result.current.errors.estimate).toBe(
      'Enter minutes, for example 30.',
    );
  });

  it('saves a chosen due date', async () => {
    const onUpdate = makeOnUpdate(true);
    const { result } = renderDraft(makeTask(), onUpdate);

    await act(async () => {
      result.current.changeDueDate(changeEvent<HTMLInputElement>('2026-10-24'));
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({ dueDate: '2026-10-24' });
    expect(result.current.draft.dueDate).toBe('2026-10-24');
  });

  it('saves an intentional due date clear, and ignores an empty half-typed date', async () => {
    const onUpdate = makeOnUpdate(true);
    const { result } = renderDraft(
      makeTask({ dueDate: '2026-10-20' }),
      onUpdate,
    );

    // Chrome reports a half-typed date as '' with badInput: not a clear.
    await act(async () => {
      result.current.changeDueDate(changeEvent<HTMLInputElement>('', true));
    });
    expect(onUpdate).not.toHaveBeenCalled();
    expect(result.current.draft.dueDate).toBe('2026-10-20');

    await act(async () => {
      result.current.changeDueDate(changeEvent<HTMLInputElement>(''));
    });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(Object.keys(onUpdate.mock.calls[0][0])).toEqual(['dueDate']);
    expect(onUpdate.mock.calls[0][0]).toEqual({ dueDate: undefined });
    expect(result.current.draft.dueDate).toBe('');
  });

  it('saves a changed description on blur, and does not save an unchanged one', async () => {
    const onUpdate = makeOnUpdate(true);
    const { result } = renderDraft(
      makeTask({ description: 'Call the bank' }),
      onUpdate,
    );

    await act(async () => {
      result.current.commitDescription();
    });
    expect(onUpdate).not.toHaveBeenCalled();

    act(() => {
      result.current.changeDescription(
        changeEvent<HTMLTextAreaElement>('Call the bank before noon'),
      );
    });
    await act(async () => {
      result.current.commitDescription();
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({
      description: 'Call the bank before noon',
    });
  });

  it('moves the save state from idle to saving to saved', async () => {
    let resolveSave: ((saved: boolean) => void) | undefined;
    const onUpdate = jest.fn(
      (_patch: TaskDetailPatch) =>
        new Promise<boolean>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const { result } = renderDraft(makeTask(), onUpdate);
    expect(result.current.saveState).toBe('idle');

    act(() => {
      result.current.changeStatus('done');
    });
    expect(result.current.saveState).toBe('saving');

    await act(async () => {
      resolveSave?.(true);
    });
    expect(result.current.saveState).toBe('saved');
  });

  it('resets every draft field, error, and save state when the task id changes', async () => {
    // Choices and the title are accepted; only the description save is refused,
    // so the last state is 'error' with every field dirty.
    const onUpdate = jest.fn((patch: TaskDetailPatch) =>
      Promise.resolve(!('description' in patch)),
    );
    const { result, rerender } = renderDraft(makeTask(), onUpdate);

    await act(async () => {
      result.current.changeStatus('done');
      result.current.changePriority('high');
      result.current.changeContext('work');
    });
    act(() => {
      result.current.changeTitle(changeEvent<HTMLInputElement>('Edited'));
      result.current.changeEstimate(changeEvent<HTMLInputElement>('abc'));
      result.current.changeDueDate(changeEvent<HTMLInputElement>('2026-10-24'));
      result.current.changeDescription(
        changeEvent<HTMLTextAreaElement>('New notes'),
      );
    });
    act(() => {
      result.current.commitEstimate();
    });
    await act(async () => {
      result.current.commitDescription();
    });
    expect(result.current.saveState).toBe('error');
    expect(result.current.errors.estimate).toBe(
      'Enter minutes, for example 30.',
    );

    rerender({
      task: makeTask({
        id: 'task-2',
        title: 'Other task',
        description: 'Other notes',
        status: 'blocked',
        priority: 'low',
        context: 'personal',
        dueDate: '2026-11-01',
        estimatedMinutes: 15,
      }),
    });

    expect(result.current.draft).toEqual({
      title: 'Other task',
      description: 'Other notes',
      estimate: '15 min',
      dueDate: '2026-11-01',
      status: 'blocked',
      priority: 'low',
      context: 'personal',
    });
    expect(result.current.errors).toEqual({});
    expect(result.current.saveState).toBe('idle');
  });

  it('reverts a choice when onUpdate rejects, and sets the error state', async () => {
    const onUpdate = makeOnUpdate(true);
    onUpdate.mockRejectedValueOnce(new Error('network'));
    const { result } = renderDraft(makeTask({ status: 'pending' }), onUpdate);

    await act(async () => {
      result.current.changeStatus('done');
    });

    expect(onUpdate).toHaveBeenCalledWith({ status: 'done' });
    expect(result.current.draft.status).toBe('pending');
    expect(result.current.saveState).toBe('error');
  });

  it('keeps a refused title in the draft and sets the error state', async () => {
    const onUpdate = makeOnUpdate(false);
    const { result } = renderDraft(makeTask(), onUpdate);

    act(() => {
      result.current.changeTitle(changeEvent<HTMLInputElement>('Renamed'));
    });
    await act(async () => {
      result.current.commitTitle();
    });

    expect(onUpdate).toHaveBeenCalledWith({ title: 'Renamed' });
    expect(result.current.draft.title).toBe('Renamed');
    expect(result.current.saveState).toBe('error');
  });

  it('makes no save when the saved choices and estimate are re-chosen', async () => {
    const onUpdate = makeOnUpdate(true);
    const { result } = renderDraft(
      makeTask({
        status: 'pending',
        priority: 'medium',
        context: 'work',
        estimatedMinutes: 30,
      }),
      onUpdate,
    );

    await act(async () => {
      result.current.changeStatus('pending');
      result.current.changePriority('medium');
      result.current.changeContext('work');
      result.current.changeEstimate(changeEvent<HTMLInputElement>('30 min'));
      result.current.commitEstimate();
    });

    expect(onUpdate).not.toHaveBeenCalled();
    expect(result.current.saveState).toBe('idle');
  });
});
