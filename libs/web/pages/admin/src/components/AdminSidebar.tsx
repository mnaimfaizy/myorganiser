'use client';

import * as React from 'react';
import Link from 'next/link';

import {
  AppLogo,
  Illustration,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useSidebar,
} from '@myorganiser/web-ui';

import { useAdminOverview } from '../hooks/use-admin-overview';
import { AdminNav, type AdminNavBadges } from './AdminNav';

type AdminSidebarProps = React.ComponentProps<typeof Sidebar>;

/**
 * The admin sidebar: the navy shell with the ADMIN PORTAL chip, the section
 * list with its badges, and a footer that returns to the personal dashboard.
 * Reads the overview through the provider, so badges need no request of their
 * own.
 */
export function AdminSidebar({ ...props }: AdminSidebarProps) {
  const { state, isMobile, setOpenMobile } = useSidebar();
  // Desktop only: the phone drawer is always laid out expanded.
  const collapsed = state === 'collapsed' && !isMobile;
  const { overview } = useAdminOverview();

  // Badges render only with a loaded, non-zero count (AdminNav enforces the
  // zero case); a null overview yields no badges at all.
  const badges = React.useMemo<AdminNavBadges>(
    () => ({
      users: overview?.unverified,
      feedback: overview?.feedbackReportsReceived,
    }),
    [overview],
  );

  // Phone width renders the sidebar as a drawer, which must close once a
  // destination is chosen. Closing on pathname change would miss a tap on the
  // link to the page already open, so this closes on any anchor click instead.
  // The handler sits on the header, content and footer, so the footer's
  // link back to the dashboard closes the drawer too. Desktop never touches
  // the drawer state.
  const handleNavigate = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!isMobile) return;
      if (event.target instanceof Element && event.target.closest('a[href]')) {
        setOpenMobile(false);
      }
    },
    [isMobile, setOpenMobile],
  );

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="gap-0 p-4" onClickCapture={handleNavigate}>
        <Link
          href="/admin"
          aria-label="MyOrganiser admin home"
          className="flex items-center gap-3 rounded-control px-1.5 py-1"
        >
          <AppLogo variant="icon" height={34} aria-hidden />
          {!collapsed && (
            <span className="flex flex-col gap-0.5">
              <span className="font-display text-title text-navy-foreground">
                My<span className="font-extrabold">Organiser</span>
              </span>
              <span className="self-start rounded-full bg-brand px-2 py-px text-label-caps text-brand-foreground">
                ADMIN PORTAL
              </span>
            </span>
          )}
        </Link>
      </SidebarHeader>
      <SidebarContent
        className="gap-4.5 px-4 pb-0 pt-2"
        onClickCapture={handleNavigate}
      >
        <AdminNav collapsed={collapsed} badges={badges} />
      </SidebarContent>
      <SidebarFooter
        className="gap-4.5 p-4 pt-0"
        onClickCapture={handleNavigate}
      >
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/dashboard"
                aria-label="Back to MyOrganiser"
                className="flex size-13 items-center justify-center self-center rounded-menu hover:bg-sidebar-accent"
              >
                <Illustration kind="home" size={36} />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">Back to MyOrganiser</TooltipContent>
          </Tooltip>
        ) : (
          <div className="flex flex-col gap-2 rounded-control bg-navy-raised p-3.5">
            <p className="text-caption text-navy-muted-foreground">
              Admin actions are recorded in the audit log. Vault data is never
              visible here.
            </p>
            <Link
              href="/dashboard"
              className="flex h-10 w-full items-center justify-center rounded-control border border-sidebar-border text-body-sm font-semibold text-navy-foreground transition-colors hover:bg-sidebar-accent"
            >
              Back to MyOrganiser
            </Link>
          </div>
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
