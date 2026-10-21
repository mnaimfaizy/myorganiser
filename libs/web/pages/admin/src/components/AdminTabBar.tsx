'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import {
  fontWeightMediumVar,
  fontWeightSemiboldVar,
} from '@myorganiser/design-tokens';
import { AppLogo, Illustration } from '@myorganiser/web-ui';

import {
  ADMIN_SECTION_IDS,
  ADMIN_SECTIONS,
  isAdminNavItemActive,
} from '../lib/adminNav';

const MY_APP_HREF = '/dashboard';

interface AdminTabProps {
  href: string;
  label: string;
  active: boolean;
  icon: ReactNode;
}

function AdminTab({ href, label, active, icon }: AdminTabProps) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className="flex min-h-15 w-18 flex-col items-center gap-1 no-underline"
    >
      <span
        className={
          active
            ? 'flex h-9 w-15 items-center justify-center rounded-full bg-brand-soft'
            : 'flex h-9 w-15 items-center justify-center rounded-full bg-transparent'
        }
      >
        {icon}
      </span>
      {/*
       * The label step (12px/16px) comes from label-caps. Its weight is set
       * here: the active tab is 600 and the rest 500, so a font-weight class
       * would lose to label-caps' own weight.
       */}
      <span
        className={
          active
            ? 'text-label-caps text-brand-text'
            : 'text-label-caps text-foreground-secondary'
        }
        style={{
          fontWeight: active ? fontWeightSemiboldVar : fontWeightMediumVar,
        }}
      >
        {label}
      </span>
    </Link>
  );
}

/**
 * The phone tab bar of the admin shell: the four admin sections and a
 * My app tab back to the personal dashboard. Hidden from md up. Its data
 * attribute lets the layout raise the toast offset while the bar is mounted.
 */
export function AdminTabBar() {
  // usePathname() can be null outside the App Router; treat as no route.
  const pathname: string = usePathname() ?? '';

  return (
    <nav
      aria-label="Admin sections"
      data-phone-tab-bar
      className="sticky bottom-0 z-20 mt-auto flex items-start justify-around border-t border-border bg-raised-surface pt-2 pb-[calc(18px_+_env(safe-area-inset-bottom))] pl-[max(8px,env(safe-area-inset-left))] pr-[max(8px,env(safe-area-inset-right))] md:hidden"
    >
      {ADMIN_SECTION_IDS.map((sectionId) => {
        const section = ADMIN_SECTIONS[sectionId];

        return (
          <AdminTab
            key={sectionId}
            href={section.url}
            label={section.title}
            active={isAdminNavItemActive(pathname, section.url)}
            icon={<Illustration kind={section.kind} size={28} />}
          />
        );
      })}
      <AdminTab
        href={MY_APP_HREF}
        label="My app"
        active={false}
        icon={<AppLogo variant="icon" height={28} aria-hidden />}
      />
    </nav>
  );
}
