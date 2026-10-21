import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@myorganiser/web-ui';
import Link from 'next/link';
import type { ReactNode } from 'react';

const MENU_ITEM_CLASS = 'min-h-10 rounded-item px-2.5 text-body-sm';

const QUICK_ADD_ITEMS = [
  { label: 'Tasks', href: '/dashboard/tasks' },
  { label: 'Groceries', href: '/dashboard/groceries' },
  { label: 'Addresses', href: '/dashboard/addresses' },
  { label: 'Subscriptions', href: '/dashboard/subscriptions' },
  { label: 'Mobile numbers', href: '/dashboard/mobile-numbers' },
] as const;

export interface QuickAddMenuProps {
  /** The one element that opens the menu: the hero button or the phone FAB. */
  children: ReactNode;
}

/** Links to each area's add flow. Radix owns the open state. */
export function QuickAddMenu({ children }: QuickAddMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-60 rounded-menu p-1.5 shadow-popover"
      >
        {QUICK_ADD_ITEMS.map((item) => (
          <DropdownMenuItem key={item.href} asChild className={MENU_ITEM_CLASS}>
            <Link href={item.href}>{item.label}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
