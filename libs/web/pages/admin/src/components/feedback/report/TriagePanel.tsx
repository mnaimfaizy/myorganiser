'use client';

import { type ReactNode, useId } from 'react';

export interface TriagePanelProps {
  children: ReactNode;
}

/**
 * The Triage shell. Desktop is a card with a navy heading bar and its sections
 * stacked behind dividers. Phone drops the card: the heading becomes a small
 * caption and each section stands as its own card. One DOM serves both, so the
 * breakpoint is only a matter of classes.
 */
export function TriagePanel({ children }: TriagePanelProps) {
  const headingId = useId();

  return (
    <aside
      aria-labelledby={headingId}
      className="flex flex-col gap-3 md:basis-[340px] md:max-w-[400px] md:flex-1 md:gap-0 md:overflow-hidden md:rounded-panel md:border md:border-border md:bg-raised-surface"
    >
      <h2
        id={headingId}
        className="text-label-caps uppercase text-muted-foreground md:bg-navy md:px-5 md:py-4 md:font-display md:text-body md:font-bold md:normal-case md:text-navy-foreground"
      >
        Triage
      </h2>
      {children}
    </aside>
  );
}
