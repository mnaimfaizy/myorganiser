'use client';

import * as React from 'react';

import { getCurrentUser } from '@myorganiser/auth';
import {
  AppLogo,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarRail,
  useSidebar,
} from '@myorganiser/web-ui';
import { useYouTubeNavVisible } from '../hooks/useYouTubeNavVisible';
import {
  ClipboardList,
  CreditCard,
  Home,
  MapPin,
  MessageSquarePlus,
  Phone,
  ShoppingCart,
  Vault,
  Youtube,
} from 'lucide-react';
import { NavMain } from './nav-main';
import { NavUser } from './nav-user';
import { openFeedbackDialog } from '../hooks/use-feedback-dialog';

const allNavItems = [
  {
    title: 'Home',
    url: '/dashboard',
    icon: Home,
  },
  {
    title: 'Tasks',
    url: '/dashboard/tasks',
    icon: ClipboardList,
  },
  {
    title: 'Groceries',
    url: '/dashboard/groceries',
    icon: ShoppingCart,
  },
  {
    title: 'Addresses',
    url: '/dashboard/addresses',
    icon: MapPin,
  },
  {
    title: 'Mobile Numbers',
    url: '/dashboard/mobile-numbers',
    icon: Phone,
  },
  {
    title: 'Subscriptions',
    url: '/dashboard/subscriptions',
    icon: CreditCard,
  },
  {
    title: 'YouTube',
    url: '/dashboard/youtube',
    icon: Youtube,
  },
  {
    title: 'Vault',
    url: '/dashboard/vault',
    icon: Vault,
  },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const currentUser = getCurrentUser();
  const user = {
    name: currentUser?.name ?? '',
    email: currentUser?.email ?? '',
    avatar: '',
  };
  const { state, isMobile, setOpenMobile } = useSidebar();
  const youtubeNavVisible = useYouTubeNavVisible();

  const navMain = allNavItems.filter(
    (item) => item.url !== '/dashboard/youtube' || youtubeNavVisible,
  );

  // Phone width renders the sidebar as a drawer, which must close once a
  // destination is chosen. Closing on pathname change would miss a tap on the
  // link to the page already open, so this closes on any anchor click instead:
  // one capture handler covers every link in the content, sub-items included,
  // and keyboard activation of a link also dispatches a click. The header has
  // no links: the user menu closes the drawer itself. Desktop never touches
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

  const handleFeedback = React.useCallback(() => {
    openFeedbackDialog();
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <div className="flex items-center px-2 py-3">
          <AppLogo
            variant={state === 'collapsed' ? 'icon' : 'full'}
            height={28}
          />
        </div>
        <NavUser user={user} />
      </SidebarHeader>
      <SidebarContent onClickCapture={handleNavigate}>
        <NavMain items={navMain} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleFeedback} tooltip="Send feedback">
              <MessageSquarePlus />
              <span>Send feedback</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
