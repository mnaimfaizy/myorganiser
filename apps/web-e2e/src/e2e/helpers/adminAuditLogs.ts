import type {
  AdminAuditAction,
  AdminAuditLogEntry,
  AdminAuditLogListResponse,
} from '@myorganiser/app-api-client';
import { type Page } from '@playwright/test';
import { routeApi } from './apiStub';
import { corsHeaders } from './adminSession';

/**
 * Deterministic, paged `GET /admin/audit-logs` stub for the Audit log page.
 *
 * The stub applies the endpoint's filters to the fixture it is given (the
 * `userId` matches the actor OR the target; the repeated `action` keys select
 * any listed action), then pages it the way the API does: `total` counts every
 * match and `entries` holds one page. It records the query of every GET, so a
 * spec can assert on the exact request the page sent.
 *
 * Imported by path, not re-exported from `helpers/index.ts`, so only the admin
 * specs take this dependency. Register it after `stubAdminAuditLogs` if a spec
 * uses both: the route registered last wins.
 */

const AUDIT_LOGS_URL = /\/admin\/audit-logs\/?(\?.*)?$/;

const DEFAULT_PAGE_SIZE = 25;

/** Actions rotate through this list, index by index. */
const ACTIONS: AdminAuditAction[] = [
  'disable',
  'enable',
  'youtube_access_grant',
  'resend_verification',
  'force_logout',
];

/** Two named admins. Entries alternate between them. */
const ACTORS = [
  { id: 'a-sam', name: 'Sam Miller' },
  { id: 'a-jo', name: 'Jo Park' },
] as const;

/** Six named members are the targets. Index n (0-based) targets member (n % 6) + 1. */
const TARGET_COUNT = 6;

/** Entries step back this many hours each, newest first. */
const STEP_MS = 3 * 60 * 60 * 1000;

/** The entry at this index has its target User deleted. */
const DELETED_TARGET_INDEX = 7;

/**
 * The newest entry lands at module load, so the first few entries fall on
 * today and yesterday in local time. The phone's day headings depend on this.
 */
const BASE_MS = Date.now();

/** The search params of one GET, as the page sent them. */
export interface AdminAuditLogRequest {
  /** Null when the request had no `userId`. */
  userId: string | null;
  /** The repeated `action` keys, in request order. Empty when none. */
  action: string[];
  page: number;
  pageSize: number;
}

function pad3(value: number): string {
  return String(value).padStart(3, '0');
}

/**
 * `count` audit entries, newest first, all deterministic. Entry n (0-based)
 * has action `ACTIONS[n % 5]`, actor `ACTORS[n % 2]`, and target
 * `Member ((n % 6) + 1)`, which is `u-00k`. Entry 7 has its target deleted.
 */
export function buildAdminAuditEntries(count: number): AdminAuditLogEntry[] {
  return Array.from({ length: count }, (_, index) => {
    const actor = ACTORS[index % ACTORS.length];
    const targetNumber = (index % TARGET_COUNT) + 1;
    const targetDeleted = index === DELETED_TARGET_INDEX;

    return {
      id: `al-${pad3(index + 1)}`,
      actorUserId: actor.id,
      targetUserId: targetDeleted ? null : `u-${pad3(targetNumber)}`,
      actorName: actor.name,
      targetName: targetDeleted ? null : `Member ${targetNumber}`,
      actorDeleted: false,
      targetDeleted,
      action: ACTIONS[index % ACTIONS.length],
      createdAt: new Date(BASE_MS - index * STEP_MS).toISOString(),
    };
  });
}

function positiveInt(raw: string | null, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * Answers GET `/admin/audit-logs` from `entries`, and OPTIONS with a CORS
 * preflight. Returns the array each GET's query is pushed onto, in request
 * order. Read it after the interaction under test, with `expect(...)`.
 */
export async function stubAdminAuditLogsPaged(
  page: Page,
  entries: AdminAuditLogEntry[],
): Promise<AdminAuditLogRequest[]> {
  const requests: AdminAuditLogRequest[] = [];

  await routeApi(page, AUDIT_LOGS_URL, async (route) => {
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
    const userId = params.get('userId');
    const actions = params.getAll('action');
    const pageNumber = positiveInt(params.get('page'), 1);
    const pageSize = positiveInt(params.get('pageSize'), DEFAULT_PAGE_SIZE);

    requests.push({ userId, action: actions, page: pageNumber, pageSize });

    const matches = entries.filter(
      (entry) =>
        (userId === null ||
          entry.actorUserId === userId ||
          entry.targetUserId === userId) &&
        (actions.length === 0 || actions.includes(entry.action)),
    );
    const start = (pageNumber - 1) * pageSize;

    const body: AdminAuditLogListResponse = {
      entries: matches.slice(start, start + pageSize),
      total: matches.length,
      page: pageNumber,
      pageSize,
    };

    await route.fulfill({
      status: 200,
      headers,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  return requests;
}
