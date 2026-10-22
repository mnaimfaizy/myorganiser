import { expect, test, type Page } from '@playwright/test';
import {
  E2E_USER_ID,
  expectNoHorizontalOverflow,
  expectSingleH1,
  gotoStable,
  type IdentityEntry,
} from './helpers';
import { stubJsonGet, stubJsonPost } from './helpers/apiStub';
// The public unsubscribe page has no <main>, so the helpers/layout.ts check
// (which fails without one) cannot run there. Use the document-only variant.
import {
  expectNoHorizontalOverflow as expectDocumentNoHorizontalOverflow,
  PHONE_VIEWPORT,
  signInToShell,
  tabBar,
} from './helpers/shellLayout';

/**
 * Feedback layout and roles (issue #1259, Web v2.0 Feedback redesign).
 *
 * The acceptance check: one h1 per screen, the labelled kind choice and
 * details fields in the Send feedback dialog, the report cards with their
 * follow-up form and changelog link, the empty state, the Fix Notice
 * unsubscribe page for a missing token, and no horizontal overflow. Checked at
 * 1440px (the two-column dialog and the report cards) and at 390px (the phone
 * list and sheet, reached from More).
 *
 * Not asserted here:
 * - submitting a report or a follow-up: the send journey is in
 *   feedback-send.spec.ts, and this spec never presses "Send report" or
 *   "Send follow-up";
 * - the unsubscribe request for a real token, and its done and error states;
 * - the Updated badge on More and the phone sheet's safe-area and sticky styling.
 *
 * Hermetic: sign-in is stubbed by signInToShell. This spec overrides the
 * reports list with a fixed four-report fixture, and stubs the seen mark that
 * Your reports posts on mount. The unsubscribe page makes no request without a
 * token; a request counter shows that.
 */

const EMAIL = 'feedback-layout-01@example.com';
const LOGIN_FIXTURE = 'fb-layout-01';
const USER_NAME = 'Fran Okafor';

const IDENTITIES: IdentityEntry[] = [
  {
    match: 'feedback-layout-01',
    userId: E2E_USER_ID,
    userName: USER_NAME,
  },
];

const DESKTOP_VIEWPORT = { width: 1440, height: 1000 };
const CHANGELOG_URL = 'https://changelog.example.com/v2-1-0';

interface ReportFixture {
  id: string;
  kind: 'bug_report' | 'suggestion';
  status:
    | 'received'
    | 'under_review'
    | 'planned'
    | 'fixed'
    | 'shipped'
    | 'cannot_reproduce';
  title: string;
  statusNote: string | null;
  releaseTag: string | null;
  changelogUrl: string | null;
  statusChangedAt: string | null;
  createdAt: string;
  followUp: string | null;
}

const CREATED_AT = '2026-09-02T09:00:00.000Z';

/**
 * Four reports, one per branch the cards render: a cannot-reproduce bug with
 * no follow-up (the follow-up form), a fixed bug with a release and changelog
 * (the link), a planned suggestion with a status note, and an under-review bug
 * with a follow-up already sent.
 */
const FOUR_REPORTS: ReportFixture[] = [
  {
    id: 'fb-layout-r1',
    kind: 'bug_report',
    status: 'cannot_reproduce',
    title: 'Export button does nothing',
    statusNote: 'We could not reproduce this on the latest build.',
    releaseTag: null,
    changelogUrl: null,
    statusChangedAt: CREATED_AT,
    createdAt: CREATED_AT,
    followUp: null,
  },
  {
    id: 'fb-layout-r2',
    kind: 'bug_report',
    status: 'fixed',
    title: 'Save fails on Safari',
    statusNote: null,
    releaseTag: 'v2.1.0',
    changelogUrl: CHANGELOG_URL,
    statusChangedAt: CREATED_AT,
    createdAt: CREATED_AT,
    followUp: null,
  },
  {
    id: 'fb-layout-r3',
    kind: 'suggestion',
    status: 'planned',
    title: 'Dark mode for the groceries list',
    statusNote: 'Planned for the next release.',
    releaseTag: null,
    changelogUrl: null,
    statusChangedAt: CREATED_AT,
    createdAt: CREATED_AT,
    followUp: null,
  },
  {
    id: 'fb-layout-r4',
    kind: 'bug_report',
    status: 'under_review',
    title: 'Tasks sync twice',
    statusNote: null,
    releaseTag: null,
    changelogUrl: null,
    statusChangedAt: null,
    createdAt: CREATED_AT,
    followUp: 'It happens on every reload.',
  },
];

