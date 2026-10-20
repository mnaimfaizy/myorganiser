'use client';

import { getCurrentUser, logout } from '@myorganiser/auth';
import { ChevronDown, User } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@myorganiser/web-ui';
import { useOptionalVaultSession } from '@myorganiser/web-vault-ui';
import { openFeedbackDialog } from '../hooks/use-feedback-dialog';

const MENU_ITEM_CLASS = 'min-h-10 rounded-item px-2.5 text-body-sm';

function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/**
 * The account menu in the dashboard header. Radix owns the open state. The
 * item handlers do not call preventDefault, so Radix closes the menu after
 * a selection.
 */
export function AccountMenu() {
  const router = useRouter();
  const currentUser = getCurrentUser();
  const name = currentUser?.name ?? '';
  const email = currentUser?.email ?? '';
  // Inlined rather than imported: the admin page lib's isPlatformAdmin is not
  // exported, and a dashboard import of it would cross a page boundary.
  const isPlatformAdmin = currentUser?.role === 'platform_admin';
  const session = useOptionalVaultSession();
  // Initials come from the name; with no name the email's first letter stands in,
  // and with neither the avatar shows an icon rather than empty text.
  const initials = initialsOf(name) || email.charAt(0).toUpperCase();
  const canLockVault = session !== null && session.masterKeyBytes !== null;

  const lockVault = useCallback(() => {
    session?.lock();
  }, [session]);

  const sendFeedback = useCallback(() => {
    openFeedbackDialog();
  }, []);

  const logOut = useCallback(() => {
    void logout().then(() => router.push('/login'));
  }, [router]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="h-12 gap-2.5 rounded-menu border-border bg-background py-0 pl-1.5 pr-2.5 text-foreground"
        >
          <Avatar aria-hidden="true" className="size-9 rounded-control-sm">
            <AvatarFallback className="rounded-control-sm bg-brand font-display text-control-sm font-bold text-brand-foreground">
              {initials || <User aria-hidden="true" className="size-4" />}
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
        <DropdownMenuItem asChild className={MENU_ITEM_CLASS}>
          <Link href="/dashboard/account">Account settings</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className={MENU_ITEM_CLASS}>
          <Link href="/dashboard/vault">Vault and backups</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className={MENU_ITEM_CLASS}>
          <Link href="/download">Install the app</Link>
        </DropdownMenuItem>
        <DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={sendFeedback}>
          Send feedback
        </DropdownMenuItem>
        <DropdownMenuItem asChild className={MENU_ITEM_CLASS}>
          <Link href="/dashboard/account/reports">Your reports</Link>
        </DropdownMenuItem>
        {isPlatformAdmin && (
          <DropdownMenuItem asChild className={MENU_ITEM_CLASS}>
            <Link href="/admin">Admin portal</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {canLockVault && (
          <DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={lockVault}>
            Lock vault
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          variant="destructive"
          className={MENU_ITEM_CLASS}
          onSelect={logOut}
        >
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
