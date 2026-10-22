'use client';

import { Illustration } from '@myorganiser/web-ui';
import type { ReactNode } from 'react';

import type { AuditLogVariant } from '../../lib/auditLog';

export interface AuditLogHeaderProps {
  variant: AuditLogVariant;
  /** Phone places the Filters trigger here, at the end of the title row. */
  children?: ReactNode;
}

/**
 * The Audit log title row. The one h1 for every width. Desktop adds the
 * subtitle; phone puts `children` at the row's end, on the same line.
 */
export function AuditLogHeader({ variant, children }: AuditLogHeaderProps) {
  const isPhone = variant === 'phone';

  return (
    <div className="flex items-center gap-3 md:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3 md:gap-4">
        {/* IllustrationSize has no 44, so the phone uses the 48 step. */}
        <Illustration kind="audit" size={isPhone ? 48 : 64} />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-display text-foreground">
            Audit log
          </h1>
          {isPhone ? null : (
            <p className="text-body-sm text-muted-foreground">
              Every admin action, newest first. Entries can&apos;t be edited or
              removed.
            </p>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}
