'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  cn,
  Illustration,
  type IllustrationKind,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@myorganiser/web-ui';

const DASHBOARD_HOME_URL = '/dashboard';

function stripTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * True when the current pathname belongs to a nav item's url.
 * The dashboard home url matches only exactly; every other url also matches
 * as a path prefix followed by `/`.
 */
export function isNavItemActive(pathname: string, url: string): boolean {
  const current = stripTrailingSlash(pathname);
  const target = stripTrailingSlash(url);

  if (current === target) {
    return true;
  }

  if (target === DASHBOARD_HOME_URL) {
    return false;
  }

  return current.startsWith(`${target}/`);
}

export interface NavItem {
  title: string;
  url: string;
  kind: IllustrationKind;
  /** Badge count. Rendered only when defined; no item supplies one yet. */
  count?: number;
}

export interface NavGroup {
  /** Group heading as rendered, e.g. "PEOPLE AND PLACES". */
  label: string;
  items: NavItem[];
}

export interface NavMainProps {
  groups: NavGroup[];
  /** Desktop icon rail: illustrations only, tooltips carry the titles. */
  collapsed: boolean;
  /** False while the Vault is locked; counts are hidden then. */
  countsVisible: boolean;
}

interface NavRowProps {
  item: NavItem;
  active: boolean;
  countVisible: boolean;
}

function NavRow({ item, active, countVisible }: NavRowProps) {
  const showCount = countVisible && item.count !== undefined;

  return (
    <Link
      href={item.url}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-11.5 items-center gap-3 rounded-menu border py-1 pl-1 pr-2.5 text-body-sm transition-colors',
        active
          ? 'border-sidebar-primary bg-sidebar-primary/25 font-semibold text-navy-foreground'
          : 'border-transparent font-medium text-sidebar-foreground hover:bg-sidebar-accent',
      )}
    >
      <Illustration kind={item.kind} size={36} />
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      {showCount && (
        <span
          className={cn(
            'min-w-6 rounded-full px-2 py-0.5 text-center text-label-caps',
            active
              ? 'bg-sidebar-primary text-sidebar-primary-foreground'
              : 'bg-sidebar-accent text-sidebar-foreground',
          )}
        >
          {item.count}
        </span>
      )}
    </Link>
  );
}

interface NavRailTileProps {
  item: NavItem;
  active: boolean;
}

function NavRailTile({ item, active }: NavRailTileProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={item.url}
          aria-label={item.title}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'flex size-13 items-center justify-center rounded-menu border transition-colors',
            active
              ? 'border-sidebar-primary bg-sidebar-primary/25'
              : 'border-transparent hover:bg-sidebar-accent',
          )}
        >
          <Illustration kind={item.kind} size={36} />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{item.title}</TooltipContent>
    </Tooltip>
  );
}

export function NavMain({ groups, collapsed, countsVisible }: NavMainProps) {
  // usePathname() yields null outside the App Router context (e.g. unit tests
  // that render this tree without a router); treat that as "no active route".
  const pathname: string = usePathname() ?? '';

  return (
    <nav
      aria-label="Sections"
      className={cn(
        'flex flex-1 flex-col',
        collapsed ? 'items-center gap-3' : 'gap-3',
      )}
    >
      {groups.map((group) => (
        <div
          key={group.label}
          className={cn('flex flex-col', collapsed ? 'items-center' : '')}
        >
          {!collapsed && (
            <span className="px-2.5 pb-1 pt-3 text-label-caps text-navy-muted-foreground">
              {group.label}
            </span>
          )}
          <ul
            className={cn(
              'flex flex-col',
              collapsed ? 'items-center gap-2' : 'gap-0.75',
            )}
          >
            {group.items.map((item) => {
              const active = isNavItemActive(pathname, item.url);

              return (
                <li key={item.url}>
                  {collapsed ? (
                    <NavRailTile item={item} active={active} />
                  ) : (
                    <NavRow
                      item={item}
                      active={active}
                      countVisible={countsVisible}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
