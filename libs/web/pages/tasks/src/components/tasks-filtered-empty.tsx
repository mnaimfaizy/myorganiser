import { Button } from '@myorganiser/web-ui';

import {
  TASKS_EMPTY_ACTION_ROW,
  TASKS_EMPTY_DESKTOP_CARD,
  TASKS_EMPTY_PHONE_WRAPPER,
} from './tasks-all-clear';

interface TasksFilteredEmptyProps {
  /** Resets the status filter to Open and the context filter to All. */
  onClearFilters: () => void;
  variant: 'desktop' | 'phone';
}

/**
 * The in-list empty state when the current status chip and context filter
 * together match zero Tasks. Desktop is a bordered card; phone is a centred
 * column. One action clears the filters. Unlike TasksAllClear there is no
 * illustration or heading, only the message and the action.
 */
const TasksFilteredEmpty = ({
  onClearFilters,
  variant,
}: TasksFilteredEmptyProps) => {
  if (variant === 'phone') {
    return (
      <div className={TASKS_EMPTY_PHONE_WRAPPER}>
        <p className="text-body-sm text-foreground-supporting">
          No tasks match these filters.
        </p>
        <Button variant="secondary" onClick={onClearFilters}>
          Clear filters
        </Button>
      </div>
    );
  }

  return (
    <div className={TASKS_EMPTY_DESKTOP_CARD}>
      <p className="text-body text-foreground-supporting">
        No tasks match these filters.
      </p>
      <div className={TASKS_EMPTY_ACTION_ROW}>
        <Button variant="outline" onClick={onClearFilters}>
          Clear filters
        </Button>
      </div>
    </div>
  );
};

export { TasksFilteredEmpty };
export type { TasksFilteredEmptyProps };
