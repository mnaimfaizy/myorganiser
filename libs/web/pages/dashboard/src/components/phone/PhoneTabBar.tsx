'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Illustration } from '@myorganiser/web-ui';

import {
  getCurrentPhoneTab,
  getPhoneScreen,
  PHONE_TAB_ORDER,
  PHONE_TABS,
} from '../../utils/phone-screen';

/**
 * The bottom tab bar of the installed phone shell. It is hidden from md up and
 * on pushed screens, which carry a back link instead. Its data attribute lets
 * the layout raise the toast offset while the bar is mounted.
 */
export function PhoneTabBar() {
  // usePathname() can be null outside the App Router; an empty path is Home.
  const pathname: string = usePathname() ?? '';
  const screen = getPhoneScreen(pathname);

  if (screen.type === 'pushed') {
    // No bar on a pushed screen, but the end of a scrolled page must still
    // clear the home indicator, so the safe-area inset is reserved here.
    return (
      <div
        aria-hidden="true"
        className="h-[env(safe-area-inset-bottom)] md:hidden"
      />
    );
  }

  const current = getCurrentPhoneTab(pathname);

  return (
    <nav
      aria-label="App sections"
      data-phone-tab-bar
      className="sticky bottom-0 z-20 mt-auto flex items-start justify-around border-t border-border bg-raised-surface pt-2 pb-[calc(18px_+_env(safe-area-inset-bottom))] pl-[max(8px,env(safe-area-inset-left))] pr-[max(8px,env(safe-area-inset-right))] md:hidden"
    >
      {PHONE_TAB_ORDER.map((id) => {
        const tab = PHONE_TABS[id];
        const isCurrent = id === current;

        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={isCurrent ? 'page' : undefined}
            className="flex min-h-15 w-18 flex-col items-center gap-1 no-underline"
          >
            <span
              className={
                isCurrent
                  ? 'flex h-9 w-15 items-center justify-center rounded-full bg-brand-soft'
                  : 'flex h-9 w-15 items-center justify-center rounded-full bg-transparent'
              }
            >
              <Illustration kind={tab.kind} size={28} />
            </span>
            <span
              className={
                isCurrent
                  ? 'text-label-caps text-brand-text'
                  : 'text-label-caps text-foreground-secondary'
              }
            >
              {tab.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
