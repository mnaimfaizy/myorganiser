import type * as React from 'react';
import { cn } from '@myorganiser/web-ui';
import type { TaskDueGroup } from '../workflow/task-grouping';

export type TaskGroupTone = 'danger' | 'warning' | 'neutral';

/** The display name and heading tone of each due group, one row per group. */
export const TASK_GROUP_META = {
  overdue: { name: 'Overdue', tone: 'danger' },
  today: { name: 'Today', tone: 'warning' },
  upcoming: { name: 'Upcoming', tone: 'neutral' },
  no_date: { name: 'No date', tone: 'neutral' },
} as const satisfies Record<
  TaskDueGroup,
  { name: string; tone: TaskGroupTone }
>;

const HEADING_TONE = {
  danger: 'text-destructive-text',
  warning: 'text-warning-text',
  neutral: 'text-foreground-supporting',
} as const satisfies Record<TaskGroupTone, string>;

interface TaskGroupSectionProps {
  /** The accessible name of the section, for example "Overdue". */
  name: string;
  /** The visible heading, for example "Overdue · 1". */
  label: string;
  tone: TaskGroupTone;
  variant: 'desktop' | 'phone';
  children: React.ReactNode;
}

/**
 * One due group: an uppercase heading over a bordered card of rows. Phone
 * puts the heading on a 36px line inset 16px, and the card sits 16px in from
 * each edge.
 */
const TaskGroupSection = ({
  name,
  label,
  tone,
  variant,
  children,
}: TaskGroupSectionProps) => {
  const isPhone = variant === 'phone';

  return (
    <section
      aria-label={name}
      className={cn('flex flex-col', !isPhone && 'gap-2')}
    >
      <h2
        className={cn(
          'text-label-caps font-semibold uppercase',
          HEADING_TONE[tone],
          isPhone && 'flex h-9 items-end px-4 pb-2',
        )}
      >
        {label}
      </h2>
      <div
        className={cn(
          'overflow-hidden rounded-xl border border-border bg-raised-surface',
          isPhone ? 'mx-4' : 'flex flex-col',
        )}
      >
        {children}
      </div>
    </section>
  );
};

export { TaskGroupSection };
export type { TaskGroupSectionProps };
