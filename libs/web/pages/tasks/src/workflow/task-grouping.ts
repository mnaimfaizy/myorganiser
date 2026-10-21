import type { Task, TaskContext } from '@myorganiser/vault-core';
import { isClosedTaskStatus } from '@myorganiser/vault-core';

const SEPARATOR = ' · ';

export const CONTEXT_LABELS = {
  personal: 'Personal',
  work: 'Work',
} as const satisfies Record<TaskContext, string>;

const DUE_DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** A `YYYY-MM-DD` key read back as local midnight. */
function fromDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Monday 00:00 local of the week `now` falls in. */
function startOfWeek(now: Date): Date {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

/** The due-state groups an open Task falls into, in display order. */
export type TaskDueGroup = 'overdue' | 'today' | 'upcoming' | 'no_date';

export const TASK_DUE_GROUPS: readonly TaskDueGroup[] = [
  'overdue',
  'today',
  'upcoming',
  'no_date',
];

export interface TaskCounts {
  /** Open (not done, not cancelled) Tasks. */
  open: number;
  /** Open Tasks due today. */
  dueToday: number;
  /** Open Tasks due before today. */
  overdue: number;
  inProgress: number;
  blocked: number;
  /** Tasks marked done since the start of this week (Monday, local time). */
  doneThisWeek: number;
}

/** A local calendar date as `YYYY-MM-DD`, the shape a Task's `dueDate` takes. */
export function localDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** True while a Task is neither done nor cancelled. */
export function isOpenTask(task: Task): boolean {
  return !isClosedTaskStatus(task.status);
}

/** Which due group an open Task belongs to, compared with `today` (`YYYY-MM-DD`). */
export function dueGroupOf(task: Task, today: string): TaskDueGroup {
  if (!task.dueDate) return 'no_date';
  if (task.dueDate < today) return 'overdue';
  if (task.dueDate === today) return 'today';
  return 'upcoming';
}

/**
 * Open Tasks bucketed by due state. The input order is kept inside each
 * group, so a list sorted by `sortTasks` stays priority, then due, then created.
 */
export function groupOpenTasks(
  tasks: readonly Task[],
  today: string,
): Record<TaskDueGroup, Task[]> {
  const groups: Record<TaskDueGroup, Task[]> = {
    overdue: [],
    today: [],
    upcoming: [],
    no_date: [],
  };
  for (const task of tasks) {
    if (isOpenTask(task)) groups[dueGroupOf(task, today)].push(task);
  }
  return groups;
}

/** Done Tasks whose `closedAt` falls in the current week (Monday 00:00 local onward). */
export function doneThisWeek(tasks: readonly Task[], now: Date): Task[] {
  const weekStart = startOfWeek(now).getTime();
  return tasks.filter(
    (task) =>
      task.status === 'done' &&
      task.closedAt !== undefined &&
      new Date(task.closedAt).getTime() >= weekStart,
  );
}

export function countTasks(tasks: readonly Task[], now: Date): TaskCounts {
  const today = localDateKey(now);
  const open = tasks.filter(isOpenTask);
  return {
    open: open.length,
    dueToday: open.filter((t) => dueGroupOf(t, today) === 'today').length,
    overdue: open.filter((t) => dueGroupOf(t, today) === 'overdue').length,
    inProgress: open.filter((t) => t.status === 'in_progress').length,
    blocked: open.filter((t) => t.status === 'blocked').length,
    doneThisWeek: doneThisWeek(tasks, now).length,
  };
}

/**
 * The line under the page title. `desktop`: "12 open · 3 due today · 1 overdue";
 * `phone`: "12 open · 3 today · 1 overdue". Zero due-today and overdue parts are
 * left out. With nothing open: desktop "Nothing open · 4 done this week"
 * (the done part only when non-zero), phone "Nothing open".
 */
export function formatTaskSummary(
  counts: TaskCounts,
  variant: 'desktop' | 'phone',
): string {
  if (counts.open === 0) {
    return variant === 'desktop' && counts.doneThisWeek > 0
      ? `Nothing open${SEPARATOR}${counts.doneThisWeek} done this week`
      : 'Nothing open';
  }
  const parts = [`${counts.open} open`];
  if (counts.dueToday > 0) {
    parts.push(
      variant === 'desktop'
        ? `${counts.dueToday} due today`
        : `${counts.dueToday} today`,
    );
  }
  if (counts.overdue > 0) parts.push(`${counts.overdue} overdue`);
  return parts.join(SEPARATOR);
}

/**
 * A due date for a row: "Yesterday", "Today", "Tomorrow", otherwise
 * "Fri 24 Oct"; "—" when there is none.
 */
export function formatDueLabel(
  dueDate: string | undefined,
  today: string,
): string {
  if (!dueDate) return '—';
  if (dueDate === today) return 'Today';
  const todayDate = fromDateKey(today);
  const yesterday = new Date(todayDate);
  yesterday.setDate(todayDate.getDate() - 1);
  if (dueDate === localDateKey(yesterday)) return 'Yesterday';
  const tomorrow = new Date(todayDate);
  tomorrow.setDate(todayDate.getDate() + 1);
  if (dueDate === localDateKey(tomorrow)) return 'Tomorrow';
  return DUE_DATE_FORMAT.format(fromDateKey(dueDate)).replace(',', '');
}

/** "15 min". */
export function formatEstimate(minutes: number): string {
  return `${minutes} min`;
}

/**
 * Reads what a person types in the Estimate field: "30", "30 min", "30m",
 * "45 mins" → 30/45. Empty or whitespace → `undefined` (no estimate).
 * Anything else, zero or a negative → `null` (invalid).
 */
export function parseEstimate(input: string): number | undefined | null {
  const trimmed = input.trim();
  if (trimmed === '') return undefined;
  const match = /^(\d+)\s*(?:m|min|mins|minutes)?$/i.exec(trimmed);
  if (!match) return null;
  const minutes = Number(match[1]);
  return minutes > 0 ? minutes : null;
}

/**
 * The phone row's second line: the due label (left out in the Today group
 * and when there is no date), the context ("Personal" / "Work"), and the
 * estimate, joined with " · ". Example: "Yesterday · Personal",
 * "Personal · 15 min", "Fri 24 Oct · Personal".
 */
export function taskMetaLine(task: Task, today: string): string {
  const group = dueGroupOf(task, today);
  const parts: string[] = [];
  if (group !== 'today' && group !== 'no_date') {
    parts.push(formatDueLabel(task.dueDate, today));
  }
  if (task.context) parts.push(CONTEXT_LABELS[task.context]);
  if (task.estimatedMinutes) parts.push(formatEstimate(task.estimatedMinutes));
  return parts.join(SEPARATOR);
}
