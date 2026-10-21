'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  cn,
  Illustration,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@myorganiser/web-ui';

import {
  ADMIN_SECTION_IDS,
  ADMIN_SECTIONS,
  type AdminSectionId,
  isAdminNavItemActive,
} from '../lib/adminNav';

/** Badge counts per section. A missing or zero count renders no badge. */
export type AdminNavBadges = Partial<Record<AdminSectionId, number>>;

/**
 * Users (unverified) and Feedback (received reports) are the two amber
 * attention badges on the artboard; the rest are neutral.
 */
const BADGE_TONE = {
  overview: 'neutral',
  users: 'warning',
  audit: 'neutral',
  feedback: 'warning',
} as const satisfies Record<AdminSectionId, 'neutral' | 'warning'>;

export interface AdminNavProps {
  /** Desktop icon rail: illustrations only, tooltips carry the titles. */
  collapsed: boolean;
  badges: AdminNavBadges;
}

interface NavBadgeProps {
  sectionId: AdminSectionId;
  count: number;
  active: boolean;
}

function NavBadge({ sectionId, count, active }: NavBadgeProps) {
  const tone = BADGE_TONE[sectionId];

  return (
    <span
      className={cn(
        'min-w-6 rounded-full px-2 py-0.5 text-center text-label-caps',
        tone === 'warning'
          ? 'bg-warning text-warning-foreground'
          : active
            ? 'bg-sidebar-primary text-sidebar-primary-foreground'
            : 'bg-sidebar-accent text-sidebar-foreground',
      )}
    >
      {count}
    </span>
  );
}

interface NavRowProps {
  sectionId: AdminSectionId;
  active: boolean;
  count: number | undefined;
}

function NavRow({ sectionId, active, count }: NavRowProps) {
  const section = ADMIN_SECTIONS[sectionId];

  return (
    <Link
      href={section.url}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-11.5 items-center gap-3 rounded-menu border py-1 pl-1 pr-2.5 text-body-sm transition-colors',
        active
          ? 'border-sidebar-primary bg-sidebar-primary/25 font-semibold text-navy-foreground'
          : 'border-transparent font-medium text-sidebar-foreground hover:bg-sidebar-accent',
      )}
    >
      <Illustration kind={section.kind} size={36} />
      <span className="min-w-0 flex-1 truncate">{section.title}</span>
      {count !== undefined && count > 0 && (
        <NavBadge sectionId={sectionId} count={count} active={active} />
      )}
    </Link>
  );
}

interface NavRailTileProps {
  sectionId: AdminSectionId;
  active: boolean;
}

function NavRailTile({ sectionId, active }: NavRailTileProps) {
  const section = ADMIN_SECTIONS[sectionId];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={section.url}
          aria-label={section.title}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'flex size-13 items-center justify-center rounded-menu border transition-colors',
            active
              ? 'border-sidebar-primary bg-sidebar-primary/25'
              : 'border-transparent hover:bg-sidebar-accent',
          )}
        >
          <Illustration kind={section.kind} size={36} />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{section.title}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The admin section list in the sidebar: expanded rows with count badges, or
 * the collapsed rail's tiles with tooltips. Badges never show on the rail.
 */
export function AdminNav({ collapsed, badges }: AdminNavProps) {
  // usePathname() yields null outside the App Router; treat that as no route.
  const pathname: string = usePathname() ?? '';

  return (
    <nav
      aria-label="Admin sections"
      className={cn(
        'flex flex-1 flex-col',
        collapsed ? 'items-center gap-3' : 'gap-3',
      )}
    >
      <div className={cn('flex flex-col', collapsed ? 'items-center' : '')}>
        {!collapsed && (
          <span className="px-2.5 pb-1 pt-3 text-label-caps text-navy-muted-foreground">
            PLATFORM
          </span>
        )}
        <ul
          className={cn(
            'flex flex-col',
            collapsed ? 'items-center gap-2' : 'gap-0.75',
          )}
        >
          {ADMIN_SECTION_IDS.map((sectionId) => {
            const active = isAdminNavItemActive(
              pathname,
              ADMIN_SECTIONS[sectionId].url,
            );

            return (
              <li key={sectionId}>
                {collapsed ? (
                  <NavRailTile sectionId={sectionId} active={active} />
                ) : (
                  <NavRow
                    sectionId={sectionId}
                    active={active}
                    count={badges[sectionId]}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
