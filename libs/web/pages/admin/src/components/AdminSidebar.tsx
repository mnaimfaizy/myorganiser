'use client';

import * as React from 'react';

import { getCurrentUser, logout } from '@myorganiser/auth';
import {
  AppLogo,
  Avatar,
  AvatarFallback,
  AvatarImage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@myorganiser/web-ui';
import {
  ChevronsUpDown,
  Home,
  LogOut,
  MessageSquare,
  ScrollText,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const adminNavItems: {
  title: string;
  url: string;
  icon: LucideIcon;
}[] = [
  {
    title: 'Home',
    url: '/admin',
    icon: Home,
  },
  {
    title: 'Users',
    url: '/admin/users',
    icon: Users,
  },
  {
    title: 'Audit Log',
    url: '/admin/audit-logs',
    icon: ScrollText,
  },
  {
    title: 'Feedback',
    url: '/admin/feedback',
    icon: MessageSquare,
  },
];

type AdminSidebarProps = React.ComponentProps<typeof Sidebar>;

export function AdminSidebar({ ...props }: AdminSidebarProps) {
  const currentUser = getCurrentUser();
  const router = useRouter();
  const { state, isMobile, setOpenMobile } = useSidebar();

  const userName = currentUser?.name ?? '';
  const userEmail = currentUser?.email ?? '';
  const initials = userName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const handleLogout = React.useCallback(async () => {
    await logout();
    router.push('/login');
  }, [router]);

  // Radix closes the menu itself after a select unless the select is
  // defaultPrevented, so the logout select must not call preventDefault.
  // At phone width the sidebar is a drawer that must close too.
  const handleLogoutSelect = React.useCallback(() => {
    void handleLogout();
    if (isMobile) setOpenMobile(false);
  }, [handleLogout, isMobile, setOpenMobile]);

  // Phone width renders the sidebar as a drawer, which must close once a
  // destination is chosen. Closing on pathname change would miss a tap on the
  // link to the page already open, so this closes on any anchor click instead:
  // one capture handler covers every admin link in the content. The header has
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

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <div className="flex flex-col gap-1 px-2 py-3">
          <AppLogo
            variant={state === 'collapsed' ? 'icon' : 'full'}
            height={28}
          />
          {state !== 'collapsed' ? (
            <p className="text-xs text-muted-foreground">Platform Admin</p>
          ) : null}
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarImage src="" alt={userName} />
                    <AvatarFallback className="rounded-lg">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{userName}</span>
                    <span className="truncate text-xs">{userEmail}</span>
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
                      <AvatarImage src="" alt={userName} />
                      <AvatarFallback className="rounded-lg">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">{userName}</span>
                      <span className="truncate text-xs">{userEmail}</span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={handleLogoutSelect}>
                  <LogOut />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent onClickCapture={handleNavigate}>
        <SidebarGroup>
          <SidebarGroupLabel>Admin</SidebarGroupLabel>
          <SidebarMenu>
            {adminNavItems.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild tooltip={item.title}>
                  <Link href={item.url}>
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
