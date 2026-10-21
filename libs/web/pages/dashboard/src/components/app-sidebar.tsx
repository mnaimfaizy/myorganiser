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
import { useVaultLockState } from '@myorganiser/web-vault-ui';
import { useYouTubeNavVisible } from '../hooks/useYouTubeNavVisible';
import { openFeedbackDialog } from '../hooks/use-feedback-dialog';
import { NavMain, type NavGroup } from './nav-main';
import { SidebarVaultCard } from './SidebarVaultCard';

const YOUTUBE_URL = '/dashboard/youtube';

/** The sidebar's sections, in artboard order. Labels are the artboard text. */
const NAV_GROUPS: NavGroup[] = [
  {
    label: 'OVERVIEW',
    items: [{ title: 'Home', url: '/dashboard', kind: 'home' }],
  },
  {
    label: 'ORGANISE',
    items: [
      { title: 'Tasks', url: '/dashboard/tasks', kind: 'tasks' },
      { title: 'Groceries', url: '/dashboard/groceries', kind: 'groceries' },
      {
        title: 'Subscriptions',
        url: '/dashboard/subscriptions',
        kind: 'subscriptions',
      },
    ],
  },
  {
    label: 'PEOPLE AND PLACES',
    items: [
      { title: 'Addresses', url: '/dashboard/addresses', kind: 'addresses' },
      {
        title: 'Mobile numbers',
        url: '/dashboard/mobile-numbers',
        kind: 'mobile',
      },
    ],
  },
  {
    label: 'MEDIA',
    items: [{ title: 'YouTube', url: YOUTUBE_URL, kind: 'youtube' }],
  },
  {
    label: 'SECURITY',
    items: [{ title: 'Vault', url: '/dashboard/vault', kind: 'vault' }],
  },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { state, isMobile, setOpenMobile } = useSidebar();
  // Desktop only: the phone drawer is always laid out expanded, whatever the
  // desktop collapse state is.
  const collapsed = state === 'collapsed' && !isMobile;
  const youtubeNavVisible = useYouTubeNavVisible();
  const vaultLocked = useVaultLockState() === 'locked';

  // A group whose only item is hidden is dropped whole, header included.
  const groups = React.useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter(
          (item) => item.url !== YOUTUBE_URL || youtubeNavVisible,
        ),
      })).filter((group) => group.items.length > 0),
    [youtubeNavVisible],
  );

  // Phone width renders the sidebar as a drawer, which must close once a
  // destination is chosen. Closing on pathname change would miss a tap on the
  // link to the page already open, so this closes on any anchor click instead:
  // one capture handler covers every link in the sidebar, and keyboard
  // activation of a link also dispatches a click. The header sits behind the
  // drawer's overlay, so it never needs to close the drawer. Desktop never
  // touches the drawer state.
  const handleNavigate = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!isMobile) return;
      if (event.target instanceof Element && event.target.closest('a[href]')) {
        setOpenMobile(false);
      }
    },
    [isMobile, setOpenMobile],
  );

  const handleFeedback = React.useCallback(() => {
    openFeedbackDialog();
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="gap-0 p-4">
        <Link
          href="/dashboard"
          aria-label="MyOrganiser home"
          className="flex items-center gap-3 rounded-control px-1.5 py-1"
        >
          <AppLogo variant="icon" height={34} aria-hidden />
          {!collapsed && (
            <span className="font-display text-title text-navy-foreground">
              My<span className="font-extrabold">Organiser</span>
            </span>
          )}
        </Link>
      </SidebarHeader>
      <SidebarContent
        className="gap-4.5 px-4 pb-0 pt-2"
        onClickCapture={handleNavigate}
      >
        <NavMain
          groups={groups}
          collapsed={collapsed}
          countsVisible={!vaultLocked}
        />
      </SidebarContent>
      <SidebarFooter className="gap-4.5 p-4 pt-0">
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Send feedback"
                onClick={handleFeedback}
                className="flex size-13 items-center justify-center self-center rounded-menu hover:bg-sidebar-accent"
              >
                <Illustration kind="feedback" size={32} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Send feedback</TooltipContent>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={handleFeedback}
            className="flex h-12 items-center gap-3 rounded-control px-2.5 text-body-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent"
          >
            <Illustration kind="feedback" size={32} />
            <span>Send feedback</span>
          </button>
        )}
        {!collapsed && <SidebarVaultCard />}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
