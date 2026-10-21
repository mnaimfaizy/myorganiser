'use client';

import { getCurrentUser, logout } from '@myorganiser/auth';
import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  useSidebar,
  useToast,
} from '@myorganiser/web-ui';
import { ChevronDown, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

const MENU_ITEM_CLASS = 'min-h-10 rounded-item px-2.5 text-body-sm';

export interface AdminAccountMenuProps {
  /**
   * `header` is the desktop bar's wide trigger with name and email. `phone` is
   * the 44px brand square with initials, for the phone admin bar.
   */
  variant: 'header' | 'phone';
}

/** Initials from the name; with no name the email's first letter stands in. */
function initialsOf(name: string, email: string): string {
  const fromName = name
    .split(' ')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return fromName || email.charAt(0).toUpperCase();
}

/**
 * The admin account menu. Its only item is Log out, which keeps the admin
 * shell's own logic: the admin page lib cannot import the dashboard's
 * useLogOut (Nx page-to-page boundary), so the handler is inlined here.
 */
export function AdminAccountMenu({ variant }: AdminAccountMenuProps) {
  const currentUser = getCurrentUser();
  const name = currentUser?.name ?? '';
  const email = currentUser?.email ?? '';
  const initials = initialsOf(name, email);

  const router = useRouter();
  const { toast } = useToast();
  const { isMobile, setOpenMobile } = useSidebar();

  // A rejected sign-out keeps the User here and says so; it must not redirect.
  const handleLogout = React.useCallback(async () => {
    try {
      await logout();
    } catch {
      toast({
        title: 'Log out failed',
        description: 'You are still signed in. Try again.',
        variant: 'destructive',
      });
      return;
    }
    router.push('/login');
  }, [router, toast]);

  // Radix closes the menu itself after a select unless the select is
  // defaultPrevented, so the logout select must not call preventDefault.
  // At phone width the sidebar is a drawer that must close too.
  const handleLogoutSelect = React.useCallback(() => {
    void handleLogout();
    if (isMobile) setOpenMobile(false);
  }, [handleLogout, isMobile, setOpenMobile]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === 'phone' ? (
          <button
            type="button"
            aria-label={`Account menu for ${name || email}`}
            className="flex size-11 items-center justify-center rounded-control bg-brand font-display text-control-sm font-bold text-brand-foreground"
          >
            {initials}
          </button>
        ) : (
          <Button
            variant="outline"
            className="h-12 gap-2.5 rounded-menu border-border bg-background py-0 pl-1.5 pr-2.5 text-foreground"
          >
            <Avatar aria-hidden="true" className="size-9 rounded-control-sm">
              <AvatarFallback className="rounded-control-sm bg-brand font-display text-control-sm font-bold text-brand-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="flex flex-col items-start text-left">
              <span className="text-body-sm font-semibold text-foreground">
                {name}
              </span>
              <span className="text-caption font-normal text-muted-foreground">
                {email}
              </span>
            </span>
            <ChevronDown
              aria-hidden="true"
              className="size-3.5 text-foreground-secondary"
            />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-65 rounded-xl p-1.5 shadow-popover"
      >
        <DropdownMenuLabel className="mb-1.5 flex flex-col gap-0.5 border-b border-border px-2.5 pb-3 pt-2.5 font-normal">
          <span className="text-body-sm font-semibold text-foreground">
            {name}
          </span>
          <span className="truncate text-caption text-muted-foreground">
            {email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuItem
          variant="destructive"
          className={MENU_ITEM_CLASS}
          onSelect={handleLogoutSelect}
        >
          <LogOut aria-hidden="true" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
