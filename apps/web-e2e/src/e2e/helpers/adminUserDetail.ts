import type {
  AdminUserIdentity,
  YouTubeAccessUsageResponse,
} from '@myorganiser/app-api-client';
import { type Page } from '@playwright/test';
import { routeApi } from './apiStub';
import { corsHeaders } from './adminSession';

/**
 * Deterministic `GET /admin/users/{userId}` and `GET /admin/youtube-access`
 * stubs for the admin User detail page, plus a recorder for every non-GET
 * request to `/admin/users/{userId}/...`.
 *
 * - `GET /admin/users/{userId}` answers the identity from `users`, or 404 for
 *   an id that is not in it.
 * - Any other method on `/admin/users/{userId}/...` (the lifecycle mutations)
 *   is recorded and answered 405, so a spec can assert that no mutation was
 *   sent without the request reaching the network.
 *
 * The URL pattern needs a path segment after `/admin/users/`, so it never
 * matches the `/admin/users` list stub in `adminUsers.ts`.
 *
 * Imported by path, not re-exported from `helpers/index.ts`, so only the admin
 * specs take this dependency.
 */

const USER_DETAIL_URL = /\/admin\/users\/[^/?]+(\/[^?]*)?(\?.*)?$/;
const YOUTUBE_ACCESS_USAGE_URL = /\/admin\/youtube-access\/?(\?.*)?$/;

/** A non-GET request sent to a user's detail or lifecycle endpoint. */
export interface AdminUserDetailMutation {
  method: string;
  /** The URL path, without the query string. */
  path: string;
}

/**
 * Answers GET `/admin/users/{userId}` from `users`, and records every non-GET
 * request under `/admin/users/{userId}/...`. Returns the array the mutations
 * are pushed onto, in request order.
 */
export async function stubAdminUserDetail(
  page: Page,
  users: AdminUserIdentity[],
): Promise<AdminUserDetailMutation[]> {
  const mutations: AdminUserDetailMutation[] = [];

  await routeApi(page, USER_DETAIL_URL, async (route) => {
    const origin = new URL(page.url() || 'http://localhost:4200').origin;
    const headers = corsHeaders(origin);
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }

    if (method !== 'GET') {
      mutations.push({ method, path: url.pathname });
      await route.fulfill({ status: 405, headers });
      return;
    }

    // The API base carries a prefix (`/api/v1`), so anchor on `/admin/users/`.
    const match = url.pathname.match(/\/admin\/users\/([^/]+)(\/.*)?$/);
    const isDetail = match !== null && match[2] === undefined;
    const userId = match ? decodeURIComponent(match[1]) : '';
    const user = isDetail
      ? users.find((candidate) => candidate.id === userId)
      : undefined;

    if (!user) {
      await route.fulfill({
        status: 404,
        headers,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'User not found' }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      headers,
      contentType: 'application/json',
      body: JSON.stringify(user),
    });
  });

  return mutations;
}

/** Answers GET `/admin/youtube-access` with `usage`, and OPTIONS with a CORS preflight. */
export async function stubYouTubeAccessUsage(
  page: Page,
  usage: YouTubeAccessUsageResponse,
): Promise<void> {
  await routeApi(page, YOUTUBE_ACCESS_USAGE_URL, async (route) => {
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

    await route.fulfill({
      status: 200,
      headers,
      contentType: 'application/json',
      body: JSON.stringify(usage),
    });
  });
}
