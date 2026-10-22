import type { ReactNode } from 'react';

import { REPORT_HEADING_CLASS_NAME } from '../../../lib/feedbackReportView';

export interface TriageSectionProps {
  /** The action's heading. Omit it for a notice that belongs to no action. */
  title?: string;
  children: ReactNode;
}

/**
 * One block of the Triage panel. Phone: a card. Desktop: a section separated
 * from its neighbours by a divider inside the panel card.
 */
export function TriageSection({ title, children }: TriageSectionProps) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-raised-surface px-4 py-3.5 md:gap-2.5 md:rounded-none md:border-x-0 md:border-t-0 md:border-b md:border-border-subtle md:bg-transparent md:px-5 md:py-4 md:last:border-b-0">
      {title ? <h3 className={REPORT_HEADING_CLASS_NAME}>{title}</h3> : null}
      {children}
    </section>
  );
}
