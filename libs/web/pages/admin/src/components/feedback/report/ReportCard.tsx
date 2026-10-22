import { cn } from '@myorganiser/web-ui';
import type { ReactNode } from 'react';

import { REPORT_HEADING_CLASS_NAME } from '../../../lib/feedbackReportView';

export interface ReportCardProps {
  /** The card's heading. Each card is one labelled section. */
  title: string;
  /** Follow-up is tinted brand so the reporter's own addition reads apart. */
  tinted?: boolean;
  children: ReactNode;
}

/** A titled card in the reading column. Phone and desktop differ by breakpoint only. */
export function ReportCard({
  title,
  tinted = false,
  children,
}: ReportCardProps) {
  return (
    <section
      className={cn(
        'flex flex-col gap-2 rounded-xl border border-border bg-raised-surface px-4 py-3.5 md:gap-2.5 md:rounded-panel md:px-5 md:py-5',
        tinted && 'border-brand/30 bg-brand-soft/40',
      )}
    >
      <h2 className={REPORT_HEADING_CLASS_NAME}>{title}</h2>
      {children}
    </section>
  );
}