/**
 * Sign in as the layout owner. The shared sign-in stubs the reports list
 * (empty), YouTube availability and YouTube status.
 */
async function signIn(page: Page) {
  await signInToShell(page, {
    email: EMAIL,
    loginFixture: LOGIN_FIXTURE,
    identities: IDENTITIES,
  });
}

/**
 * Override the reports list. Later routes win over the shared sign-in stub.
 */
async function stubReportsList(page: Page, items: ReportFixture[]) {
  await stubJsonGet(page, /\/feedback\/reports\/?(\?.*)?$/, {
    items,
    hasChangedSinceLastSeen: false,
  });
}

/**
 * Answer the seen mark that Your reports posts on mount. Nothing on the page
 * depends on its response.
 */
async function stubSeenMark(page: Page) {
  await stubJsonPost(page, /\/feedback\/reports\/seen\/?(\?.*)?$/, {
    seenAt: CREATED_AT,
  });
}

/**
 * Sign in, stub the seen mark and the reports list, then open Your reports by
 * URL. Used on the desktop, where a full navigation is stable.
 */
async function openReportsAtDesktop(page: Page, items: ReportFixture[]) {
  await signIn(page);
  await stubSeenMark(page);
  await stubReportsList(page, items);
  await gotoStable(page, '/dashboard/account/reports');
}

/**
 * Phone has no Account or Reports tab: it sits under More. Open More from the
 * tab bar, then follow the Your reports row. Navigation is by clicking, not
 * `gotoStable`, so the vault session is not remounted after sign-in.
 */
async function openReportsFromMore(page: Page): Promise<void> {
  await tabBar(page).getByRole('link', { name: 'More', exact: true }).click();
  await page.getByRole('link', { name: /^Your reports/ }).click();
  await expect(page).toHaveURL(/\/dashboard\/account\/reports\/?$/);
}

