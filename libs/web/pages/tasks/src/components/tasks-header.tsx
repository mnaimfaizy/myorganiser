'use client';

import { Plus } from 'lucide-react';
import { Button, Illustration } from '@myorganiser/web-ui';

interface TasksHeaderProps {
  /** The line under the title, from `formatTaskSummary`. */
  summary: string;
  onAddTask: () => void;
  /** Desktop shows the illustration, title, and Add button; phone shows the summary only. */
  variant: 'desktop' | 'phone';
}

/**
 * The Tasks page heading. On phone the app shell already draws the large
 * title and illustration, so the `<h1>` is kept for the document outline but
 * visually hidden, and the page's FAB replaces the Add button.
 */
const TasksHeader = ({ summary, onAddTask, variant }: TasksHeaderProps) => {
  if (variant === 'phone') {
    return (
      <div className="px-4">
        <h1 className="sr-only">Tasks</h1>
        <p className="text-body-sm text-muted-foreground">{summary}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Illustration kind="tasks" size={64} />
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="m-0 font-display text-title-lg text-foreground">
          Tasks
        </h1>
        <p className="text-body text-muted-foreground">{summary}</p>
      </div>
      <Button variant="brand" onClick={onAddTask}>
        <Plus aria-hidden="true" />
        Add task
      </Button>
    </div>
  );
};

export { TasksHeader };
export type { TasksHeaderProps };
