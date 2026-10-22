import type { AdminUserIdentity } from '@myorganiser/app-api-client';
import { type Page } from '@playwright/test';
import { routeApi } from './apiStub';
import { corsHeaders } from './adminSession';

/**
 * Deterministic `GET /admin/users` stub for the admin Users directory.
 *
 * The stub applies the endpoint's filters and sort to the fixture it is given,
 * and pages it the way the API does: `total` counts every match, `users` holds
 * one page. It records the search params of every GET, so a spec can assert on
 * the exact request the page sent. The stub does not match `/admin/users/{id}`.
 *
 * Imported by path, not re-exported from `helpers/index.ts`, so only the admin
 * specs take this dependency.
 */

const ADMIN_USERS_URL = /\/admin\/users\/?(\?.*)?$/;

const DEFAULT_PAGE_SIZE = 25;

/** The search params of one GET, as the page sent them. */
export type AdminUsersRequest = Record<string, string>;

type FixtureStatus = 'active' | 'unverified' | 'disabled';

/** Disabled wins, then unverified, then active. Matches the endpoint. */
function fixtureStatus(user: AdminUserIdentity): FixtureStatus {
  if (user.disabled) return 'disabled';
  return user.emailVerified ? 'active' : 'unverified';
}

/**
 * `count` users with a mix of roles and statuses, all deterministic.
 * Index n (1-based) is an admin when n % 5 === 0, disabled when n % 7 === 0,
 * and unverified when n % 3 === 0 and it is not disabled. Joined dates
 * ascend with n, so the newest first order is the reverse of n. Names never
 * contain "Admin" or "User", so a row's role pill is the only place those
 * words appear.
 */
export function buildAdminUsers(count: number): AdminUserIdentity[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return {
      id: `u-${String(n).padStart(3, '0')}`,
      name: `Member ${n}`,
      email: `member${n}@example.com`,
      firstName: 'Member',
      lastName: String(n),
      role: n % 5 === 0 ? 'platform_admin' : 'user',
      disabled: n % 7 === 0,
      emailVerified: n % 3 !== 0,
      youtubeAccess: false,
      createdAt: new Date(Date.UTC(2026, 0, n)).toISOString(),
    };
  });
}

function matchesQuery(user: AdminUserIdentity, query: string): boolean {
  const haystack = [
    user.name,
    user.email,
    user.firstName,
    user.lastName,
    `${user.firstName} ${user.lastName}`,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function sortUsers(
  users: AdminUserIdentity[],
  sort: string,
): AdminUserIdentity[] {
  const sorted = [...users];
  if (sort === 'name') {
    return sorted.sort((a, b) => a.name.localeCompare(b.name));
  }
  return sorted.sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

function positiveInt(raw: string | null, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * Answers GET `/admin/users` from `users`, and OPTIONS with a CORS preflight.
 * Returns the array the GET search params are pushed onto, in request order.
 * Read it after the interaction under test, with `expect(...).toEqual(...)`.
 */
export async function stubAdminUsers(
  page: Page,
  users: AdminUserIdentity[],
): Promise<AdminUsersRequest[]> {
  const requests: AdminUsersRequest[] = [];

  await routeApi(page, ADMIN_USERS_URL, async (route) => {
    const origin = new URL(page.url() || 'http://localhost:4200').origin;
    const headers = corsHeaders(origin);
    const request = route.request();

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }

    if (request.method() !== 'GET') {
      await route.fulfill({ status: 405, headers });
      return;
    }

    const params = new URL(request.url()).searchParams;
    requests.push(Object.fromEntries(params.entries()));

    const q = params.get('q')?.trim().toLowerCase();
    const status = params.get('status');
    const role = params.get('role');
    const pageSize = positiveInt(params.get('pageSize'), DEFAULT_PAGE_SIZE);
    const pageNumber = positiveInt(params.get('page'), 1);

    const matches = sortUsers(
      users.filter(
        (user) =>
          (!q || matchesQuery(user, q)) &&
          (!status || fixtureStatus(user) === status) &&
          (!role || user.role === role),
      ),
      params.get('sort') ?? 'newest',
    );
    const start = (pageNumber - 1) * pageSize;

    await route.fulfill({
      status: 200,
      headers,
      contentType: 'application/json',
      body: JSON.stringify({
        users: matches.slice(start, start + pageSize),
        total: matches.length,
        page: pageNumber,
        pageSize,
      }),
    });
  });

  return requests;
}
