'use client';

import Link from 'next/link';
import { useCallback } from 'react';

import { Button } from '@myorganiser/web-ui';
import {
  describeVaultSyncStatus,
  useOptionalVaultSession,
  useVaultSyncStatus,
} from '@myorganiser/web-vault-ui';

/**
 * Vault state card at the foot of the desktop sidebar. Renders nothing
 * without a Vault Session. While unlocked it reads the sync status label as
 * its meta line; there is no last-synced timestamp to show.
 */
export function SidebarVaultCard() {
  const session = useOptionalVaultSession();
  const { status } = useVaultSyncStatus();

  const lockVault = useCallback(() => {
    session?.lock();
  }, [session]);

  if (!session) return null;

  const unlocked = session.masterKeyBytes !== null;
  // Synced has no label, so it reads as "Synced" here. There is no last-synced
  // timestamp to show. A null status (first reading pending) shows no meta.
  const reading = describeVaultSyncStatus(status);
  const meta = unlocked && status !== null ? (reading.label ?? 'Synced') : null;

  return (
    <section
      aria-label="Vault status"
      className="flex flex-col gap-2.5 rounded-xl bg-navy-raised p-3.5"
    >
      {unlocked ? (
        <>
          <span className="flex items-center gap-2 text-body-sm font-semibold text-navy-foreground">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full bg-navy-trust"
            />
            Vault unlocked
          </span>
          {meta && (
            <span className="text-caption text-navy-muted-foreground">
              {meta}
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={lockVault}
            className="h-10 w-full border-sidebar-border bg-transparent text-navy-foreground hover:bg-sidebar-accent"
          >
            Lock vault
          </Button>
        </>
      ) : (
        <>
          <span className="flex items-center gap-2 text-body-sm font-semibold text-navy-foreground">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full bg-warning-edge"
            />
            Vault locked
          </span>
          <span className="text-caption text-navy-muted-foreground">
            Your data stays encrypted on this device
          </span>
          <Button asChild variant="brand" size="sm" className="h-10 w-full">
            <Link href="/dashboard/vault">Unlock</Link>
          </Button>
        </>
      )}
    </section>
  );
}
