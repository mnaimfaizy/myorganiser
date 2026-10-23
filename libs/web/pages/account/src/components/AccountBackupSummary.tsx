'use client';

import { Illustration, Skeleton } from '@myorganiser/web-ui';
import Link from 'next/link';
import { useState } from 'react';

import { type AccountVariant, backupSummaryLine } from '../account-view';
import type { LatestBackupState } from '../hooks/useLatestBackup';

interface AccountBackupSummaryProps {
  variant: AccountVariant;
  state: LatestBackupState;
}

export function AccountBackupSummary({
  variant,
  state,
}: AccountBackupSummaryProps) {
  // Fixed at mount: the summary reads "2 days ago" relative to when the page
  // opened, which is what the card needs.
  const [now] = useState(() => new Date());
  const line = backupSummaryLine(state, now);

  if (variant === 'phone') {
    return (
      <section aria-label="Vault backups">
        <Link
          href="/dashboard/vault"
          className="flex items-center gap-3 rounded-xl border border-brand/20 bg-brand-soft px-3.5 py-3 text-foreground no-underline"
        >
          <Illustration kind="vault" size={36} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="text-body-sm font-semibold">
              {line ?? <Skeleton className="h-4 w-44" />}
            </div>
            <div className="text-caption text-brand-text">Go to Vault →</div>
          </div>
        </Link>
      </section>
    );
  }

  return (
    <section
      aria-label="Vault backups"
      className="flex flex-wrap items-center gap-4 rounded-panel border border-brand/20 bg-brand-soft px-6 py-4.5"
    >
      <Illustration kind="vault" size={48} />
      <div className="flex min-w-0 flex-1 basis-70 flex-col gap-0.5">
        <div className="text-body font-semibold">
          {line ?? <Skeleton className="h-5 w-56" />}
        </div>
        <div className="text-body-sm text-brand-text">
          Backups, Recovery Key and passphrase live on the Vault page.
        </div>
      </div>
      <Link
        href="/dashboard/vault"
        className="font-semibold text-brand-text no-underline"
      >
        Go to Vault →
      </Link>
    </section>
  );
}
