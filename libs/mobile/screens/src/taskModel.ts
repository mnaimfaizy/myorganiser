import { localDateKey } from '@myorganiser/core/portable';
import {
  compareTasksByPriorityDueDateCreated,
  isClosedTaskStatus,
  type Task,
  type TaskContext,
  type TaskPriority,
  type TaskStatus,
} from '@myorganiser/vault-core/portable';
import {
  formatCalendarDate,
  formatCalendarDateShort,
  toCalendarDate,
} from './calendarDate';

/**
 * What the Tasks screens read out of a decrypted Tasks Vault Blob.
 *
 * The payload is decrypted JSON written by some build of some client, so
 * every field but `id` is a claim — the same defensive reading
 * `groceryTripModel.ts` does for Groceries. This module holds no React and
 * imports no `react-native`, which is what lets `libs/mobile/screens`' Jest
 * project — a `node` environment with no renderer — cover it.
 */
export type DecryptedTask = Partial<Task> & { id: string };

export type TaskContextFilter = 'all' | TaskContext;

export type OpenTaskGroupKey = 'overdue' | 'today' | 'upcoming' | 'noDate';

/** The open Tasks (pending, in progress, blocked) due on one day, or none. */
export interface OpenTaskGroup {
  key: OpenTaskGroupKey;
  label: string;
  tasks: DecryptedTask[];
}

export type ClosedTaskSectionKey = 'done' | 'cancelled';

/** The Done or Cancelled Tasks, shown only once "Show done" is on. */
export interface ClosedTaskSection {
  key: ClosedTaskSectionKey;
  label: string;
  tasks: DecryptedTask[];
}

const OPEN_GROUP_LABEL = {
  overdue: 'Overdue',
  today: 'Today',
  upcoming: 'Upcoming',
  noDate: 'No date',
} as const satisfies Record<OpenTaskGroupKey, string>;

const OPEN_GROUP_ORDER: readonly OpenTaskGroupKey[] = [
  'overdue',
  'today',
  'upcoming',
  'noDate',
];

const CLOSED_SECTION_LABEL = {
  done: 'Done',
  cancelled: 'Cancelled',
} as const satisfies Record<ClosedTaskSectionKey, string>;

