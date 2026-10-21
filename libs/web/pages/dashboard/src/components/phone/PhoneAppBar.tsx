'use client';

import { ChevronLeft, Lock } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { IconButton, Illustration } from '@myorganiser/web-ui';
import {
  describeVaultSyncStatus,
  SyncStatusWidget,
  useOptionalVaultSession,
  useVaultLockState,
  useVaultSyncStatus,
} from '@myorganiser/web-vault-ui';

import { getPhoneScreen } from '../../utils/phone-screen';

/**
 * The top bar of the installed phone shell, in three states: a tab root with
 * a large title, the same root once its title has scrolled away (a compact
 * bar), and a pushed screen with a back link. Every page keeps its own h1, so
 * titles here are paragraphs, not headings.
 */
export function PhoneAppBar() {
  // usePathname() can be null outside the App Router; an empty path is Home.
  const pathname: string = usePathname() ?? '';
  const screen = getPhoneScreen(pathname);
  const isRoot = screen.type === 'root';

  const session = useOptionalVaultSession();
  const lockState = useVaultLockState();
  const { status } = useVaultSyncStatus();
  const titleRowRef = useRef<HTMLDivElement>(null);
  const [scrolledPast, setScrolledPast] = useState(false);

  useEffect(() => {
    const node = titleRowRef.current;
    if (
      !isRoot ||
      node === null ||
      typeof IntersectionObserver === 'undefined'
    ) {
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      setScrolledPast(!entry.isIntersecting);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [isRoot]);

  const canLockVault = lockState === 'unlocked';
  const locked = lockState === 'locked';
  const reading = describeVaultSyncStatus(status);
  const synced = !locked && status !== null && reading.label === null;
  // The sync widget stays mounted in both states so its live region keeps
  // announcing; the two healthy states hide it visually, as DashboardHeader does.
  const syncClassName = locked || synced ? 'sr-only' : undefined;

  const lockVault = useCallback(() => {
    session?.lock();
  }, [session]);

  if (screen.type === 'pushed') {
    return (
      <header className="sticky top-0 z-20 border-b border-border bg-raised-surface pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] md:hidden">
        <div className="flex h-11 items-center justify-between pr-1">
          <Link
            href={screen.back.href}
            aria-label={`Back to ${screen.back.label}`}
            className="inline-flex min-h-11 items-center gap-0.5 py-0 pr-2 pl-1 text-body text-brand-text no-underline"
          >
            <ChevronLeft aria-hidden="true" className="size-5.5" />
            {screen.back.label}
          </Link>
          <SyncStatusWidget className={syncClassName} />
        </div>
        {screen.title !== null && (
          <p className="px-4 pb-3 font-display text-title-lg text-foreground">
            {screen.title}
          </p>
        )}
      </header>
    );
  }

  return (
    <>
      <header className="border-b border-border bg-background pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] md:hidden">
        <div className="pt-1 pr-2 pb-3 pl-4">
          <div className="flex h-11 items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center">
              <SyncStatusWidget className={syncClassName} />
            </div>
            {canLockVault && !scrolledPast && (
              <IconButton
                variant="ghost"
                label="Lock vault"
                icon={<Lock aria-hidden="true" />}
                className="text-brand"
                onClick={lockVault}
              />
            )}
          </div>
          <div ref={titleRowRef} className="flex items-center gap-3">
            <Illustration kind={screen.kind} size={48} />
            <p className="font-display text-display text-foreground">
              {screen.title}
            </p>
          </div>
        </div>
      </header>
      {scrolledPast && (
        // The bar is pulled up by its own height so it adds no flow space when
        // it appears; it then sticks to the top of the column.
        <div className="sticky top-0 z-20 -mt-[calc(3.25rem_+_env(safe-area-inset-top))] grid h-[calc(3.25rem_+_env(safe-area-inset-top))] grid-cols-[44px_1fr_44px] items-center border-b border-border bg-raised-surface px-2 pt-[env(safe-area-inset-top)] md:hidden">
          <span aria-hidden="true" />
          <p
            aria-hidden="true"
            className="truncate text-center text-body font-semibold text-foreground"
          >
            {screen.title}
          </p>
          {canLockVault ? (
            <IconButton
              variant="ghost"
              label="Lock vault"
              icon={<Lock aria-hidden="true" />}
              className="text-brand"
              onClick={lockVault}
            />
          ) : (
            <span aria-hidden="true" />
          )}
        </div>
      )}
    </>
  );
}
