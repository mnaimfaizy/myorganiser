'use client';

import { Plus } from 'lucide-react';

export interface NewListTileProps {
  onNewList: () => void;
}

/** The dashed tile that closes the desktop lists grid and opens Create List. */
export function NewListTile({ onNewList }: NewListTileProps) {
  return (
    <button
      type="button"
      onClick={onNewList}
      className="flex min-h-65 flex-col items-center justify-center gap-2.5 rounded-panel border-2 border-dashed border-border-strong text-foreground-secondary transition-colors hover:bg-muted"
    >
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-menu bg-brand-soft"
      >
        <Plus className="size-5 text-brand-text-strong" />
      </span>
      <span className="font-semibold text-body-sm text-foreground">
        New list
      </span>
      <span className="text-caption">For the next shop or an occasion</span>
    </button>
  );
}
