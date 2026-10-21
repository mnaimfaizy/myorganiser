'use client';

import { ConfirmDialog, useIsMobileState } from '@myorganiser/web-ui';
import type { VaultHandle } from '@myorganiser/web-vault';
import { VaultGate } from '@myorganiser/web-vault-ui';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { TaskDetailPatch } from '../hooks/use-task-detail-draft';
import { useTasksPage } from '../hooks/use-tasks-page';
import type { TasksPageController } from '../hooks/use-tasks-page';
import { localDateKey } from '../workflow/task-grouping';
import { TaskDetailScreen } from './task-detail-screen';
import { TasksBoard } from './tasks-board';

const TASKS_HREF = '/dashboard/tasks';

export interface TaskDetailPageClientProps {
  taskId: string;
}

interface TaskDetailInnerProps extends TaskDetailPageClientProps {
  handle: VaultHandle;
}

interface TaskDetailPhoneProps {
  page: TasksPageController;
  taskId: string;
}

/** The phone detail: the task pushed over the list, with each exit back to the list. */
function TaskDetailPhone({ page, taskId }: TaskDetailPhoneProps) {
  const router = useRouter();
  const {
    tasks,
    loading,
    toggleDone,
    updateFields,
    archive,
    unarchive,
    deleteTask,
  } = page;
  const task = tasks.find((t) => t.id === taskId);
  const today = localDateKey(new Date());
  const [deleting, setDeleting] = useState(false);
  // Set while the task is being deleted, so the not-found redirect does not
  // race the explicit navigation back to the list.
  const leavingRef = useRef(false);

  useEffect(() => {
    if (!loading && !task && !leavingRef.current) {
      router.replace(TASKS_HREF);
    }
  }, [loading, router, task]);

  const handleUpdate = useCallback(
    (patch: TaskDetailPatch) =>
      task ? updateFields(task, patch) : Promise.resolve(false),
    [task, updateFields],
  );

  const handleMarkDone = useCallback(async () => {
    if (!task) return;
    const saved = await toggleDone(task, true);
    if (saved) router.push(TASKS_HREF);
  }, [router, task, toggleDone]);

  const handleArchive = useCallback(async () => {
    if (!task) return;
    const archived = await archive(task.id);
    if (archived) router.push(TASKS_HREF);
  }, [archive, router, task]);

  const handleUnarchive = useCallback(async () => {
    if (!task) return;
    const restored = await unarchive(task.id);
    if (restored) router.push(TASKS_HREF);
  }, [router, task, unarchive]);

  const handleRequestDelete = useCallback(() => {
    setDeleting(true);
  }, []);

  const handleDeleteOpenChange = useCallback((open: boolean) => {
    setDeleting(open);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!task) return;
    leavingRef.current = true;
    const deleted = await deleteTask(task.id);
    if (deleted) {
      setDeleting(false);
      router.push(TASKS_HREF);
    } else {
      leavingRef.current = false;
      setDeleting(false);
    }
  }, [deleteTask, router, task]);

  if (loading || !task) {
    return null;
  }

  return (
    <>
      <TaskDetailScreen
        task={task}
        today={today}
        onUpdate={handleUpdate}
        onMarkDone={handleMarkDone}
        onArchive={handleArchive}
        onUnarchive={handleUnarchive}
        onDelete={handleRequestDelete}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={handleDeleteOpenChange}
        title={`Delete "${task.title}"?`}
        description="This action cannot be undone. The task will be permanently deleted."
        confirmLabel="Delete task"
        tone="destructive"
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}

function TaskDetailInner({ handle, taskId }: TaskDetailInnerProps) {
  const page = useTasksPage(handle);
  // Render nothing until the breakpoint is decided, so a phone never paints
  // the desktop board on the first frame.
  const isPhone = useIsMobileState();

  if (isPhone === undefined) {
    return null;
  }

  if (isPhone) {
    return <TaskDetailPhone page={page} taskId={taskId} />;
  }

  return (
    <TasksBoard page={page} variant="desktop" initialSelectedTaskId={taskId} />
  );
}

export function TaskDetailPageClient({ taskId }: TaskDetailPageClientProps) {
  return (
    <VaultGate title="Tasks">
      {({ handle }) =>
        handle ? <TaskDetailInner handle={handle} taskId={taskId} /> : null
      }
    </VaultGate>
  );
}
