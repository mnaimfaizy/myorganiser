import type { AdminAuditLogEntry } from '@myorganiser/app-api-client';
import { cn } from '@myorganiser/web-ui';
import type { ReactNode } from 'react';

import { AUDIT_LOG_MESSAGES, formatAuditWhen } from '../../lib/auditLog';
import { AuditActionPill } from './AuditActionPill';
import { AuditPartyName } from './AuditPartyName';

export interface AuditLogTableProps {
  entries: AdminAuditLogEntry[];
  loading: boolean;
  error: boolean;
  /** Shown when there are no rows and no error. */
  emptyMessage: string;
  /** The pager, rendered under the rows. */
  footer?: ReactNode;
  label?: string;
}

const ROW_GRID =
  'grid grid-cols-[150px_140px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-4 px-5';

/**
 * The desktop audit log, drawn as a card of grid rows. Rows are not links, so
 * each name is its own link. Every cell's sr-only prefix makes a row read as
 * a sentence.
 */
export function AuditLogTable({
  entries,
  loading,
  error,
  emptyMessage,
  footer,
  label = 'Audit entries',
}: AuditLogTableProps) {
  // The last row's border separates the pager below it. With no footer it
  // would sit against the card's bottom edge, so it is dropped there.
  const rowBorder = footer
    ? 'border-b border-border-subtle'
    : 'border-b border-border-subtle last:border-b-0';

  return (
    <section
      aria-label={label}
      className="overflow-hidden rounded-panel border border-border bg-raised-surface"
    >
      <div
        aria-hidden="true"
        className={cn(
          ROW_GRID,
          'border-b border-border bg-subtle py-3 text-label-caps text-muted-foreground',
        )}
      >
        <span>WHEN</span>
        <span>ACTION</span>
        <span>DONE BY</span>
        <span>USER</span>
      </div>
      {loading ? (
        <p className="px-5 py-6 text-body-sm text-muted-foreground">
          {AUDIT_LOG_MESSAGES.loading}
        </p>
      ) : error ? (
        <p className="px-5 py-6 text-body-sm text-destructive">
          {AUDIT_LOG_MESSAGES.error}
        </p>
      ) : entries.length === 0 ? (
        <p className="px-5 py-6 text-body-sm text-muted-foreground">
          {emptyMessage}
        </p>
      ) : (
        <ul>
          {entries.map((entry) => (
            <li key={entry.id} className={cn(ROW_GRID, rowBorder, 'py-3')}>
              <time
                dateTime={entry.createdAt}
                className="text-body-sm text-muted-foreground"
              >
                {formatAuditWhen(entry.createdAt)}
              </time>
              <AuditActionPill action={entry.action} variant="desktop" />
              <span className="flex min-w-0 text-body-sm">
                <span className="sr-only">Done by </span>
                <AuditPartyName
                  entry={entry}
                  side="actor"
                  className="min-w-0 truncate font-semibold text-foreground"
                />
              </span>
              <span className="flex min-w-0 text-body-sm">
                <span className="sr-only">User </span>
                <AuditPartyName
                  entry={entry}
                  side="target"
                  className="min-w-0 truncate text-brand-text"
                />
              </span>
            </li>
          ))}
        </ul>
      )}
      {footer}
    </section>
  );
}
