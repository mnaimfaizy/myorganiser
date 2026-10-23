import type { AdminFeedbackReportDetailDto } from '@myorganiser/app-api-client';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  expectNoHorizontalOverflow,
  expectSingleH1,
  gotoStable,
} from './helpers';
import {
  seedSession,
  stubAuthRefresh,
  type PersonaUser,
} from './helpers/adminSession';
import { stubAdminOverview } from './helpers/adminOverview';
import {
  buildAdminFeedbackReportDetail,
  buildAdminFeedbackReports,
  stubAdminFeedbackReportsPaged,
  type AdminFeedbackReportRequest,
} from './helpers/adminFeedback';
import { PHONE_VIEWPORT } from './helpers/shellLayout';

/**
 * Admin Feedback layout (#1269): the /admin/feedback inbox and the
 * /admin/feedback/{id} report page at desktop and phone widths. The inbox's
 * header, filter toolbar, paged table and pager (desktop), the status chips,
 * the filter sheet and the appended list (phone), and the report's reading
 * column with its Triage panel.
 *
 * Hermetic stubs (every request the pages make is answered here):
 * - `/auth/refresh` returns the seeded platform admin (OPTIONS + GET).
 * - `GET /admin/overview` returns fixed counts. The admin shell reads it on mount.
 * - `GET /admin/feedback/reports` returns a 30-report fixture, filtered and
 *   paged the way the endpoint does. Each list request's query is recorded.
 * - `GET /admin/feedback/reports/:id` returns one report. See
 *   `helpers/adminFeedback.ts`.
 *
 * No live third-party services and no admin mutation endpoints.
 */

const PLATFORM_ADMIN: PersonaUser = {
  id: 'a-session',
  name: 'Session Admin',
  email: 'session-admin@example.com',
  firstName: 'Session',
  lastName: 'Admin',
  role: 'platform_admin',
  disabled: false,
};

const DESKTOP_VIEWPORT = { width: 1440, height: 1000 };

const FEEDBACK_REPORTS = buildAdminFeedbackReports(30);
const TOTAL = FEEDBACK_REPORTS.length;

/** Reports with status received. Counted from the fixture, not hard-coded. */
const RECEIVED_COUNT = FEEDBACK_REPORTS.filter(
  (report) => report.status === 'received',
).length;

/** Reports on iOS, the platform the Platform test picks. */
const IOS_COUNT = FEEDBACK_REPORTS.filter(
  (report) => report.platform === 'ios',
).length;

/** Seeds the session, stubs the reads, and opens a feedback page. */
async function openFeedback(
  page: Page,
  path: string,
  options: { detail?: AdminFeedbackReportDetailDto } = {},
): Promise<AdminFeedbackReportRequest[]> {
  await seedSession(page, PLATFORM_ADMIN);
  await stubAuthRefresh(page, PLATFORM_ADMIN);
  await stubAdminOverview(page);
  const requests = await stubAdminFeedbackReportsPaged(
    page,
    FEEDBACK_REPORTS,
    options,
  );

  await gotoStable(page, path);

  return requests;
}

/** The desktop table body rows. The header row is not counted. */
function getTableRows(page: Page): Locator {
  return page
    .getByRole('region', { name: 'Feedback reports', exact: true })
    .locator('tbody')
    .getByRole('row');
}

/** The phone list rows. Each report is one link, named by its title first. */
function getPhoneRows(page: Page): Locator {
  return page.getByRole('link', { name: /^Report \d{3}/ });
}

function getPager(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Pages', exact: true });
}