const CLOSED_SECTION_ORDER: readonly ClosedTaskSectionKey[] = [
  'done',
  'cancelled',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toDecryptedTask(entry: unknown): DecryptedTask | null {
  if (!isRecord(entry)) return null;
  return typeof entry.id === 'string' && entry.id.length > 0
    ? (entry as DecryptedTask)
    : null;
}

/**
 * Every Task in the payload the Mobile App may show.
 *
 * Archived Tasks remain web-only (#915): showing one here would offer no way
 * to unarchive it, so it is dropped rather than surfaced.
 */
function readVisibleTasks(records: unknown): DecryptedTask[] {
  if (!Array.isArray(records)) return [];
  const tasks: DecryptedTask[] = [];
  for (const entry of records) {
    const task = toDecryptedTask(entry);
    if (task !== null && task.archived !== true) tasks.push(task);
  }
  return tasks;
}

/** The one Task with `id`, or `null` when the payload holds none — deleted or
 * archived elsewhere while this screen was open. */
export function findVisibleTask(
  records: unknown,
  id: string,
): DecryptedTask | null {
  return readVisibleTasks(records).find((task) => task.id === id) ?? null;
}

/**
 * The Task a detail screen draws.
 *
 * `found` is the Task in the screen's copy of the Vault Blob. `leaving` is
 * the Task as it stood when the User deleted or archived it on that screen,
 * held for as long as that removal is (`TaskRemoval`). The edit takes the
 * Task out of the copy before the push, and the screen stays on show until
 * the push has landed and it has been popped — so for that long it draws the
 * Task the User removed, not "not found", which says another device did it
 * (#1085).
 *
 * A push that is refused puts the Task back in the copy, and the copy is what
 * is drawn. With neither there is nothing to draw: the Task was deleted or
 * archived elsewhere, or the id never named one.
 */
export function taskOnDetail(
  found: DecryptedTask | null,
  leaving: DecryptedTask | null,
): DecryptedTask | null {
  return found ?? leaving;
}

/** How the User took a Task off its detail screen. */
export type TaskRemovalKind = 'delete' | 'archive';

/**
 * A delete or archive the User asked for on a Task's detail screen and has
 * not given up: the Task as it stood then, and whether the edit has been
 * handed to the Vault yet. It waits unsent while another write or a reload is
 * running, because the Vault runs one request at a time and refuses a second.
 */
export interface TaskRemoval {
  task: DecryptedTask;
  kind: TaskRemovalKind;
  sent: boolean;
}

/**
 * Where a removal stands.
 *
 * - `none` — the User removed nothing here.
 * - `sending` — waiting its turn, or on its way: a Vault Push, a retry, or a
 *   reload that is sending the edit.
 * - `landed` — the server has it. The screen leaves.
 * - `refused` — the push failed, the Task is back, and the Vault holds the
 *   edit. The screen says so and offers the way to send it again.
 * - `dropped` — the Task is back and the Vault holds nothing to say why: the
 *   edit was never taken, or a reload found nothing to send. The screen lets
 *   go of the removal.
 */
export type TaskRemovalPhase =
  | 'none'
  | 'sending'
  | 'landed'
  | 'refused'
  | 'dropped';

/**
 * Reads a removal's phase from the screen's copy of the Vault Blob rather
 * than from one push's answer, so a retry and a reload that sent the held
 * edit both count as the removal landing — as `captureLanded` does for a
 * capture. Whichever way the edit reaches the server, the screen leaves, and
 * never rests on "Task not found" for a removal the User made (#1088).
 *
 * `found` is the Task in the copy. While a request runs the copy already
 * lacks it, Unconfirmed, and a refused push puts it back — so `busy` is what
 * tells an edit on its way from one that has landed. `refused` is whether
 * the Vault reports a write error, which it does for exactly as long as it
 * holds the edit or has just declined it.
 */
export function taskRemovalPhase(
  removal: TaskRemoval | null,
  found: DecryptedTask | null,
  vault: { busy: boolean; refused: boolean },
): TaskRemovalPhase {
  if (removal === null) return 'none';
  if (!removal.sent || vault.busy) return 'sending';
  if (found === null) return 'landed';
  return vault.refused ? 'refused' : 'dropped';
}

/**
 * Where a refused removal's notice is drawn: in the confirm sheet while it is
 * up — a notice on the screen would sit behind the scrim, unread — and on the
 * screen otherwise, beside the actions the User pressed. `null` when there is
 * nothing to say.
 */
export function taskRemovalNoticePlace(
  phase: TaskRemovalPhase,
  sheetVisible: boolean,
): 'sheet' | 'screen' | null {
  if (phase !== 'refused') return null;
  return sheetVisible ? 'sheet' : 'screen';
}

/** A Task's status, defaulting to `pending` when the payload carries none. */
export function taskStatus(task: DecryptedTask): TaskStatus {
  return task.status ?? 'pending';
}

function matchesContext(
  task: DecryptedTask,
  filter: TaskContextFilter,
): boolean {
  return filter === 'all' || task.context === filter;
}

function timeOf(value: string | undefined): number {
  if (value == null) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Done or Cancelled Tasks: most recently closed first. Ties — including two
 * Tasks with no `closedAt`, closed before #915 added the field — fall back to
 * `updatedAt`, then `createdAt`.
 */
function byClosedOrder(a: DecryptedTask, b: DecryptedTask): number {
  const closedDelta = timeOf(b.closedAt) - timeOf(a.closedAt);
  if (closedDelta !== 0) return closedDelta;
  const updatedDelta = timeOf(b.updatedAt) - timeOf(a.updatedAt);
  if (updatedDelta !== 0) return updatedDelta;
  return timeOf(b.createdAt) - timeOf(a.createdAt);
}

/**
 * `value`'s calendar date, read as three local components.
 *
 * Never through `new Date(value)`: a bare `YYYY-MM-DD` (what the web date
 * input writes to `dueDate`) parses as UTC midnight, which reads as the
 * *previous* local day for anyone west of UTC — exactly the local-midnight
 * boundary a Task due "today" must not cross.
 */
function parseDateOnly(
  value: string,
): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match === null) return null;
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}

function startOfLocalDay(y: number, m: number, d: number): number {
  return new Date(y, m, d).getTime();
}

