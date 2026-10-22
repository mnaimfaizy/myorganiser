'use client';

import type { AdminAuditLogEntry } from '@myorganiser/app-api-client';
import { cn } from '@myorganiser/web-ui';
import Link from 'next/link';
import { useId } from 'react';

import { useAuditLog } from '../../hooks/use-audit-log';
import { ADMIN_SECTIONS } from '../../lib/adminNav';
import { AUDIT_LOG_MESSAGES, formatAuditWhen } from '../../lib/auditLog';
import {
  RECENT_ACTIVITY_EMPTY,
  RECENT_ACTIVITY_LIMIT,
  type UserDetailVariant,
} from '../../lib/userDetail';
import { AuditActionPill } from '../audit/AuditActionPill';
import { AuditPartyName } from '../audit/AuditPartyName';

export interface UserRecentActivityProps {
  userId: string;
  variant: UserDetailVariant;
}

/**
 * The User's latest audit entries: the log filtered to this User as actor or
 * target. The full log is one link away.
 */
export function UserRecentActivity({
  userId,
  variant,
}: UserRecentActivityProps) {
  const headingId = useId();
  const { entries, loading, error } = useAuditLog({ mode: 'pages', userId });
  const recent = entries.slice(0, RECENT_ACTIVITY_LIMIT);
  const isPhone = variant === 'phone';

  const body = loading ? (
    <p role="status" className={bodyClass(isPhone, 'text-muted-foreground')}>
      {AUDIT_LOG_MESSAGES.loading}
    </p>
  ) : error ? (
    <p className={bodyClass(isPhone, 'text-destructive')}>
      {AUDIT_LOG_MESSAGES.error}
    </p>
  ) : recent.length === 0 ? (
    <p className={bodyClass(isPhone, 'text-muted-foreground')}>
      {RECENT_ACTIVITY_EMPTY}
    </p>
  ) : (
    <ul>
      {recent.map((entry) => (
        <ActivityRow
          key={entry.id}
          entry={entry}
          userId={userId}
          variant={variant}
        />
      ))}
    </ul>
  );

  if (isPhone) {
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
        <h2
          id={headingId}
          className="text-label-caps uppercase text-muted-foreground"
        >
          Recent activity
        </h2>
        <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-raised-surface">
          {body}
        </div>
        <div className="flex justify-end">
          <Link
            href={ADMIN_SECTIONS.audit.url}
            className="inline-flex min-h-11 items-center text-body-sm font-semibold text-brand-text hover:underline"
          >
            Full audit log
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col rounded-panel border border-border bg-raised-surface"
    >
      <header className="flex items-center gap-4 px-6 pt-5 pb-2">
        <h2
          id={headingId}
          className="min-w-0 flex-1 font-display text-title text-foreground"
        >
          Recent activity
        </h2>
        <Link
          href={ADMIN_SECTIONS.audit.url}
          className="text-body-sm font-semibold text-brand-text hover:underline"
        >
          Full audit log
        </Link>
      </header>
      {body}
    </section>
  );
}

function bodyClass(isPhone: boolean, tone: string): string {
  return cn(isPhone ? 'px-4' : 'px-6', 'py-4 text-body-sm', tone);
}

interface ActivityRowProps {
  entry: AdminAuditLogEntry;
  userId: string;
  variant: UserDetailVariant;
}

/**
 * One audit entry. When this User acted on someone else, the affected User
 * follows an arrow. Otherwise the row would hide who the action touched.
 */
function ActivityRow({ entry, userId, variant }: ActivityRowProps) {
  const isPhone = variant === 'phone';
  const affectsOther =
    entry.targetUserId !== null && entry.targetUserId !== userId;

  const party = (
    <>
      {isPhone ? null : 'by '}
      <AuditPartyName entry={entry} side="actor" />
      {affectsOther ? (
        <>
          <span aria-hidden="true"> → </span>
          <span className="sr-only"> to </span>
          <AuditPartyName entry={entry} side="target" />
        </>
      ) : null}
    </>
  );

  const when = (
    <time
      dateTime={entry.createdAt}
      className="shrink-0 text-caption text-muted-foreground"
    >
      {formatAuditWhen(entry.createdAt)}
    </time>
  );

  if (isPhone) {
    return (
      <li className="flex min-h-12 items-center gap-2.5 border-b border-border-subtle px-4 last:border-b-0">
        <AuditActionPill action={entry.action} variant="phone" />
        <span className="min-w-0 flex-1 break-words text-body-sm">{party}</span>
        {when}
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3.5 border-t border-border-subtle px-6 py-3">
      <AuditActionPill
        action={entry.action}
        variant="desktop"
        className="min-w-30 justify-center"
      />
      <span className="min-w-0 flex-1 text-body-sm">{party}</span>
      {when}
    </li>
  );
}
