'use client';

import { Button } from '@myorganiser/web-ui';

export interface TaskDetailFooterProps {
  variant: 'desktop' | 'phone';
  archived: boolean;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
}

/**
 * The two footer actions of a Task detail view: archive (or restore) and
 * delete. Desktop sits on a top rule; phone is a 2-column row pushed to the
 * bottom of the screen.
 */
export function TaskDetailFooter({
  variant,
  archived,
  onArchive,
  onUnarchive,
  onDelete,
}: TaskDetailFooterProps) {
  const archiveLabel = archived ? 'Restore from archive' : 'Archive';
  const archiveAction = archived ? onUnarchive : onArchive;

  if (variant === 'phone') {
    return (
      <div className="mx-4 mt-auto grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          className="h-12 min-w-0 whitespace-normal px-2"
          onClick={archiveAction}
        >
          {archiveLabel}
        </Button>
        <Button
          variant="outline"
          className="h-12 min-w-0 border-destructive-edge px-2 text-destructive-text hover:bg-destructive-soft"
          onClick={onDelete}
        >
          Delete…
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5 border-t border-border pt-3">
      <Button
        variant="outline"
        className="h-auto min-w-0 flex-1 whitespace-normal px-3 py-2.5"
        onClick={archiveAction}
      >
        {archiveLabel}
      </Button>
      <Button
        variant="outline"
        className="min-w-0 flex-1 border-destructive-edge px-3 text-destructive-text hover:bg-destructive-soft"
        onClick={onDelete}
      >
        Delete…
      </Button>
    </div>
  );
}
