'use client';

import { cn, SegmentedControl } from '@myorganiser/web-ui';
import type { SegmentedControlOption } from '@myorganiser/web-ui';
import { useCallback } from 'react';
import { ChoiceChip } from './choice-chip';

export type TaskContextFilter = 'all' | 'personal' | 'work';

export type TaskStatusFilter =
  | 'open'
  | 'in_progress'
  | 'blocked'
  | 'done'
  | 'archived';

interface TaskFiltersCounts {
  open: number;
  inProgress: number;
  blocked: number;
}

interface TaskFiltersProps {
  context: TaskContextFilter;
  onContextChange: (next: TaskContextFilter) => void;
  status: TaskStatusFilter;
  onStatusChange: (next: TaskStatusFilter) => void;
  counts: TaskFiltersCounts;
  variant: 'desktop' | 'phone';
}

/** The chip label for each status filter; the counts come from the parent. */
const STATUS_CHIPS = {
  open: ({ open }: TaskFiltersCounts) => `Open · ${open}`,
  in_progress: ({ inProgress }: TaskFiltersCounts) =>
    `In progress · ${inProgress}`,
  blocked: ({ blocked }: TaskFiltersCounts) => `Blocked · ${blocked}`,
  done: () => 'Done',
  archived: () => 'Archived',
} as const satisfies Record<
  TaskStatusFilter,
  (counts: TaskFiltersCounts) => string
>;

/** The status chips in display order. */
const STATUS_VALUES = Object.keys(STATUS_CHIPS) as TaskStatusFilter[];

const CONTEXT_OPTIONS: readonly SegmentedControlOption<TaskContextFilter>[] = [
  { value: 'all', label: 'All' },
  { value: 'personal', label: 'Personal' },
  { value: 'work', label: 'Work' },
];

/**
 * Context segmented control and single-select status chips. The legend is
 * kept for screen readers and hidden visually, as the artboards show none.
 *
 * Pressing the chip that is already pressed re-sends its own status. The
 * parent's setter gets the same value, so state does not change.
 */
const TaskFilters = ({
  context,
  onContextChange,
  status,
  onStatusChange,
  counts,
  variant,
}: TaskFiltersProps) => {
  const isDesktop = variant === 'desktop';

  const handleStatusPress = useCallback(
    (next: TaskStatusFilter) => {
      onStatusChange(next);
    },
    [onStatusChange],
  );

  return (
    <div
      className={cn(
        isDesktop ? 'flex flex-wrap items-center gap-3' : 'flex flex-col gap-3',
      )}
    >
      <div className={cn(isDesktop ? 'w-75 shrink-0' : 'px-4')}>
        <SegmentedControl
          name="task-context"
          legend="Context"
          options={CONTEXT_OPTIONS}
          value={context}
          onValueChange={onContextChange}
          className="gap-0 [&>legend]:sr-only"
        />
      </div>
      <div
        role="group"
        aria-label="Status"
        className={cn(
          'flex gap-2',
          isDesktop ? 'flex-wrap' : 'overflow-x-auto px-4 pb-1',
        )}
      >
        {STATUS_VALUES.map((value) => (
          <ChoiceChip
            key={value}
            pressed={status === value}
            onPressedChange={() => handleStatusPress(value)}
          >
            {STATUS_CHIPS[value](counts)}
          </ChoiceChip>
        ))}
      </div>
    </div>
  );
};

export { TaskFilters };
export type { TaskFiltersProps };
