import type { TaskPriority, TaskStatus } from '@myorganiser/vault-core';
import type {
  TaskContextChoice,
  TaskSaveState,
} from '../hooks/use-task-detail-draft';
import { formatDueLabel } from '../workflow/task-grouping';

/*
 * Presentation copy for the Task detail views: option labels, date formats,
 * and the save indicator text. Kept out of the hook so the hook is logic only.
 */

/** The two layouts that share the Task detail copy. */
export type TaskLayoutVariant = 'desktop' | 'phone';

interface SegmentLabels {
  short: string;
  long: string;
}

interface SegmentOption<V extends string> {
  value: V;
  label: string;
}

export const TASK_STATUS_OPTIONS: readonly {
  value: TaskStatus;
  label: string;
}[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
];

/*
 * One label table per segmented control. Each member is listed once; the
 * desktop card takes `short` ("Med" keeps three segments in a 340px card) and
 * the phone screen takes `long`. Key order is the desktop option order.
 */
const PRIORITY_LABELS = {
  high: { short: 'High', long: 'High' },
  medium: { short: 'Med', long: 'Medium' },
  low: { short: 'Low', long: 'Low' },
} as const satisfies Record<TaskPriority, SegmentLabels>;

const CONTEXT_LABELS = {
  personal: { short: 'Pers.', long: 'Personal' },
  work: { short: 'Work', long: 'Work' },
  none: { short: 'None', long: 'None' },
} as const satisfies Record<TaskContextChoice, SegmentLabels>;

function segmentOptions<V extends string>(
  labels: Record<V, SegmentLabels>,
  variant: TaskLayoutVariant,
): readonly SegmentOption<V>[] {
  const field = variant === 'desktop' ? 'short' : 'long';
  return (Object.keys(labels) as V[]).map((value) => ({
    value,
    label: labels[value][field],
  }));
}

export const TASK_PRIORITY_OPTIONS: Record<
  TaskLayoutVariant,
  readonly SegmentOption<TaskPriority>[]
> = {
  desktop: segmentOptions(PRIORITY_LABELS, 'desktop'),
  phone: segmentOptions(PRIORITY_LABELS, 'phone'),
};

// The phone context control leads with None; the rest keep table order.
const { none: NONE_CONTEXT, ...NAMED_CONTEXTS } = CONTEXT_LABELS;

export const TASK_CONTEXT_OPTIONS: Record<
  TaskLayoutVariant,
  readonly SegmentOption<TaskContextChoice>[]
> = {
  desktop: segmentOptions(CONTEXT_LABELS, 'desktop'),
  phone: [
    { value: 'none', label: NONE_CONTEXT.long },
    ...segmentOptions(NAMED_CONTEXTS, 'phone'),
  ],
};

const DAY_MONTH_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
});

/** "3 Oct" from an ISO timestamp, or '' when it does not parse. */
export function formatCreatedDate(createdAt: string): string {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? '' : DAY_MONTH_FORMAT.format(date);
}

/**
 * The phone due row: `formatDueLabel`, with ", d MMM" appended for Today,
 * Yesterday and Tomorrow ("Today, 18 Oct"); "No date" when empty.
 */
export function formatDueDetail(
  dueDate: string | undefined,
  today: string,
): string {
  if (!dueDate) return 'No date';
  const label = formatDueLabel(dueDate, today);
  if (label !== 'Today' && label !== 'Yesterday' && label !== 'Tomorrow') {
    return label;
  }
  const date = new Date(`${dueDate}T00:00:00`);
  return `${label}, ${DAY_MONTH_FORMAT.format(date)}`;
}

export interface TaskSaveCopy {
  text: string;
  textClassName: string;
  dotClassName: string;
}

/**
 * The save indicator line. `desktop` appends "created {d MMM}" to the saved
 * text; `phone` shows "Saved" alone. Colour is never the only cue: the words
 * always carry the state.
 */
export function taskSaveCopy(
  saveState: TaskSaveState,
  variant: TaskLayoutVariant,
  createdAt: string,
): TaskSaveCopy {
  if (saveState === 'saving') {
    return {
      text: 'Saving…',
      textClassName: 'text-muted-foreground',
      dotClassName: 'bg-muted-foreground',
    };
  }
  if (saveState === 'error') {
    return {
      text: 'Not saved',
      textClassName: 'text-destructive-text',
      dotClassName: 'bg-destructive',
    };
  }
  const created = variant === 'desktop' ? formatCreatedDate(createdAt) : '';
  return {
    text: created ? `Saved · created ${created}` : 'Saved',
    textClassName: 'text-trust-text',
    dotClassName: 'bg-trust',
  };
}
