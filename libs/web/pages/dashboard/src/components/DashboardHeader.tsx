'use client';

import { PanelLeft } from 'lucide-react';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import {
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useSidebar,
} from '@myorganiser/web-ui';
import {
  describeVaultSyncStatus,
  SyncStatusWidget,
  useOptionalVaultSession,
  useVaultSyncStatus,
} from '@myorganiser/web-vault-ui';
import { AccountMenu } from './AccountMenu';
import { isNavItemActive } from './nav-main';
import { DynamicBreadcrumb, getBreadcrumbItems } from './DynamicBreadcrumb';

/**
 * The dashboard page header: sidebar toggle, breadcrumb and page title, the
 * vault state chip, and the account menu. Every page keeps its own h1, so the
 * title here is a paragraph, not a heading.
 */
export function DashboardHeader() {
  // usePathname() can be null outside the App Router; the breadcrumb resolver
  // treats an empty path as the Dashboard root.
  const pathname: string = usePathname() ?? '';
  const { state, isMobile, toggleSidebar } = useSidebar();
  const session = useOptionalVaultSession();
  const { status } = useVaultSyncStatus();

  const crumbs = getBreadcrumbItems(pathname);
  // The dashboard root is titled Home; every other path keeps its last crumb.
  const isRoot = isNavItemActive(pathname, '/dashboard');
  const title = isRoot
    ? 'Home'
    : (crumbs[crumbs.length - 1]?.label ?? 'Dashboard');

  const toggleLabel = isMobile
    ? 'Open sidebar'
    : state === 'expanded'
      ? 'Collapse sidebar'
      : 'Expand sidebar';

  const locked = session !== null && session.masterKeyBytes === null;
  const reading = describeVaultSyncStatus(status);
  const synced = !locked && status !== null && reading.label === null;

  // The chip replaces the live sync widget only for the two healthy states.
  // The widget stays mounted in the same place either way, so its live region
  // keeps announcing changes; a chip state hides it visually with sr-only.
  let chip: ReactNode = null;
  if (locked) {
    chip = (
      <span className="inline-flex h-8 items-center gap-2 rounded-full bg-warning-soft px-3 text-caption font-semibold text-warning-text">
        <span aria-hidden="true" className="size-2 rounded-full bg-warning" />
        Vault locked
      </span>
    );
  } else if (synced) {
    chip = (
      <span className="inline-flex h-8 items-center gap-2 rounded-full bg-trust-soft px-3 text-caption font-semibold text-trust-text">
        <span aria-hidden="true" className="size-2 rounded-full bg-trust" />
        Synced
      </span>
    );
  }

  return (
    <header className="flex min-h-19 flex-wrap items-center gap-3.5 border-b border-border bg-raised-surface px-8 py-3.5 text-foreground">
      <Tooltip>
        <TooltipTrigger asChild>
          <IconButton
            variant="outline"
            label={toggleLabel}
            icon={<PanelLeft aria-hidden="true" />}
            onClick={toggleSidebar}
          />
        </TooltipTrigger>
        <TooltipContent side="bottom">{toggleLabel}</TooltipContent>
      </Tooltip>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="text-caption text-muted-foreground">
          <DynamicBreadcrumb />
        </div>
        <p className="truncate font-display text-title text-foreground">
          {title}
        </p>
      </div>
      <div className="flex items-center">
        {chip}
        <SyncStatusWidget className={chip ? 'sr-only' : undefined} />
      </div>
      <AccountMenu />
    </header>
  );
}