/** Which open group a due date falls into, against `now`'s local calendar day. */
export function dueDateGroup(
  dueDate: string | undefined,
  now: Date,
): OpenTaskGroupKey {
  if (dueDate == null) return 'noDate';
  const parsed = parseDateOnly(dueDate);
  if (parsed === null) return 'noDate';

  const due = startOfLocalDay(parsed.y, parsed.m, parsed.d);
  const todayStart = startOfLocalDay(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  if (due < todayStart) return 'overdue';
  if (due === todayStart) return 'today';
  return 'upcoming';
}

/**
 * The open Tasks (pending, in progress, blocked) matching `contextFilter`,
 * grouped Overdue / Today / Upcoming / No date in `now`'s local time.
 *
 * A group with nothing in it is not a group — the same convention
 * `groceryTripModel.ts` uses for a category with nothing left to pick up.
 */
export function selectOpenTaskGroups(
  records: unknown,
  contextFilter: TaskContextFilter,
  now: Date,
): OpenTaskGroup[] {
  const buckets = new Map<OpenTaskGroupKey, DecryptedTask[]>();

  for (const task of readVisibleTasks(records)) {
    if (isClosedTaskStatus(taskStatus(task))) continue;
    if (!matchesContext(task, contextFilter)) continue;

    const key = dueDateGroup(task.dueDate, now);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(task);
    else buckets.set(key, [task]);
  }

  const groups: OpenTaskGroup[] = [];
  for (const key of OPEN_GROUP_ORDER) {
    const tasks = buckets.get(key);
    if (tasks === undefined) continue;
    groups.push({
      key,
      label: OPEN_GROUP_LABEL[key],
      tasks: [...tasks].sort(compareTasksByPriorityDueDateCreated),
    });
  }
  return groups;
}

/**
 * The Done Tasks, then the Cancelled Tasks, matching `contextFilter` — what
 * "Show done" reveals. Each section is ordered by `closedAt`, then
 * `updatedAt`, then `createdAt`, and a section with nothing in it is omitted.
 */
export function selectClosedTaskSections(
  records: unknown,
  contextFilter: TaskContextFilter,
): ClosedTaskSection[] {
  const closed = readVisibleTasks(records).filter(
    (task) =>
      isClosedTaskStatus(taskStatus(task)) &&
      matchesContext(task, contextFilter),
  );

  const sections: ClosedTaskSection[] = [];
  for (const key of CLOSED_SECTION_ORDER) {
    const tasks = closed
      .filter((task) => taskStatus(task) === key)
      .sort(byClosedOrder);
    if (tasks.length === 0) continue;
    sections.push({ key, label: CLOSED_SECTION_LABEL[key], tasks });
  }
  return sections;
}

/**
 * How many of the priority marker's three bars are filled — high fills all
 * three, low fills one. The marker is never drawn in a destructive colour: it
 * says how urgent a Task is, where a destructive colour on this screen says
 * something is about to be removed.
 */
export function priorityBarCount(priority: TaskPriority | undefined): number {
  if (priority === 'high') return 3;
  if (priority === 'low') return 1;
  return 2;
}

/**
 * `date`'s own calendar day as `YYYY-MM-DD` — the shape the web date input
 * writes to `dueDate` — read in local time.
 *
 * Never `date.toISOString()`, which reads UTC and would write tomorrow's date
 * for a "Today" chip tapped late at night east of UTC.
 */
export function localDateOnlyString(date: Date): string {
  return localDateKey(date);
}

/**
 * How each status reads in the app — the detail screen's five-way selector
 * and the list's status pills. Pinned to the status set, so a sixth status
 * fails to compile here rather than missing from the selector (ADR 0053).
 * The selector's order is this table's order.
 */
export const TASK_STATUS_LABEL = {
  pending: 'Pending',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
} as const satisfies Record<TaskStatus, string>;

/** How each priority reads — High / Medium / Low, in this order. */
export const TASK_PRIORITY_LABEL = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
} as const satisfies Record<TaskPriority, string>;

/** How each context reads — Personal / Work, in this order. */
export const TASK_CONTEXT_LABEL = {
  personal: 'Personal',
  work: 'Work',
} as const satisfies Record<TaskContext, string>;

