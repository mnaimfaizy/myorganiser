import type {
  AdminAuditLogEntry,
  AdminAuditLogListResponse,
  AdminOverviewResponse,
} from '@myorganiser/app-api-client';
import { type Page } from '@playwright/test';
import { routeApi, stubJsonGet } from './apiStub';
import { corsHeaders } from './adminSession';

/**
 * Deterministic `/admin/overview` and `/admin/audit-logs` stubs for the admin
 * shell. The provider reads the overview on every admin page, and the Overview
 * page reads the newest audit entries, so any admin spec that lands on a page
 * under `/admin` needs both.
 */

const OVERVIEW_URL = /\/admin\/overview\/?(\?.*)?$/;
const AUDIT_LOGS_URL = /\/admin\/audit-logs\/?(\?.*)?$/;

export const ADMIN_OVERVIEW_FIXTURE: AdminOverviewResponse = {
  users: 148,
  usersJoinedLast7Days: 6,
  platformAdmins: 3,
  unverified: 12,
  unverifiedOverAWeek: 5,
  disabled: 4,
  youtubeAccessPlacesUsed: 20,
  youtubeAccessPlacesLeft: 5,
  youtubeAccessCeiling: 25,
  feedbackReportsReceived: 5,
};

export const ADMIN_AUDIT_FIXTURE: AdminAuditLogEntry[] = [
  {
    id: 'al-1',
    actorUserId: 'a-session',
    targetUserId: 'u-1',
    actorName: 'Session Admin',
    targetName: 'User One',
    actorDeleted: false,
    targetDeleted: false,
    action: 'promote',
    createdAt: '2026-10-20T09:00:00.000Z',
  },
  {
    id: 'al-2',
    actorUserId: 'a-session',
    targetUserId: null,
    actorName: 'Session Admin',
    targetName: null,
    actorDeleted: false,
    targetDeleted: true,
    action: 'youtube_access_grant',
    createdAt: '2026-10-19T09:00:00.000Z',
  },
];

export async function stubAdminOverview(
  page: Page,
  body: AdminOverviewResponse = ADMIN_OVERVIEW_FIXTURE,
) {
  await stubJsonGet(page, OVERVIEW_URL, body);
}

/** Answers GET `/admin/overview` with 500 so the Overview error state renders. */
export async function stubAdminOverviewFailure(page: Page) {
  await routeApi(page, OVERVIEW_URL, async (route) => {
    const origin = new URL(page.url() || 'http://localhost:4200').origin;
    const headers = corsHeaders(origin);

    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }

    await route.fulfill({
      status: 500,
      headers,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Internal Server Error' }),
    });
  });
}

export async function stubAdminAuditLogs(
  page: Page,
  entries: AdminAuditLogEntry[] = ADMIN_AUDIT_FIXTURE,
) {
  const body: AdminAuditLogListResponse = {
    entries,
    total: entries.length,
    page: 1,
    pageSize: 25,
  };
  await stubJsonGet(page, AUDIT_LOGS_URL, body);
}
