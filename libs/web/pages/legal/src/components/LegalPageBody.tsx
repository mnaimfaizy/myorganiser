import { cn } from '@myorganiser/web-ui';
import type { ReactNode } from 'react';
import type { LegalSectionEntry } from '../lib/legal-sections';
import { LEGAL_CONTENT_WIDTH } from '../lib/legal-styles';

export interface LegalPageBodyProps {
  /** Renders the "On this page" card when given and not empty. */
  toc?: ReadonlyArray<LegalSectionEntry>;
  children: ReactNode;
}

/** Content column with the optional "On this page" card beside it. */
export function LegalPageBody({ toc, children }: LegalPageBodyProps) {
  return (
    <main
      className={cn(
        LEGAL_CONTENT_WIDTH,
        'flex flex-wrap items-start gap-8 px-6 pb-12 pt-8',
      )}
    >
      {toc && toc.length > 0 && (
        <nav
          aria-label="On this page"
          className="flex min-w-[220px] flex-[0_1_240px] flex-col gap-0.5 rounded-panel border border-border bg-card p-4"
        >
          <span className="px-2.5 pb-1.5 text-label-caps uppercase text-muted-foreground">
            On this page
          </span>
          {toc.map((entry) => (
            <a
              key={entry.id}
              href={`#${entry.id}`}
              className="block rounded-control px-2.5 py-2 text-body-sm font-medium text-foreground-secondary hover:bg-muted"
            >
              {entry.title}
            </a>
          ))}
        </nav>
      )}
      <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-4">
        {children}
      </div>
    </main>
  );
}