/** A label table's keys, in its own order, as the union it is keyed by. */
export function labelledValues<Key extends string>(
  table: Readonly<Record<Key, string>>,
): Key[] {
  return Object.keys(table) as Key[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return startOfLocalDay(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Whole local calendar days from `from` to `to` — DST-safe. */
function calendarDaysBetween(from: number, to: number): number {
  return Math.round((to - from) / DAY_MS);
}

/** How a Task's due date reads on its row, and whether it is overdue. */
export interface DueLabel {
  text: string;
  overdue: boolean;
}

/**
 * A due date as the Tasks list prints it: "Today", "2 days overdue", or the
 * date itself — "Tue 29 Sep", with the year only when it is not `now`'s.
 * Never the stored ISO. `null` for no date or one that cannot be read.
 */
export function describeDue(
  dueDate: string | undefined,
  now: Date,
): DueLabel | null {
  if (dueDate == null) return null;
  const parsed = parseDateOnly(dueDate);
  if (parsed === null) return null;
  const due = startOfLocalDay(parsed.y, parsed.m, parsed.d);
  const days = calendarDaysBetween(due, startOfDay(now));
  if (days === 0) return { text: 'Today', overdue: false };
  if (days > 0) {
    return {
      text: days === 1 ? '1 day overdue' : `${days} days overdue`,
      overdue: true,
    };
  }
  return {
    text:
      parsed.y === now.getFullYear()
        ? formatCalendarDateShort(dueDate)
        : formatCalendarDate(dueDate),
    overdue: false,
  };
}

/**
 * An instant's local calendar day, relative to `now`: "today", "yesterday",
 * or "Thu 24 Sep" (with the year when it is not `now`'s). `null` when the
 * value cannot be read.
 */
function describeDay(value: string, now: Date): string | null {
  const instant = Date.parse(value);
  if (Number.isNaN(instant)) return null;
  const date = new Date(instant);
  const days = calendarDaysBetween(startOfDay(date), startOfDay(now));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  const day = toCalendarDate(date);
  return date.getFullYear() === now.getFullYear()
    ? formatCalendarDateShort(day)
    : formatCalendarDate(day);
}

/**
 * When a Done or Cancelled Task was closed, as its row prints it: "Done
 * today", "Done yesterday", "Cancelled Thu 24 Sep". `null` for a Task closed
 * before #915 added `closedAt`, or an open one.
 */
export function describeClosed(task: DecryptedTask, now: Date): string | null {
  const status = taskStatus(task);
  if (!isClosedTaskStatus(status) || task.closedAt == null) return null;
  const day = describeDay(task.closedAt, now);
  return day === null ? null : `${TASK_STATUS_LABEL[status]} ${day}`;
}

/**
 * When a Task was created, as the detail screen's footer prints it — "Mon 21
 * Sep" — or `null` when the payload carries no readable `createdAt`.
 */
export function describeCreated(
  createdAt: string | undefined,
  now: Date,
): string | null {
  if (createdAt == null) return null;
  const instant = Date.parse(createdAt);
  if (Number.isNaN(instant)) return null;
  const date = new Date(instant);
  const day = toCalendarDate(date);
  return date.getFullYear() === now.getFullYear()
    ? formatCalendarDateShort(day)
    : formatCalendarDate(day);
}

/**
 * An estimate as the Tasks list prints it: "45 min" and "60 min" in minutes,
 * whole hours from two up as "2 h", and "2 h 30 min" past that. `null` for
 * no estimate or a negative or non-finite one.
 */
export function formatEstimate(minutes: number | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return null;
  const whole = Math.round(minutes);
  if (whole < 120) return `${whole} min`;
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Every Task the Mobile App may show — archived ones are web-only. */
export function countVisibleTasks(records: unknown): number {
  return readVisibleTasks(records).length;
}

/**
 * The Done Tasks matching `contextFilter` closed since the start of `now`'s
 * local week (Monday) — the "4 Tasks done this week" of the All clear state.
 */
export function countDoneThisWeek(
  records: unknown,
  contextFilter: TaskContextFilter,
  now: Date,
): number {
  // getDay() is 0 for Sunday; the week starts on the Monday before it. Built
  // from calendar components, not by subtracting days of milliseconds, so a
  // daylight-saving change inside the week cannot move its start.
  const weekStartDay = startOfLocalDay(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - ((now.getDay() + 6) % 7),
  );
  return readVisibleTasks(records).filter((task) => {
    if (taskStatus(task) !== 'done' || task.closedAt == null) return false;
    if (!matchesContext(task, contextFilter)) return false;
    const closed = Date.parse(task.closedAt);
    return !Number.isNaN(closed) && closed >= weekStartDay;
  }).length;
}

/**
 * `records` with some Tasks shown as they stood before an edit — a ticked
 * Task dwelling in its group for the Motion sheet's 600 ms before it leaves,
 * while the edit that closed it is already on its way. Everything else is
 * returned untouched; a non-array payload is returned as it came.
 */
export function withTaskOverrides(
  records: unknown,
  overrides: ReadonlyMap<string, DecryptedTask>,
): unknown {
  if (overrides.size === 0 || !Array.isArray(records)) return records;
  return records.map((entry) => {
    const task = toDecryptedTask(entry);
    return task !== null ? (overrides.get(task.id) ?? entry) : entry;
  });
}
