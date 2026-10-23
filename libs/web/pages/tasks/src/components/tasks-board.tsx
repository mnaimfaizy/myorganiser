'use client';

import type { Task } from '@myorganiser/vault-core';
import { ConfirmDialog, IconButton } from '@myorganiser/web-ui';
import { Plus } from 'lucide-react';
import { useCallback, useState } from 'react';

import type { TaskDetailPatch } from '../hooks/use-task-detail-draft';
import type { TasksPageController } from '../hooks/use-tasks-page';
import {
  countTasks,
  doneThisWeek,
  formatTaskSummary,
  groupOpenTasks,
  isOpenTask,
  localDateKey,
  TASK_DUE_GROUPS,
} from '../workflow/task-grouping';
import type { TaskCounts } from '../workflow/task-grouping';
import { TaskAddDialog } from './task-add-dialog';
import { TaskCaptureSheet } from './task-capture-sheet';
import { TaskDetailPanel } from './task-detail-panel';
import { TaskFilters } from './task-filters';
import type { TaskContextFilter, TaskStatusFilter } from './task-filters';
import { TASK_GROUP_META } from './task-group-section';
import { TaskQuickAdd } from './task-quick-add';
import { TasksAllClear } from './tasks-all-clear';
import { TasksBoardList } from './tasks-board-list';
import type { TaskBoardSection } from './tasks-board-list';
import { TasksHeader } from './tasks-header';

export interface TasksBoardProps {
  page: TasksPageController;
  variant: 'desktop' | 'phone';
  /** Desktop only: the task whose detail panel is open on first render. */
  initialSelectedTaskId?: string;
}

interface BoardView {
  counts: TaskCounts;
  sections: TaskBoardSection[];
  /** Open view only: the tasks done this week, under the collapsed group. */
  doneTasks: Task[] | null;
}

function dueSections(tasks: Task[], today: string): TaskBoardSection[] {
  const groups = groupOpenTasks(tasks, today);
  return TASK_DUE_GROUPS.filter((group) => groups[group].length > 0).map(
    (group) => {
      const meta = TASK_GROUP_META[group];
      return {
        key: group,
        name: meta.name,
        label: `${meta.name} · ${groups[group].length}`,
        tone: meta.tone,
        group,
        tasks: groups[group],
      };
    },
  );
}

/** Derives what the board shows from the tasks, the two filters, and the clock. */
function buildBoardView(
  tasks: readonly Task[],
  context: TaskContextFilter,
  status: TaskStatusFilter,
  now: Date,
): BoardView {
  const today = localDateKey(now);
  const inContext =
    context === 'all' ? [...tasks] : tasks.filter((t) => t.context === context);
  const live = inContext.filter((t) => !t.archived);
  const counts = countTasks(live, now);

  if (status === 'archived') {
    const archived = inContext.filter((t) => t.archived);
    return {
      counts,
      doneTasks: null,
      sections:
        archived.length === 0
          ? []
          : [
              {
                key: 'archived',
                name: 'Archived',
                label: `Archived · ${archived.length}`,
                tone: 'neutral',
                group: 'archived',
                tasks: archived,
              },
            ],
    };
  }

  if (status === 'done') {
    const closed = live.filter((t) => !isOpenTask(t));
    return {
      counts,
      doneTasks: null,
      sections:
        closed.length === 0
          ? []
          : [
              {
                key: 'done',
                name: 'Done',
                label: `Done · ${closed.length}`,
                tone: 'neutral',
                group: 'closed',
                tasks: closed,
              },
            ],
    };
  }

  const open = live.filter(isOpenTask);
  const scoped =
    status === 'open' ? open : open.filter((t) => t.status === status);
  return {
    counts,
    sections: dueSections(scoped, today),
    doneTasks: status === 'open' ? doneThisWeek(live, now) : null,
  };
}

/**
 * The Tasks board shared by the list and the detail route on desktop. It owns
 * the filters, the desktop selection and the dialogs, and reads and writes
 * through the `useTasksPage` controller it is given.
 */
