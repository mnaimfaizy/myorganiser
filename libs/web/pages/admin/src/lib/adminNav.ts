import type { IllustrationKind } from '@myorganiser/web-ui';

/**
 * The admin sections the shell navigates between. One table is the single
 * source for the sidebar, the phone tab bar and the header crumbs.
 */
export type AdminSectionId = 'overview' | 'users' | 'audit' | 'feedback';

export interface AdminSection {
  title: string;
  url: string;
  kind: IllustrationKind;
}

export const ADMIN_SECTIONS = {
  overview: { title: 'Overview', url: '/admin', kind: 'admin' },
  users: { title: 'Users', url: '/admin/users', kind: 'users' },
  audit: { title: 'Audit log', url: '/admin/audit-logs', kind: 'audit' },
  feedback: { title: 'Feedback', url: '/admin/feedback', kind: 'inbox' },
} as const satisfies Record<AdminSectionId, AdminSection>;

/** Section ids in table order, which is the nav order. */
export const ADMIN_SECTION_IDS = Object.keys(
  ADMIN_SECTIONS,
) as AdminSectionId[];

const ADMIN_HOME_URL = '/admin';
const PORTAL_LABEL = 'Admin portal';

function stripTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * True when the pathname belongs to an admin nav url. `/admin` matches only
 * exactly; every other url also matches as a path prefix followed by `/`.
 */
export function isAdminNavItemActive(pathname: string, url: string): boolean {
  const current = stripTrailingSlash(pathname);
  const target = stripTrailingSlash(url);

  if (current === target) {
    return true;
  }

  if (target === ADMIN_HOME_URL) {
    return false;
  }

  return current.startsWith(`${target}/`);
}

export interface AdminCrumb {
  label: string;
  /** Absent for the crumb that is the current location; rendered as text. */
  href?: string;
}

export interface AdminHeaderState {
  title: string;
  crumbs: AdminCrumb[];
}

/**
 * Resolves the desktop header's title and crumb trail from the pathname.
 * - `/admin` → "Overview", crumb "Admin portal" (current, not a link).
 * - A section root → its title, crumb "Admin portal" (a link).
 * - A deeper route under a section (a user or report id) → "Details", with
 *   the trail "Admin portal › <section>", each a link.
 * - Anything else under no section → "Admin portal" for both title and crumb.
 */
export function resolveAdminHeader(pathname: string): AdminHeaderState {
  const current = stripTrailingSlash(pathname);
  const id = ADMIN_SECTION_IDS.find((sectionId) =>
    isAdminNavItemActive(current, ADMIN_SECTIONS[sectionId].url),
  );

  if (id === undefined) {
    return { title: PORTAL_LABEL, crumbs: [{ label: PORTAL_LABEL }] };
  }

  const section = ADMIN_SECTIONS[id];

  if (id === 'overview') {
    return { title: section.title, crumbs: [{ label: PORTAL_LABEL }] };
  }

  const portalCrumb = { label: PORTAL_LABEL, href: ADMIN_HOME_URL };

  if (stripTrailingSlash(section.url) === current) {
    return { title: section.title, crumbs: [portalCrumb] };
  }

  return {
    title: 'Details',
    crumbs: [portalCrumb, { label: section.title, href: section.url }],
  };
}
