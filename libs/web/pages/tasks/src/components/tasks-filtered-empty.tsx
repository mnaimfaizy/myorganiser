import { Button } from '@myorganiser/web-ui';

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
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 pb-30 text-center">
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
    <div className="flex flex-col items-center gap-3 rounded-panel border border-border bg-raised-surface px-6 py-12 text-center">
      <p className="text-body text-foreground-supporting">
        No tasks match these filters.
      </p>
      <div className="mt-1.5 flex flex-wrap justify-center gap-2.5">
        <Button variant="outline" onClick={onClearFilters}>
          Clear filters
        </Button>
      </div>
    </div>
  );
};

export { TasksFilteredEmpty };
export type { TasksFilteredEmptyProps };
