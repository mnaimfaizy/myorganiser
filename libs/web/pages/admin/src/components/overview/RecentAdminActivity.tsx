'use client';

import type { AdminAuditLogEntry } from '@myorganiser/app-api-client';
import { StatusPill } from '@myorganiser/web-ui';
import Link from 'next/link';
import * as React from 'react';

import { createPlatformAdminApi } from '../../lib/apiClient';
import { ADMIN_SECTIONS } from '../../lib/adminNav';
import { auditParty } from '../../lib/auditLog';
import {
  formatAuditAction,
  formatAuditTimestamp,
} from '../../lib/formatAuditLog';
import { AUDIT_ACTION_TONE } from '../../lib/overview';
import { AuditPartyName } from '../audit/AuditPartyName';

const RECENT_PAGE_SIZE = 5;

/**
 * The newest admin audit entries on the desktop Overview. It fetches its own
 * five entries; the shell's single overview request does not cover it. Parties
 * are shown by name, as the Audit log page shows them; a deleted User reads
 * "Deleted user".
 */
export function RecentAdminActivity() {
  const headingId = React.useId();
  const [entries, setEntries] = React.useState<AdminAuditLogEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    createPlatformAdminApi()
      .listAuditLogs({ pageSize: RECENT_PAGE_SIZE })
      .then((response) => {
        if (cancelled) return;
        setEntries(response.data.entries);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section
      aria-labelledby={headingId}
      className="hidden flex-col gap-3 md:flex"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="font-display text-title text-foreground">
          Recent admin activity
        </h2>
        <Link
          href={ADMIN_SECTIONS.audit.url}
          className="text-body-sm font-semibold text-brand-text hover:underline"
        >
          Audit log
        </Link>
      </div>
      {loading ? (
        <p role="status" className="sr-only">
          Loading…
        </p>
      ) : null}
      {!loading && error ? (
        <p className="text-body-sm text-error-text">
          Unable to load audit log. Please try again.
        </p>
      ) : null}
      {!loading && !error && entries.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">
          No audit log entries yet.
        </p>
      ) : null}
      {!loading && !error && entries.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-raised-surface">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
            >
              <StatusPill
                size="sm"
                tone={AUDIT_ACTION_TONE[entry.action]}
                className="min-w-24 justify-center text-center normal-case"
              >
                {formatAuditAction(entry.action)}
              </StatusPill>
              <div className="flex min-w-0 flex-1 flex-col">
                <AuditPartyName
                  entry={entry}
                  side="target"
                  className="block min-w-0 truncate text-body-sm font-medium text-brand-text"
                />
                <span className="truncate text-caption text-muted-foreground">
                  {`by ${auditParty(entry, 'actor').name}`}
                </span>
              </div>
              <time
                dateTime={entry.createdAt}
                className="shrink-0 text-caption text-muted-foreground"
              >
                {formatAuditTimestamp(entry.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