test.describe('Feedback layout and roles (E2E)', () => {
  test.describe('Feedback layout at 1440px (E2E)', () => {
    test.use({ viewport: DESKTOP_VIEWPORT });

    test('Your reports lists four reports with a heading each, the follow-up form, the changelog link, and no horizontal overflow', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await openReportsAtDesktop(page, FOUR_REPORTS);

      await expectSingleH1(page, 'Your reports');

      const articles = page.getByRole('article');
      await expect(articles).toHaveCount(4, { timeout: 30000 });
      for (let index = 0; index < 4; index++) {
        await expect(
          articles.nth(index).getByRole('heading', { level: 2 }),
        ).toHaveCount(1);
      }

      await expect(
        page.getByRole('textbox', { name: 'Follow-up', exact: true }),
      ).toHaveCount(1);
      await expect(
        page.getByRole('button', { name: 'Send follow-up', exact: true }),
      ).toBeVisible();

      await expect(
        page.getByRole('link', { name: /Fixed in v2\.1\.0/ }),
      ).toHaveAttribute('href', CHANGELOG_URL);

      await expect(
        page
          .locator('main')
          .getByRole('button', { name: 'Send feedback', exact: true }),
      ).toBeVisible();

      await expectNoHorizontalOverflow(page, 'Your reports at 1440px');
    });

    test('the Send feedback dialog from Your reports relabels its details for a suggestion and Cancel closes it', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await openReportsAtDesktop(page, FOUR_REPORTS);
      await expectSingleH1(page, 'Your reports');

      await page
        .locator('main')
        .getByRole('button', { name: 'Send feedback', exact: true })
        .click();

      const dialog = page.getByRole('dialog', {
        name: 'Send feedback',
        exact: true,
      });
      await expect(dialog).toBeVisible({ timeout: 30000 });

      await expect(
        dialog.getByRole('group', {
          name: 'What kind of feedback is this?',
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        dialog.getByRole('radio', { name: 'Bug report', exact: true }),
      ).toBeChecked();
      await expect(
        dialog.getByRole('radio', { name: 'Suggestion', exact: true }),
      ).not.toBeChecked();

      await expect(
        dialog.getByRole('textbox', { name: 'Title', exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByRole('textbox', { name: 'What happened?', exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByRole('textbox', {
          name: /^What did you expect to happen\?/,
        }),
      ).toBeVisible();

      // The kind radio is controlled: the checked state lands after the form
      // re-renders, so retry the assertion rather than trust a single check.
      await dialog
        .getByRole('radio', { name: 'Suggestion', exact: true })
        .click();
      await expect(
        dialog.getByRole('radio', { name: 'Suggestion', exact: true }),
      ).toBeChecked({ timeout: 30000 });

      await expect(
        dialog.getByRole('textbox', {
          name: 'What would you like to see?',
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        dialog.getByRole('textbox', { name: 'What happened?', exact: true }),
      ).toHaveCount(0);
      await expect(
        dialog.getByRole('textbox', {
          name: /^What did you expect to happen\?/,
        }),
      ).toHaveCount(0);

      await expect(dialog.getByRole('note')).toBeVisible();
      await expect(
        dialog.getByRole('region', {
          name: 'Sent with your report',
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        dialog.getByRole('checkbox', {
          name: 'Email me when this is fixed',
          exact: true,
        }),
      ).toBeChecked();
      await expect(
        dialog.getByRole('button', { name: 'Cancel', exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByRole('button', { name: 'Send report', exact: true }),
      ).toBeVisible();

      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dialog).toHaveCount(0, { timeout: 30000 });
    });

    test('Your reports with no reports shows the empty card and a second Send feedback button', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await openReportsAtDesktop(page, []);

      await expectSingleH1(page, 'Your reports');
      await expect(
        page.getByRole('heading', {
          level: 2,
          name: "You haven't sent any feedback yet.",
          exact: true,
        }),
      ).toBeVisible({ timeout: 30000 });
      await expect(
        page
          .locator('main')
          .getByRole('button', { name: 'Send feedback', exact: true }),
      ).toHaveCount(2);
    });

    test('the Fix Notice unsubscribe page without a token shows the invalid-link state, sends no request, and does not overflow', async ({
      page,
    }) => {
      test.setTimeout(120000);

      // The page is public and needs no sign-in. With no token it never posts
      // to the unsubscribe endpoint, so the counter must stay at zero.
      let unsubscribeRequests = 0;
      page.on('request', (request) => {
        if (request.url().includes('/feedback/fix-notice/unsubscribe')) {
          unsubscribeRequests += 1;
        }
      });

      await gotoStable(page, '/feedback/unsubscribe');

      await expectSingleH1(page, 'Link no longer valid');
      await expect(
        page.getByRole('link', { name: 'MyOrganiser home', exact: true }),
      ).toHaveAttribute('href', '/');
      await expect(
        page.getByRole('link', {
          name: 'Go to account settings',
          exact: true,
        }),
      ).toHaveAttribute('href', '/dashboard/account');

      await expectDocumentNoHorizontalOverflow(
        page,
        'Unsubscribe without a token at 1440px',
      );
      expect(unsubscribeRequests).toBe(0);
    });
  });

  test.describe('Feedback layout at 390px (E2E)', () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test('Your reports opened from More has one h1, four reports, the Send feedback button, and no horizontal overflow', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await signIn(page);
      await stubSeenMark(page);
      await stubReportsList(page, FOUR_REPORTS);
      await openReportsFromMore(page);

      await expectSingleH1(page, 'Your reports');
      await expect(page.getByRole('article')).toHaveCount(4, {
        timeout: 30000,
      });
      await expect(
        page
          .locator('main')
          .getByRole('button', { name: 'Send feedback', exact: true }),
      ).toBeVisible();

      await expectNoHorizontalOverflow(page, 'Your reports at 390px');
    });

    test('Send feedback from More opens the phone sheet with one Send report button and Cancel closes it', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await signIn(page);
      await stubSeenMark(page);
      await stubReportsList(page, []);

      await tabBar(page)
        .getByRole('link', { name: 'More', exact: true })
        .click();
      await page
        .locator('main')
        .getByRole('button', { name: 'Send feedback', exact: true })
        .click();

      const sheet = page.getByRole('dialog', {
        name: 'Send feedback',
        exact: true,
      });
      await expect(sheet).toBeVisible({ timeout: 30000 });
      await expect(
        sheet.getByRole('button', { name: 'Send report', exact: true }),
      ).toHaveCount(1);
      await expect(
        sheet.getByRole('button', { name: 'Cancel', exact: true }),
      ).toBeVisible();
      await expect(
        sheet.getByRole('textbox', { name: 'Title', exact: true }),
      ).toBeVisible();

      await expectNoHorizontalOverflow(page, 'Send feedback sheet at 390px');

      await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(sheet).toHaveCount(0, { timeout: 30000 });
    });

    test('the Fix Notice unsubscribe page without a token has one h1 and does not overflow at 390px', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await gotoStable(page, '/feedback/unsubscribe');

      await expectSingleH1(page, 'Link no longer valid');
      await expectDocumentNoHorizontalOverflow(
        page,
        'Unsubscribe without a token at 390px',
      );
    });
  });
});
