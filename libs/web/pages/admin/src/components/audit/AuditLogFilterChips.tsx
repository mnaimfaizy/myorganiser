'use client';

import type { AdminAuditAction } from '@myorganiser/app-api-client';
import { X } from 'lucide-react';

import type { AuditLogUserFilter } from '../../lib/auditLog';
import { formatAuditAction } from '../../lib/formatAuditLog';

export interface AuditLogFilterChipsProps {
  actions: AdminAuditAction[];
  user: AuditLogUserFilter | undefined;
  onToggleAction: (action: AdminAuditAction) => void;
  onUserChange: (next: AuditLogUserFilter | undefined) => void;
}

interface AuditLogFilterChipProps {
  label: string;
  onRemove: () => void;
}

/** One active filter. Its × removes that filter alone. */
function AuditLogFilterChip({ label, onRemove }: AuditLogFilterChipProps) {
  return (
    <span className="inline-flex h-8 shrink-0 items-center gap-2 rounded-full bg-brand-soft pl-3 pr-1.5 text-caption font-semibold text-brand-text">
      {label}
      <button
        type="button"
        aria-label={`Remove filter ${label}`}
        onClick={onRemove}
        className="inline-flex size-6 items-center justify-center rounded-full text-brand-text transition-colors hover:bg-ghost-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </span>
  );
}

/**
 * One removable chip per active filter: each action by its label, then the
 * user by name. Renders nothing when no filter is set.
 */
export function AuditLogFilterChips({
  actions,
  user,
  onToggleAction,
  onUserChange,
}: AuditLogFilterChipsProps) {
  if (actions.length === 0 && user === undefined) return null;

  return (
    <ul
      aria-label="Active filters"
      className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {actions.map((action) => (
        <li key={action}>
          <AuditLogFilterChip
            label={formatAuditAction(action)}
            onRemove={() => onToggleAction(action)}
          />
        </li>
      ))}
      {user !== undefined ? (
        <li>
          <AuditLogFilterChip
            label={user.name}
            onRemove={() => onUserChange(undefined)}
          />
        </li>
      ) : null}
    </ul>
  );
}
