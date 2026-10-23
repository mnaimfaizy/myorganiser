'use client';

import { ChevronRight, PanelLeft } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useSidebar,
} from '@myorganiser/web-ui';

import { resolveAdminHeader } from '../lib/adminNav';
import { AdminAccountMenu } from './AdminAccountMenu';

/**
 * The desktop admin header: sidebar toggle, crumb trail and page title, the
 * Platform admin chip, and the account menu. Hidden below md, where the phone
 * admin bar takes its place. The title is a paragraph: the page owns the h1.
 */
export function AdminHeader() {
  // usePathname() can be null outside the App Router; an empty path resolves
  // to the portal root.
  const pathname: string = usePathname() ?? '';
  const { state, isMobile, toggleSidebar } = useSidebar();
  const { title, crumbs } = resolveAdminHeader(pathname);

  const toggleLabel = isMobile
    ? 'Open sidebar'
    : state === 'expanded'
      ? 'Collapse sidebar'
      : 'Expand sidebar';

  return (
    <header className="hidden min-h-19 flex-wrap items-center gap-3.5 border-b border-border bg-raised-surface px-8 py-3.5 text-foreground md:flex">
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
        <nav
          aria-label="Breadcrumb"
          className="text-caption text-muted-foreground"
        >
          <ol className="flex items-center gap-1.5">
            {crumbs.map((crumb, index) => (
              <li
                key={`${index}-${crumb.label}`}
                className="flex items-center gap-1.5"
              >
                {index > 0 && (
                  <ChevronRight aria-hidden="true" className="size-3.5" />
                )}
                {crumb.href ? (
                  <Link
                    href={crumb.href}
                    className="text-brand-text hover:underline"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span aria-current="page">{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
        <p className="truncate font-display text-title text-foreground">
          {title}
        </p>
      </div>
      <div className="flex items-center">
        <span className="inline-flex h-8 items-center rounded-full bg-brand-soft px-3 text-caption font-semibold text-brand-text">
          Platform admin
        </span>
      </div>
      <AdminAccountMenu variant="header" />
    </header>
  );
}
