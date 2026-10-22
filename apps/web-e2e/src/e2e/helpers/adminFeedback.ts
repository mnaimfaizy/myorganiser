import type {
  AdminFeedbackReportDetailDto,
  AdminFeedbackReportListItemDto,
  AdminFeedbackReportListResponse,
  FeedbackReportKind,
  FeedbackReportStatus,
} from '@myorganiser/app-api-client';
import { type Page } from '@playwright/test';
import { routeApi } from './apiStub';
import { corsHeaders } from './adminSession';

/**
 * Deterministic admin feedback fixtures and a paged `GET /admin/feedback/reports`
 * stub, plus `GET /admin/feedback/reports/:id` for the report page.
 *
 * The list stub applies the endpoint's filters (status, kind, platform,
 * trackingIssueNumber) to the fixture it is given, then pages it the way the
 * API does: `total` counts every match and `items` holds one page. It records
 * the query of every list GET, so a spec can assert on the exact request the
 * inbox sent. The detail stub answers the fixture when the id matches, else 404.
 *
 * Imported by path, not re-exported from `helpers/index.ts`, so only the admin
 * specs take this dependency.
 */

const DEFAULT_PAGE_SIZE = 25;

/** Fixed base so timestamps and the newest-first order never drift between runs. */
const BASE_MS = Date.UTC(2026, 9, 20, 12, 0);
const STEP_MS = 60 * 60 * 1000;

/** The reporter at this index is removed (`reporter: null`). Exactly one row. */
const DELETED_REPORTER_INDEX = 4;

const PLATFORMS = ['web', 'android', 'ios'] as const;

/** The search params of one list GET, as the inbox sent them. */
export interface AdminFeedbackReportRequest {
  status: string | null;
  kind: string | null;
  platform: string | null;
  trackingIssueNumber: string | null;
  page: number;
  pageSize: number;
}

function pad3(value: number): string {
  return String(value).padStart(3, '0');
}

function reporterFor(
  index: number,
): AdminFeedbackReportListItemDto['reporter'] {
  if (index === DELETED_REPORTER_INDEX) return null;
  const slot = (index % 4) + 1;
  return {
    id: `u-rep-${slot}`,
    name: `Reporter ${slot}`,
    email: `reporter${slot}@example.com`,
  };
}

/** Bug reports and suggestions alternate, starting with a bug report. */
function kindFor(index: number): FeedbackReportKind {
  return index % 2 === 0 ? 'bug_report' : 'suggestion';
}

/**
 * Statuses cycle through five values, so a 30-row fixture holds six Received
 * reports. The fourth and fifth values are the kind's final or refused status.
 */
function statusFor(
  index: number,
  kind: FeedbackReportKind,
): FeedbackReportStatus {
  const isBug = kind === 'bug_report';
  switch (index % 5) {
    case 0:
      return 'received';
    case 1:
      return 'under_review';
    case 2:
      return 'planned';
    case 3:
      return isBug ? 'fixed' : 'shipped';
    default:
      return isBug ? 'cannot_reproduce' : 'wont_do';
  }
}

/**
 * `count` list items, newest first, all deterministic. Item n (0-based) is
 * `fb-00{n+1}`, titled `Report 00{n+1}`. Items 2, 6, 10, … are linked to a
 * tracking issue (`1100 + n`). Report 005 (index 4) has no reporter.
 */
export function buildAdminFeedbackReports(
  count: number,
): AdminFeedbackReportListItemDto[] {
  return Array.from({ length: count }, (_, index) => {
    const kind = kindFor(index);
    return {
      id: `fb-${pad3(index + 1)}`,
      kind,
      status: statusFor(index, kind),
      title: `Report ${pad3(index + 1)}`,
      platform: PLATFORMS[index % PLATFORMS.length],
      trackingIssueNumber: index % 4 === 1 ? 1100 + index : null,
      reporterUserId: reporterFor(index)?.id ?? null,
      reporter: reporterFor(index),
      statusChangedAt: null,
      createdAt: new Date(BASE_MS - index * STEP_MS).toISOString(),
    };
  });
}

