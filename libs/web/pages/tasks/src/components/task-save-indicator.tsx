import type { TaskSaveState } from '../hooks/use-task-detail-draft';
import { taskSaveCopy } from '../utils/task-detail-copy';

export interface TaskSaveIndicatorProps {
  saveState: TaskSaveState;
  createdAt: string;
  /** Desktop appends "created {d MMM}" to the saved text; phone shows "Saved". */
  variant: 'desktop' | 'phone';
}

/** The polite live line that reports the save state of a Task detail view. */
export function TaskSaveIndicator({
  saveState,
  createdAt,
  variant,
}: TaskSaveIndicatorProps) {
  const copy = taskSaveCopy(saveState, variant, createdAt);
  const sizeClassName = variant === 'desktop' ? 'text-body-sm' : 'text-caption';
  return (
    <p
      aria-live="polite"
      className={`flex items-center gap-1.5 ${sizeClassName} ${copy.textClassName}`}
    >
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${copy.dotClassName}`}
      />
      {copy.text}
    </p>
  );
}
