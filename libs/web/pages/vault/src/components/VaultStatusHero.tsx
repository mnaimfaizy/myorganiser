'use client';

import { useCallback, useState } from 'react';

import { formatDistance } from 'date-fns';

import { Button, Illustration, useIsMobile } from '@myorganiser/web-ui';
import {
  useOptionalVaultSession,
  useVaultLockState,
} from '@myorganiser/web-vault-ui';

export interface VaultStatusEscapeCopy {
  /** True when the vault is linked to Google Drive. */
  linked: boolean;
  /** When the newest Escape Copy was made. `undefined` means unknown, so its chip is not shown. */
  newestCopyCreatedAt: string | null | undefined;
}

export interface VaultStatusHeroProps {
  escapeCopy?: VaultStatusEscapeCopy;
}

/**
 * The unlocked hero: a navy panel that says the vault is open on this device and
 * offers Lock. Renders nothing unless the vault is unlocked.
 */
export function VaultStatusHero({ escapeCopy }: VaultStatusHeroProps) {
  const lockState = useVaultLockState();
  const session = useOptionalVaultSession();
  const isMobile = useIsMobile();
  // Captured once at mount so the relative age is stable across renders.
  const [now] = useState(() => new Date());

  const handleLock = useCallback(() => {
    session?.lock();
  }, [session]);

  if (lockState !== 'unlocked') {
    return null;
  }

  const newestCopyAge =
    escapeCopy?.newestCopyCreatedAt != null
      ? formatDistance(new Date(escapeCopy.newestCopyCreatedAt), now, {
          addSuffix: false,
        })
      : null;

  // Below md the illustration and heading share a row; the body and chips span both
  // columns. At md the column wrapper becomes a flex column again (display: contents
  // below md).
  return (
    <section className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-2xl bg-navy p-6 text-navy-foreground md:flex md:flex-wrap md:gap-8 md:p-8">
      <Illustration kind="vault" size={isMobile ? 64 : 112} />
      <div className="contents md:flex md:min-w-0 md:flex-1 md:basis-80 md:flex-col md:gap-2">
        <h1 className="font-display text-title md:text-display">
          Your vault is unlocked
        </h1>
        <p className="col-span-2 flex items-center gap-2 text-body text-navy-muted-foreground">
          <span
            aria-hidden="true"
            className="inline-block size-2 shrink-0 rounded-full bg-navy-trust"
          />
          Unlocked on this device for this session
        </p>
        {escapeCopy && (
          <div className="col-span-2 hidden flex-wrap gap-2 pt-1.5 md:flex">
            {escapeCopy.linked && (
              <span className="inline-flex items-center gap-2 rounded-full bg-trust-soft px-2.5 py-1 text-caption font-semibold text-trust-text">
                <span
                  aria-hidden="true"
                  className="inline-block size-2 rounded-full bg-trust"
                />
                Linked to Google Drive
              </span>
            )}
            {newestCopyAge !== null && (
              <span className="rounded-full bg-navy-raised px-2.5 py-1 text-caption font-semibold text-navy-foreground">
                {`Newest copy: ${newestCopyAge} old`}
              </span>
            )}
          </div>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        onClick={handleLock}
        className="hidden border border-navy-muted-foreground text-navy-foreground hover:bg-navy-raised hover:text-navy-foreground md:inline-flex"
      >
        Lock vault
      </Button>
    </section>
  );
}
