'use client';

import type { AdminAuditLogEntry } from '@myorganiser/app-api-client';
import { cn } from '@myorganiser/web-ui';
import Link from 'next/link';

import { ADMIN_SECTIONS } from '../../lib/adminNav';
import { auditParty, type AuditPartySide } from '../../lib/auditLog';

export interface AuditPartyNameProps {
  entry: AdminAuditLogEntry;
  side: AuditPartySide;
  /** Styling for the name. A deleted party is always muted, whatever is passed. */
  className?: string;
}

/**
 * The acting or affected User of an entry. A live User is a link to their
 * detail page; a deleted one is plain muted text.
 */
export function AuditPartyName({
  entry,
  side,
  className,
}: AuditPartyNameProps) {
  const party = auditParty(entry, side);

  if (party.userId === null || party.deleted) {
    return (
      <span className={cn(className, 'text-muted-foreground')}>
        {party.name}
      </span>
    );
  }

  return (
    <Link
      href={`${ADMIN_SECTIONS.users.url}/${party.userId}`}
      className={cn('hover:underline', className)}
    >
      {party.name}
    </Link>
  );
}
