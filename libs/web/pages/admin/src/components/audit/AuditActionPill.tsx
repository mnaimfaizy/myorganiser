'use client';

import type { AdminAuditAction } from '@myorganiser/app-api-client';
import { cn, StatusPill } from '@myorganiser/web-ui';

import type { AuditLogVariant } from '../../lib/auditLog';
import { formatAuditAction } from '../../lib/formatAuditLog';
import { AUDIT_ACTION_TONE } from '../../lib/overview';

export interface AuditActionPillProps {
  action: AdminAuditAction;
  variant: AuditLogVariant;
  /** Extra classes, merged last. The Overview adds its own centring this way. */
  className?: string;
}

/**
 * The action as a status pill. Desktop keeps the label's own case, as the
 * artboard does. Phone uses the small pill and its uppercase caps.
 */
export function AuditActionPill({
  action,
  variant,
  className,
}: AuditActionPillProps) {
  const isPhone = variant === 'phone';

  return (
    <StatusPill
      tone={AUDIT_ACTION_TONE[action]}
      size={isPhone ? 'sm' : 'default'}
      className={cn(
        isPhone ? 'shrink-0' : 'normal-case justify-self-start',
        className,
      )}
    >
      {formatAuditAction(action)}
    </StatusPill>
  );
}
