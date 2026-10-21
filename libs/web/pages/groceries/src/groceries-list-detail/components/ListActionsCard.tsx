'use client';

import { Button, Separator } from '@myorganiser/web-ui';

interface ListActionsCardProps {
  onRename: () => void;
  onAddToMultipleLists: () => void;
  onDeleteList: () => void;
}

/** Whole-list actions: rename, add to several lists, and delete the list. */
export function ListActionsCard({
  onRename,
  onAddToMultipleLists,
  onDeleteList,
}: ListActionsCardProps) {
  return (
    <section className="flex flex-col gap-0.5 rounded-panel border border-border bg-card p-2">
      <h2 className="px-2.5 pt-2 pb-1.5 text-label-caps text-muted-foreground">
        LIST ACTIONS
      </h2>
      <Button
        variant="ghost"
        className="min-h-11 w-full justify-start px-2.5"
        onClick={onRename}
      >
        Rename list
      </Button>
      <Button
        variant="ghost"
        className="min-h-11 w-full justify-start px-2.5"
        onClick={onAddToMultipleLists}
      >
        Add to multiple lists…
      </Button>
      <Separator className="my-1.5" />
      <Button
        variant="ghost"
        className="min-h-11 w-full justify-start px-2.5 font-semibold text-destructive-text"
        onClick={onDeleteList}
      >
        Delete Grocery List…
      </Button>
    </section>
  );
}
