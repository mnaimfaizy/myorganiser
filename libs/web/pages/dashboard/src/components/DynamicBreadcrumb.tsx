'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@myorganiser/web-ui';

interface BreadcrumbNavItem {
  label: string;
  href: string;
}

/**
 * Registry mapping URL segments to breadcrumb labels.
 * Dynamic segments (like [id] or numeric IDs) resolve to "Details".
 */
const SEGMENT_LABEL_REGISTRY: Record<string, string> = {
  tasks: 'Tasks',
  groceries: 'Groceries',
  addresses: 'Addresses',
  'mobile-numbers': 'Mobile Numbers',
  subscriptions: 'Subscriptions',
  youtube: 'YouTube',
  shorts: 'Shorts',
  callback: 'Connecting',
  account: 'Account',
  vault: 'Vault',
  more: 'More',
  reports: 'Your reports',
  channels: 'Channels',
};

/**
 * The registry label for one URL segment, or null when the segment is not
 * registered. Own-property lookup, so a segment such as "constructor" is not
 * mistaken for a label.
 */
export function getSegmentLabel(segment: string): string | null {
  return Object.prototype.hasOwnProperty.call(SEGMENT_LABEL_REGISTRY, segment)
    ? SEGMENT_LABEL_REGISTRY[segment]
    : null;
}

/**
 * Maps URL segments to breadcrumb labels based on cumulative path resolution.
 * Always starts with Dashboard at /dashboard. For each segment after dashboard,
 * looks up the label in the registry; unrecognized segments resolve to "Details".
 *
 * @param pathname - The current pathname from usePathname()
 * @returns Array of breadcrumb items with label and href, or Dashboard-only fallback
 */
export function getBreadcrumbItems(pathname: string): BreadcrumbNavItem[] {
  // Normalize: remove trailing slash and handle null/empty paths
  if (!pathname || pathname.trim() === '') {
    return [{ label: 'Dashboard', href: '/dashboard' }];
  }

  const normalized =
    pathname.endsWith('/') && pathname !== '/'
      ? pathname.slice(0, -1)
      : pathname;

  // If not in the dashboard, return Dashboard only
  if (!normalized.startsWith('/dashboard')) {
    return [{ label: 'Dashboard', href: '/dashboard' }];
  }

  // Start with Dashboard
  const items: BreadcrumbNavItem[] = [
    { label: 'Dashboard', href: '/dashboard' },
  ];

  // Split path into segments and process each one
  const parts = normalized.split('/').filter(Boolean); // Remove empty strings

  // Skip the 'dashboard' part; process segments after it
  const segments = parts.slice(1);

  let cumulativePath = '/dashboard';
  for (const segment of segments) {
    cumulativePath += '/' + segment;
    const label = getSegmentLabel(segment) ?? 'Details';
    items.push({ label, href: cumulativePath });
  }

  return items;
}

export function DynamicBreadcrumb(): React.ReactNode {
  const pathname = usePathname();
  const breadcrumbItems = getBreadcrumbItems(pathname);

  // Should not happen, but ensures at least Dashboard is shown
  if (breadcrumbItems.length === 0) {
    return null;
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {breadcrumbItems.map((item, index) => {
          const isLastItem = index === breadcrumbItems.length - 1;

          return (
            <React.Fragment key={item.href}>
              <BreadcrumbItem
                className={index === 0 ? 'hidden md:block' : undefined}
              >
                {isLastItem ? (
                  <BreadcrumbPage>{item.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink href={item.href}>{item.label}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLastItem && (
                <BreadcrumbSeparator className="hidden md:block" />
              )}
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
