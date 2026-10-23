import { cn } from '@myorganiser/web-ui';
import type { ReactNode } from 'react';
import type { LegalVariant } from '../lib/legal-sections';
import { LEGAL_NUMBER_BADGE } from '../lib/legal-styles';

export interface LegalSectionProps {
  /** Anchor id on the page variant. Not rendered in the dialog. */
  id: string;
  title: string;
  variant: LegalVariant;
  /** Page variant only: shown in a badge before the title, hidden from assistive tech. */
  number?: string;
  /** Dialog variant only: extra classes on the section, for the Terms stack spacing. */
  className?: string;
  children: ReactNode;
}

/**
 * One section of a legal document. The page variant is a numbered card with an
 * anchor; the dialog variant is the plain heading and paragraphs it has always been.
 */
export function LegalSection({
  id,
  title,
  variant,
  number,
  className,
  children,
}: LegalSectionProps) {
  if (variant === 'dialog') {
    return (
      <section className={cn('mt-6', className)}>
        <h3 className="text-base font-semibold">{title}</h3>
        {children}
      </section>
    );
  }

  return (
    <section
      id={id}
      aria-labelledby={`h-${id}`}
      className="flex flex-col gap-3 rounded-panel border border-border bg-card px-7 py-6"
    >
      <h2
        id={`h-${id}`}
        className="flex items-center gap-3 font-display text-title text-foreground"
      >
        {number && (
          <span aria-hidden="true" className={LEGAL_NUMBER_BADGE}>
            {number}
          </span>
        )}
        {title}
      </h2>
      {children}
    </section>
  );
}