export function TasksBoard({
  page,
  variant,
  initialSelectedTaskId,
}: TasksBoardProps) {
  const {
    tasks,
    loading,
    addTask,
    quickAdd,
    capture,
    toggleDone,
    updateFields,
    archive,
    unarchive,
    deleteTask,
  } = page;
  const isPhone = variant === 'phone';

  const [contextFilter, setContextFilter] = useState<TaskContextFilter>('all');
  const [statusFilter, setStatusFilter] = useState<TaskStatusFilter>('open');
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(
    initialSelectedTaskId,
  );
  const [addOpen, setAddOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [deletingTask, setDeletingTask] = useState<Task | null>(null);

  const now = new Date();
  const today = localDateKey(now);
  const view = buildBoardView(tasks, contextFilter, statusFilter, now);
  // A selection whose task has gone (deleted elsewhere) finds no task, so no
  // panel opens on a stale id.
  const selectedTask = tasks.find((t) => t.id === selectedTaskId);

  const handleAddRequest = useCallback(() => {
    if (isPhone) {
      setCaptureOpen(true);
    } else {
      setAddOpen(true);
    }
  }, [isPhone]);

  const handleCloseAdd = useCallback(() => {
    setAddOpen(false);
  }, []);

  const handleShowDone = useCallback(() => {
    setStatusFilter('done');
  }, []);

  const handleSelect = useCallback((task: Task) => {
    setSelectedTaskId(task.id);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedTaskId(undefined);
  }, []);

  const handlePanelUpdate = useCallback(
    (patch: TaskDetailPatch) =>
      selectedTask ? updateFields(selectedTask, patch) : Promise.resolve(false),
    [selectedTask, updateFields],
  );

  const handlePanelArchive = useCallback(() => {
    if (selectedTask) void archive(selectedTask.id);
  }, [archive, selectedTask]);

  const handlePanelUnarchive = useCallback(() => {
    if (selectedTask) void unarchive(selectedTask.id);
  }, [selectedTask, unarchive]);

  const handlePanelDelete = useCallback(() => {
    setDeletingTask(selectedTask ?? null);
  }, [selectedTask]);

  const handleDeleteOpenChange = useCallback((open: boolean) => {
    if (!open) setDeletingTask(null);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deletingTask) return;
    const deletedId = deletingTask.id;
    const deleted = await deleteTask(deletedId);
    if (deleted) {
      setSelectedTaskId((current) =>
        current === deletedId ? undefined : current,
      );
    }
    setDeletingTask(null);
  }, [deleteTask, deletingTask]);

  const showAllClear =
    !loading && statusFilter === 'open' && view.counts.open === 0;
  const summary = loading ? '' : formatTaskSummary(view.counts, variant);

  const list = loading ? null : showAllClear ? (
    <TasksAllClear
      doneThisWeek={view.counts.doneThisWeek}
      onShowDone={handleShowDone}
      onAddTask={isPhone ? undefined : handleAddRequest}
      variant={variant}
    />
  ) : (
    <TasksBoardList
      sections={view.sections}
      doneTasks={view.doneTasks}
      today={today}
      variant={variant}
      selectedTaskId={selectedTaskId}
      onToggleDone={toggleDone}
      onSelect={handleSelect}
    />
  );

  const deleteDialog = deletingTask ? (
    <ConfirmDialog
      open
      onOpenChange={handleDeleteOpenChange}
      title={`Delete "${deletingTask.title}"?`}
      description="This action cannot be undone. The task will be permanently deleted."
      confirmLabel="Delete task"
      tone="destructive"
      onConfirm={handleConfirmDelete}
    />
  ) : null;

  if (isPhone) {
    return (
      <div className="flex flex-col gap-3 pt-1 pb-24">
        <TasksHeader
          summary={summary}
          onAddTask={handleAddRequest}
          variant="phone"
        />
        <TaskFilters
          context={contextFilter}
          onContextChange={setContextFilter}
          status={statusFilter}
          onStatusChange={setStatusFilter}
          counts={view.counts}
          variant="phone"
        />
        {list}
        <IconButton
          variant="brand"
          size="fab"
          label="Add task"
          onClick={handleAddRequest}
          className="fixed right-4 bottom-[calc(var(--toast-offset,0px)+1rem)] z-10 md:hidden"
        >
          <Plus aria-hidden="true" />
        </IconButton>
        <TaskCaptureSheet
          open={captureOpen}
          onOpenChange={setCaptureOpen}
          today={today}
          onCapture={capture}
        />
        {deleteDialog}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-310 flex-wrap items-start gap-6 p-8">
      <div className="flex min-w-0 grow-999 shrink basis-130 flex-col gap-4.5">
        <TasksHeader
          summary={summary}
          onAddTask={handleAddRequest}
          variant="desktop"
        />
        <TaskFilters
          context={contextFilter}
          onContextChange={setContextFilter}
          status={statusFilter}
          onStatusChange={setStatusFilter}
          counts={view.counts}
          variant="desktop"
        />
        <TaskQuickAdd onQuickAdd={quickAdd} />
        {list}
      </div>
      {selectedTask ? (
        <div className="flex min-w-0 grow shrink basis-85">
          <TaskDetailPanel
            task={selectedTask}
            onUpdate={handlePanelUpdate}
            onClose={handleClosePanel}
            onArchive={handlePanelArchive}
            onUnarchive={handlePanelUnarchive}
            onDelete={handlePanelDelete}
          />
        </div>
      ) : null}
      <TaskAddDialog
        isOpen={addOpen}
        onClose={handleCloseAdd}
        onSubmit={addTask}
      />
      {deleteDialog}
    </div>
  );
}