test.describe('Admin Feedback layout (E2E)', () => {
  test.describe('at 1440', () => {
    test.use({ viewport: DESKTOP_VIEWPORT });

    test('the inbox header, filter toolbar, first page of rows, and pager render', async ({
      page,
    }) => {
      test.setTimeout(60000);

      const requests = await openFeedback(page, '/admin/feedback');

      await expectSingleH1(page, 'Feedback');
      await expect(
        page.getByText(
          `Bug Reports and Suggestions, newest first. ${RECEIVED_COUNT} are Received and waiting for triage.`,
          { exact: true },
        ),
      ).toBeVisible({ timeout: 60000 });

      const toolbar = page.getByRole('toolbar', {
        name: 'Filter feedback reports',
        exact: true,
      });
      await expect(toolbar.getByLabel('Status', { exact: true })).toBeVisible();
      await expect(toolbar.getByLabel('Kind', { exact: true })).toBeVisible();
      await expect(
        toolbar.getByLabel('Platform', { exact: true }),
      ).toBeVisible();
      await expect(
        toolbar.getByLabel('Tracking issue', { exact: true }),
      ).toBeVisible();
      await expect(
        toolbar.getByRole('button', { name: 'Clear filters', exact: true }),
      ).toBeVisible();

      await expect(getTableRows(page)).toHaveCount(25, { timeout: 60000 });
      await expect(
        getPager(page).getByText(`Showing 1–25 of ${TOTAL} reports`, {
          exact: true,
        }),
      ).toBeVisible();

      expect(requests).toContainEqual({
        status: null,
        kind: null,
        platform: null,
        trackingIssueNumber: null,
        page: 1,
        pageSize: 25,
      });

      await expectNoHorizontalOverflow(page, 'Feedback inbox at 1440px');
    });

    test('Older moves to page 2 with the last five reports', async ({
      page,
    }) => {
      test.setTimeout(60000);

      const requests = await openFeedback(page, '/admin/feedback');

      const rows = getTableRows(page);
      await expect(rows).toHaveCount(25, { timeout: 60000 });

      const pager = getPager(page);
      await pager.getByRole('button', { name: 'Older', exact: true }).click();

      await expect(
        pager.getByText(`Showing 26–${TOTAL} of ${TOTAL} reports`, {
          exact: true,
        }),
      ).toBeVisible({ timeout: 60000 });
      await expect(rows).toHaveCount(TOTAL - 25, { timeout: 60000 });
      expect(requests.at(-1)).toEqual({
        status: null,
        kind: null,
        platform: null,
        trackingIssueNumber: null,
        page: 2,
        pageSize: 25,
      });
    });

    test('choosing iOS in Platform sends platform=ios, and the range says matching reports', async ({
      page,
    }) => {
      test.setTimeout(60000);

      const requests = await openFeedback(page, '/admin/feedback');

      await expect(getTableRows(page)).toHaveCount(25, { timeout: 60000 });

      await page.getByRole('combobox', { name: /^Platform/ }).click();
      await page.getByRole('option', { name: 'iOS', exact: true }).click();

      await expect(getTableRows(page)).toHaveCount(IOS_COUNT, {
        timeout: 60000,
      });
      await expect(
        getPager(page).getByText(
          `Showing 1–${IOS_COUNT} of ${IOS_COUNT} matching reports`,
          { exact: true },
        ),
      ).toBeVisible();
      expect(requests.at(-1)).toEqual({
        status: null,
        kind: null,
        platform: 'ios',
        trackingIssueNumber: null,
        page: 1,
        pageSize: 25,
      });
    });

    test('a tracking issue number filters to that issue, and Clear filters restores every report', async ({
      page,
    }) => {
      test.setTimeout(60000);

      const requests = await openFeedback(page, '/admin/feedback');

      await expect(getTableRows(page)).toHaveCount(25, { timeout: 60000 });

      // Report 002 is linked to tracking issue 1101; it is the only match.
      await page
        .getByRole('toolbar', { name: 'Filter feedback reports', exact: true })
        .getByLabel('Tracking issue', { exact: true })
        .fill('1101');

      await expect(getTableRows(page)).toHaveCount(1, { timeout: 60000 });
      await expect(
        getPager(page).getByText('Showing 1–1 of 1 matching reports', {
          exact: true,
        }),
      ).toBeVisible();
      expect(requests.at(-1)).toMatchObject({
        trackingIssueNumber: '1101',
        page: 1,
      });

      await page
        .getByRole('toolbar', { name: 'Filter feedback reports', exact: true })
        .getByRole('button', { name: 'Clear filters', exact: true })
        .click();

      await expect(getTableRows(page)).toHaveCount(25, { timeout: 60000 });
      await expect(
        getPager(page).getByText(`Showing 1–25 of ${TOTAL} reports`, {
          exact: true,
        }),
      ).toBeVisible();
      expect(requests.at(-1)).toMatchObject({
        trackingIssueNumber: null,
        platform: null,
        page: 1,
      });
    });

    test('a report whose reporter was removed reads "Deleted" in the Sender column', async ({
      page,
    }) => {
      test.setTimeout(60000);

      await openFeedback(page, '/admin/feedback');

      const row = getTableRows(page).filter({ hasText: 'Report 005' });
      await expect(row).toHaveCount(1, { timeout: 60000 });
      await expect(row).toContainText('Deleted');
    });

    test('a row opens its report at /admin/feedback/{id}, whose Triage panel offers the status, tracking, and delivery forms', async ({
      page,
    }) => {
      test.setTimeout(60000);

      await openFeedback(page, '/admin/feedback');

      await page
        .getByRole('region', { name: 'Feedback reports', exact: true })
        .getByRole('link', { name: 'Report 001', exact: true })
        .click();

      await expect(page).toHaveURL(/\/admin\/feedback\/fb-001\/?(\?.*)?$/, {
        timeout: 60000,
      });
      await expectSingleH1(page, 'Report 001');

      const triage = page.getByRole('complementary', {
        name: 'Triage',
        exact: true,
      });
      await expect(triage).toBeVisible({ timeout: 60000 });
      await expect(
        triage.getByRole('heading', {
          level: 3,
          name: 'Change status',
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        triage.getByRole('heading', {
          level: 3,
          name: 'Tracking issue',
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        triage.getByRole('heading', {
          level: 3,
          name: 'Mark fixed',
          exact: true,
        }),
      ).toBeVisible();

      await expect(triage.getByLabel('Status', { exact: true })).toBeVisible();
      await expect(
        triage.getByLabel('Status note', { exact: true }),
      ).toBeVisible();
      await expect(
        triage.getByLabel('Issue number', { exact: true }),
      ).toBeVisible();
      await expect(triage.getByLabel('Release', { exact: true })).toBeVisible();

      await expectNoHorizontalOverflow(page, 'Feedback report at 1440px');
    });

    test('a fixed report shows its final notice, tracking link, and Reopen, with no change forms', async ({
      page,
    }) => {
      test.setTimeout(60000);

      await openFeedback(page, '/admin/feedback/fb-001', {
        detail: buildAdminFeedbackReportDetail({
          status: 'fixed',
          releaseTag: 'v2.1.0',
          trackingIssueNumber: 1187,
        }),
      });

      await expectSingleH1(page, 'Report 001');

      const triage = page.getByRole('complementary', {
        name: 'Triage',
        exact: true,
      });
      await expect(triage).toBeVisible({ timeout: 60000 });
      await expect(
        triage.getByText(
          'This report is fixed in v2.1.0. It stays final unless you reopen it.',
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        triage.getByText('Tracking Issue:', { exact: true }),
      ).toBeVisible();
      await expect(
        triage.getByRole('link', { name: /^#1187/ }),
      ).toHaveAttribute(
        'href',
        'https://github.com/mnaimfaizy/myorganiser/issues/1187',
      );
      await expect(
        triage.getByRole('heading', { level: 3, name: 'Reopen', exact: true }),
      ).toBeVisible();
      await expect(
        triage.getByRole('heading', {
          level: 3,
          name: 'Change status',
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        triage.getByRole('heading', {
          level: 3,
          name: 'Tracking issue',
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        triage.getByRole('heading', {
          level: 3,
          name: 'Mark fixed',
          exact: true,
        }),
      ).toHaveCount(0);
    });
  });

  test.describe('at 390', () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test('one heading, the Status chips with All statuses pressed, and the first 25 reports as links', async ({
      page,
    }) => {
      test.setTimeout(60000);

      await openFeedback(page, '/admin/feedback');

      await expectSingleH1(page, 'Feedback');
      await expect(
        page.getByText(`${RECEIVED_COUNT} Received, waiting for triage`, {
          exact: true,
        }),
      ).toBeVisible({ timeout: 60000 });

      const statusChips = page.getByRole('toolbar', {
        name: 'Status',
        exact: true,
      });
      await expect(
        statusChips.getByRole('button', { name: 'All statuses', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');

      await expect(getPhoneRows(page)).toHaveCount(25, { timeout: 60000 });
      await expect(
        page.getByText(`Scroll for more · 25 of ${TOTAL}`, { exact: true }),
      ).toBeVisible();

      await expectNoHorizontalOverflow(page, 'Feedback inbox at 390px');
    });

    test('pressing Received sends status=received, moves the pressed chip, and lists the received reports', async ({
      page,
    }) => {
      test.setTimeout(60000);

      const requests = await openFeedback(page, '/admin/feedback');

      await expect(getPhoneRows(page)).toHaveCount(25, { timeout: 60000 });

      const statusChips = page.getByRole('toolbar', {
        name: 'Status',
        exact: true,
      });
      await statusChips
        .getByRole('button', { name: 'Received', exact: true })
        .click();

      await expect(
        statusChips.getByRole('button', { name: 'Received', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(
        statusChips.getByRole('button', { name: 'All statuses', exact: true }),
      ).toHaveAttribute('aria-pressed', 'false');
      await expect(getPhoneRows(page)).toHaveCount(RECEIVED_COUNT, {
        timeout: 60000,
      });
      expect(requests.at(-1)).toMatchObject({ status: 'received', page: 1 });
    });

    test('Filters opens a sheet, choosing a Kind updates the trigger to Filters · 1, and the page does not overflow after Done', async ({
      page,
    }) => {
      test.setTimeout(60000);

      const requests = await openFeedback(page, '/admin/feedback');

      await expect(getPhoneRows(page)).toHaveCount(25, { timeout: 60000 });

      await page.getByRole('button', { name: 'Filters', exact: true }).click();

      const sheet = page.getByRole('dialog', { name: 'Filters', exact: true });
      await expect(sheet).toBeVisible();
      await sheet.getByLabel('Kind', { exact: true }).click();
      await page
        .getByRole('option', { name: 'Bug report', exact: true })
        .click();
      await sheet.getByRole('button', { name: 'Done', exact: true }).click();

      await expect(sheet).toBeHidden();
      await expect(
        page.getByRole('button', { name: 'Filters · 1', exact: true }),
      ).toBeVisible();
      expect(requests.at(-1)).toMatchObject({
        kind: 'bug_report',
        page: 1,
      });

      await expectNoHorizontalOverflow(
        page,
        'Feedback inbox at 390px after the filter sheet closes',
      );
    });

    test('the report page at 390px has a Back to Feedback link, one heading, a compact context line, and the Triage panel', async ({
      page,
    }) => {
      test.setTimeout(60000);

      await openFeedback(page, '/admin/feedback/fb-001');

      await expect(
        page.getByRole('link', { name: 'Back to Feedback', exact: true }),
      ).toHaveAttribute('href', '/admin/feedback');
      await expectSingleH1(page, 'Report 001');
      await expect(
        page.getByRole('heading', { name: 'Triage', exact: true }),
      ).toBeVisible({ timeout: 60000 });
      await expect(page.getByText(/^web · /)).toBeVisible();

      await expectNoHorizontalOverflow(page, 'Feedback report at 390px');
    });
  });
});
