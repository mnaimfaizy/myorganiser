import type { IllustrationKind } from '@myorganiser/web-ui';

import {
  getBreadcrumbItems,
  getSegmentLabel,
} from '../components/DynamicBreadcrumb';
import { isNavItemActive } from '../components/nav-main';

/** The five tabs of the phone tab bar, in bar order. */
export type PhoneTabId = 'home' | 'tasks' | 'groceries' | 'vault' | 'more';

export interface PhoneTab {
  id: PhoneTabId;
  label: string;
  href: string;
  kind: IllustrationKind;
}

export const PHONE_TAB_ORDER: readonly PhoneTabId[] = [
  'home',
  'tasks',
  'groceries',
  'vault',
  'more',
];

export const PHONE_TABS = {
  home: { id: 'home', label: 'Home', href: '/dashboard', kind: 'home' },
  tasks: {
    id: 'tasks',
    label: 'Tasks',
    href: '/dashboard/tasks',
    kind: 'tasks',
  },
  groceries: {
    id: 'groceries',
    label: 'Groceries',
    href: '/dashboard/groceries',
    kind: 'groceries',
  },
  vault: {
    id: 'vault',
    label: 'Vault',
    href: '/dashboard/vault',
    kind: 'vault',
  },
  more: { id: 'more', label: 'More', href: '/dashboard/more', kind: 'more' },
} as const satisfies Record<PhoneTabId, PhoneTab>;

/**
 * What the phone shell shows for a route. A tab root has a large title and the
 * tab bar; a pushed screen has a back link and no tab bar. A pushed screen
 * whose last segment is an id has no title of its own: the page supplies it.
 */
export type PhoneScreen =
  | { type: 'root'; tab: PhoneTabId; title: string; kind: IllustrationKind }
  | {
      type: 'pushed';
      tab: PhoneTabId;
      title: string | null;
      back: { label: string; href: string };
    };

/**
 * The tab marked current for a route. Home matches only the dashboard root;
 * the other bar tabs also match their sub-routes, and every section that is
 * not on the bar belongs to More.
 */
export function getCurrentPhoneTab(pathname: string): PhoneTabId {
  if (pathname === '' || isNavItemActive(pathname, PHONE_TABS.home.href)) {
    return 'home';
  }

  const tab = PHONE_TAB_ORDER.find(
    (id) => id !== 'home' && isNavItemActive(pathname, PHONE_TABS[id].href),
  );

  return tab ?? 'more';
}

/**
 * Resolves a route to a tab root or a pushed screen. A section reached from
 * More goes back to More; a nested screen goes back to its parent route.
 */
export function getPhoneScreen(pathname: string): PhoneScreen {
  const tab = getCurrentPhoneTab(pathname);
  const crumbs = getBreadcrumbItems(pathname);
  const current = crumbs[crumbs.length - 1];
  const root = PHONE_TABS[tab];

  if (current.href === root.href) {
    return { type: 'root', tab, title: root.label, kind: root.kind };
  }

  const segment = current.href.slice(current.href.lastIndexOf('/') + 1);
  const parent = crumbs[crumbs.length - 2];
  const back =
    parent.href === PHONE_TABS.home.href
      ? { label: PHONE_TABS.more.label, href: PHONE_TABS.more.href }
      : { label: parent.label, href: parent.href };

  return { type: 'pushed', tab, title: getSegmentLabel(segment), back };
}
