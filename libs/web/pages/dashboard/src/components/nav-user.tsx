'use client';

import { logout } from '@myorganiser/auth';
import {
  BadgeCheck,
  Bell,
  ChevronsUpDown,
  CreditCard,
  LogOut,
  MessageSquarePlus,
  Sparkles,
} from 'lucide-react';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@myorganiser/web-ui';
import { openFeedbackDialog } from '../hooks/use-feedback-dialog';

export function NavUser({
  user,
}: {
  user: {
    name: string;
    email: string;
    avatar: string;
  };
}) {
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();

  // Radix closes the menu itself after a select unless the select is
  // defaultPrevented, so the handlers below must not call preventDefault.
  // At phone width the sidebar is a drawer that must close too.
  const closeMobileSidebar = useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  const handleLogout = useCallback(async () => {
    await logout();
    router.push('/login');
  }, [router]);

  const handleAccountSelect = useCallback(() => {
    router.push('/dashboard/account');
    closeMobileSidebar();
  }, [router, closeMobileSidebar]);

  const handleLogoutSelect = useCallback(() => {
    void handleLogout();
    closeMobileSidebar();
  }, [handleLogout, closeMobileSidebar]);

  const handleSendFeedbackSelect = useCallback(() => {
    openFeedbackDialog();
    closeMobileSidebar();
  }, [closeMobileSidebar]);

  const initials = user.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage src={user.avatar} alt={user.name} />
                <AvatarFallback className="rounded-lg">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{user.name}</span>
                <span className="truncate text-xs">{user.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage src={user.avatar} alt={user.name} />
                  <AvatarFallback className="rounded-lg">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{user.name}</span>
                  <span className="truncate text-xs">{user.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <Sparkles />
                Upgrade to Pro
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={handleAccountSelect}>
                <BadgeCheck />
                Account
              </DropdownMenuItem>
              <DropdownMenuItem>
                <CreditCard />
                Billing
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Bell />
                Notifications
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleSendFeedbackSelect}>
                <MessageSquarePlus />
                Send feedback
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleLogoutSelect}>
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