/**
 * One full report, matching the first list item (`fb-001`). Overrides merge
 * over the defaults, so a spec can set a final status, a release, or an issue.
 * The default has no tracking issue, which shows the Issue number form.
 */
export function buildAdminFeedbackReportDetail(
  overrides: Partial<AdminFeedbackReportDetailDto> = {},
): AdminFeedbackReportDetailDto {
  const createdAt = new Date(BASE_MS).toISOString();
  return {
    id: 'fb-001',
    kind: 'bug_report',
    status: 'received',
    title: 'Report 001',
    platform: 'web',
    trackingIssueNumber: null,
    reporterUserId: 'u-rep-1',
    reporter: {
      id: 'u-rep-1',
      name: 'Reporter 1',
      email: 'reporter1@example.com',
    },
    statusChangedAt: null,
    createdAt,
    description: 'The export button does nothing when the list is empty.',
    expectedOutcome: 'A CSV file downloads.',
    context: {
      platform: 'web',
      appVersion: '2.0.3',
      browser: 'Chrome 130',
      operatingSystem: 'macOS 15',
      path: '/dashboard/tasks',
      sentAt: createdAt,
    },
    followUp: null,
    statusNote: null,
    releaseTag: null,
    fixNoticeOptIn: true,
    ...overrides,
  };
}

function positiveInt(raw: string | null, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export interface StubAdminFeedbackReportsOptions {
  /** The report `GET /admin/feedback/reports/:id` answers. Defaults to `buildAdminFeedbackReportDetail()`. */
  detail?: AdminFeedbackReportDetailDto;
}

/**
 * Answers `GET /admin/feedback/reports` from `reports`, and
 * `GET /admin/feedback/reports/:id` from `options.detail`, plus OPTIONS
 * preflights. Returns the array each list GET's query is pushed onto, in
 * request order. Read it after the interaction under test, with `expect(...)`.
 */
export async function stubAdminFeedbackReportsPaged(
  page: Page,
  reports: AdminFeedbackReportListItemDto[],
  options: StubAdminFeedbackReportsOptions = {},
): Promise<AdminFeedbackReportRequest[]> {
  const detail = options.detail ?? buildAdminFeedbackReportDetail();
  const requests: AdminFeedbackReportRequest[] = [];

  await routeApi(
    page,
    /\/admin\/feedback\/reports(\/[^/?#]+)?\/?(\?.*)?$/,
    async (route) => {
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

      const url = new URL(request.url());
      const detailMatch = /\/admin\/feedback\/reports\/([^/]+)\/?$/.exec(
        url.pathname,
      );

      if (detailMatch) {
        const found = detailMatch[1] === detail.id;
        await route.fulfill({
          status: found ? 200 : 404,
          headers,
          contentType: 'application/json',
          body: JSON.stringify(
            found ? detail : { message: 'Feedback report not found' },
          ),
        });
        return;
      }

      const params = url.searchParams;
      const status = params.get('status');
      const kind = params.get('kind');
      const platform = params.get('platform');
      const trackingIssueNumber = params.get('trackingIssueNumber');
      const pageNumber = positiveInt(params.get('page'), 1);
      const pageSize = positiveInt(params.get('pageSize'), DEFAULT_PAGE_SIZE);

      requests.push({
        status,
        kind,
        platform,
        trackingIssueNumber,
        page: pageNumber,
        pageSize,
      });

      const matches = reports.filter(
        (report) =>
          (status === null || report.status === status) &&
          (kind === null || report.kind === kind) &&
          (platform === null || report.platform === platform) &&
          (trackingIssueNumber === null ||
            report.trackingIssueNumber === Number(trackingIssueNumber)),
      );
      const start = (pageNumber - 1) * pageSize;

      const body: AdminFeedbackReportListResponse = {
        items: matches.slice(start, start + pageSize),
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
    },
  );

  return requests;
}
