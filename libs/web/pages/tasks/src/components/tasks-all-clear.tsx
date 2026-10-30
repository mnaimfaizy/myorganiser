import { Button, Illustration } from '@myorganiser/web-ui';

/** Shared with `TasksFilteredEmpty`: the two board-level in-list empty states. */
export const TASKS_EMPTY_PHONE_WRAPPER =
  'flex flex-1 flex-col items-center justify-center gap-3 px-8 pb-30 text-center';
export const TASKS_EMPTY_DESKTOP_CARD =
  'flex flex-col items-center gap-3 rounded-panel border border-border bg-raised-surface px-6 py-12 text-center';
export const TASKS_EMPTY_ACTION_ROW =
  'mt-1.5 flex flex-wrap justify-center gap-2.5';

interface TasksAllClearProps {
  /** Tasks done this week, for the sentence under the heading. */
  doneThisWeek: number;
  onShowDone: () => void;
  /** Desktop only: the brand Add button. Omitted when there is no add action. */
  onAddTask?: () => void;
  variant: 'desktop' | 'phone';
}

function nothingOpenSentence(doneThisWeek: number): string {
  if (doneThisWeek === 0) {
    return 'Nothing open.';
  }
  const noun = doneThisWeek === 1 ? 'task' : 'tasks';
  return `Nothing open. ${doneThisWeek} ${noun} done this week.`;
}

/**
 * The empty state when no Task is open. Desktop is a bordered card with
 * Show done and Add task; phone is a centred column with a single Show done.
 * The illustration is decorative, so the heading and sentence carry the state.
 */
const TasksAllClear = ({
  doneThisWeek,
  onShowDone,
  onAddTask,
  variant,
}: TasksAllClearProps) => {
  const sentence = nothingOpenSentence(doneThisWeek);

  if (variant === 'phone') {
    return (
      <div className={TASKS_EMPTY_PHONE_WRAPPER}>
        <Illustration kind="tasks" size={96} />
        <h2 className="m-0 font-display text-title text-foreground">
          All clear
        </h2>
        <p className="text-body-sm text-foreground-supporting">{sentence}</p>
        <Button variant="secondary" onClick={onShowDone}>
          Show done
        </Button>
      </div>
    );
  }

  return (
    <div className={TASKS_EMPTY_DESKTOP_CARD}>
      <Illustration kind="tasks" size={112} />
      <h2 className="m-0 font-display text-title-lg text-foreground">
        All clear
      </h2>
      <p className="text-body text-foreground-supporting">{sentence}</p>
      <div className={TASKS_EMPTY_ACTION_ROW}>
        <Button variant="outline" onClick={onShowDone}>
          Show done
        </Button>
        {onAddTask ? (
          <Button variant="brand" onClick={onAddTask}>
            Add task
          </Button>
        ) : null}
      </div>
    </div>
  );
};

export { TasksAllClear };
export type { TasksAllClearProps };
