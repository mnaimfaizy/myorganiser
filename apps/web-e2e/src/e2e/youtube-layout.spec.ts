import { expect, test, type Page } from '@playwright/test';
import {
  E2E_USER_ID,
  expectNoHorizontalOverflow,
  expectSingleH1,
  gotoStable,
  routeApi,
  stubJsonGet,
  type IdentityEntry,
} from './helpers';
import { PHONE_VIEWPORT, signInToShell } from './helpers/shellLayout';

/**
 * YouTube page layout and roles (issue #1256, Web v2.0 restyle).
 *
 * The acceptance check: no horizontal overflow at 390px, one h1 per state, and
 * labelled controls with the right roles. Each state is checked at 1440px and
 * at 390px.
 *
 * Hermetic: every YouTube read is stubbed. Availability, access, status,
 * subscriptions, carousel, sync status, the acknowledgement and the Shorts
 * list are answered in-process, and the YouTube embed is answered empty so no
 * third-party frame loads. No live Google OAuth is started: the Connect
 * action is never clicked.
 *
 * Not asserted here:
 * - playback, queue reordering, watched toggles, and sync runs (write paths);
 * - the Shorts budget arithmetic and the hard stop;
 * - the connect redirect and the acknowledgement POST.
 */

const EMAIL = 'youtube-layout-01@example.com';
const LOGIN_FIXTURE = 'yt-layout-01';

const IDENTITIES: IdentityEntry[] = [
  {
    match: 'youtube-layout-01',
    userId: E2E_USER_ID,
    userName: 'YouTube Layout Owner',
  },
];

const DESKTOP_VIEWPORT = { width: 1440, height: 1000 };

const AVAILABILITY_URL = /\/youtube\/availability\/?(\?.*)?$/;
const ACCESS_URL = /\/youtube\/access\/?(\?.*)?$/;
const STATUS_URL = /\/youtube\/status\/?(\?.*)?$/;
const SUBSCRIPTIONS_URL = /\/youtube\/subscriptions\/?(\?.*)?$/;
const CAROUSEL_URL = /\/youtube\/videos\/carousel\/?(\?.*)?$/;
const SYNC_STATUS_URL = /\/youtube\/sync-status\/?(\?.*)?$/;
const ACKNOWLEDGEMENT_URL = /\/youtube\/acknowledgement\/?(\?.*)?$/;
const VIDEO_LIST_URL = /\/youtube\/videos\?/;

const CHANNEL_ONE = 'Layout Channel One';
const CHANNEL_TWO = 'Layout Channel Two';
const CHANNEL_THREE = 'Layout Channel Three';

const UPLOAD_ALPHA = 'Layout Upload Alpha';
const UPLOAD_BETA = 'Layout Upload Beta';
const UPLOAD_GAMMA = 'Layout Upload Gamma';

const SHORT_ONE = 'Layout Short One';
const SHORT_TWO = 'Layout Short Two';

const SYNCED_AT = '2026-10-21T09:00:00.000Z';
const PUBLISHED_AT = '2026-10-01T10:00:00.000Z';

const SUBSCRIPTIONS = [
  {
    id: 'sub-layout-1',
    channelId: 'chan-layout-1',
    channelTitle: CHANNEL_ONE,
    channelThumbnail: null,
    uploadsPlaylistId: 'UU-layout-1',
    enabled: true,
    lastSyncedAt: SYNCED_AT,
  },
  {
    id: 'sub-layout-2',
    channelId: 'chan-layout-2',
    channelTitle: CHANNEL_TWO,
    channelThumbnail: null,
    uploadsPlaylistId: 'UU-layout-2',
    enabled: true,
    lastSyncedAt: SYNCED_AT,
  },
  {
    id: 'sub-layout-3',
    channelId: 'chan-layout-3',
    channelTitle: CHANNEL_THREE,
    channelThumbnail: null,
    uploadsPlaylistId: 'UU-layout-3',
    enabled: false,
    lastSyncedAt: null,
  },
];

function upload(
  videoId: string,
  channelId: string,
  channelTitle: string,
  title: string,
  isShort: boolean,
) {
  return {
    id: `row-${videoId}`,
    videoId,
    channelId,
    channelTitle,
    title,
    thumbnail: null,
    publishedAt: PUBLISHED_AT,
    description: '',
    watched: false,
    durationSeconds: isShort ? 45 : 900,
    isShort,
  };
}

/** Carousel: the enabled channels, each with its cached uploads. */
const CAROUSEL = [
  {
    channelId: 'chan-layout-1',
    channelTitle: CHANNEL_ONE,
    channelThumbnail: null,
    videos: [
      upload('vid-alpha', 'chan-layout-1', CHANNEL_ONE, UPLOAD_ALPHA, false),
      upload('vid-beta', 'chan-layout-1', CHANNEL_ONE, UPLOAD_BETA, false),
    ],
  },
  {
    channelId: 'chan-layout-2',
    channelTitle: CHANNEL_TWO,
    channelThumbnail: null,
    videos: [
      upload('vid-gamma', 'chan-layout-2', CHANNEL_TWO, UPLOAD_GAMMA, false),
    ],
  },
];

const SHORTS = [
  upload('short-one', 'chan-layout-1', CHANNEL_ONE, SHORT_ONE, true),
  upload('short-two', 'chan-layout-2', CHANNEL_TWO, SHORT_TWO, true),
];

const SYNC_STATUS = {
  status: 'success',
  lastSyncedAt: SYNCED_AT,
  lastSyncAttemptAt: SYNCED_AT,
  lastSyncError: null,
  retryAt: null,
  channelStatus: 'success',
  channelLastAttemptAt: SYNCED_AT,
  channelLastError: null,
  channelRetryAt: null,
  progress: null,
};

/** Sign in and land on the dashboard. The shared sign-in stubs YouTube as off. */
async function signIn(page: Page) {
  await signInToShell(page, {
    email: EMAIL,
    loginFixture: LOGIN_FIXTURE,
    identities: IDENTITIES,
  });
}

/**
 * Connected, with access and three subscriptions (one disabled). Registered
 * after sign-in, so these answers replace the shared sign-in stubs.
 */
async function stubConnectedYouTube(page: Page) {
  await stubJsonGet(page, AVAILABILITY_URL, { available: true });
  await stubJsonGet(page, ACCESS_URL, { granted: true });
  await stubJsonGet(page, STATUS_URL, { connected: true, status: 'connected' });
  await stubJsonGet(page, SUBSCRIPTIONS_URL, SUBSCRIPTIONS);
  await stubJsonGet(page, CAROUSEL_URL, CAROUSEL);
  await stubJsonGet(page, SYNC_STATUS_URL, SYNC_STATUS);
}

/** Answer the YouTube embed with an empty document so no third-party frame loads. */
async function stubYouTubeEmbeds(page: Page) {
  // Non-API interception: routeApi hands frame documents back to the network,
  // so this raw route is the only way to keep the third-party embed hermetic.
  // eslint-disable-next-line no-restricted-syntax -- intercepts the youtube-nocookie embed frame document, not an API call
  await page.route(/youtube-nocookie\.com\//, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '' }),
  );
}

/** The availability read answers 500, so the page cannot reach YouTube. */
async function stubAvailabilityUnreachable(page: Page) {
  await routeApi(page, AVAILABILITY_URL, async (route) => {
    const origin = new URL(page.url() || 'http://localhost:4200').origin;
    const headers = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization',
    };
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    await route.fulfill({
      status: 500,
      headers,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Internal error' }),
    });
  });
}

async function expectVideosPage(page: Page, isPhone: boolean, label: string) {
  await expectSingleH1(page, 'YouTube');

  const sections = page.getByRole('navigation', {
    name: 'YouTube',
    exact: true,
  });
  await expect(
    sections.getByRole('link', { name: 'Videos', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    sections.getByRole('link', { name: 'Shorts', exact: true }),
  ).toBeVisible();
  // Desktop shows the channel count; phone labels never carry one.
  await expect(
    sections.getByRole('link', { name: /^Channels( · 3)?$/ }),
  ).toBeVisible();

  await expect(
    page
      .getByRole('tablist', { name: 'Enabled channels', exact: true })
      .getByRole('tab'),
  ).toHaveCount(2);

  for (const title of [UPLOAD_ALPHA, UPLOAD_BETA]) {
    await expect(
      page.getByRole('button', { name: `Play ${title} in app`, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Add ${title} to queue`, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: `Mark ${title} as watched`,
        exact: true,
      }),
    ).toBeVisible();
  }

  await expect(
    page.getByRole('button', { name: 'Sync uploads', exact: true }),
  ).toBeVisible();

  if (isPhone) {
    // The desktop aside is hidden on phone; the queue is a disclosure.
    await expect(
      page.getByText('Queue · 0 of 4', { exact: true }),
    ).toBeVisible();
  } else {
    await expect(
      page.getByRole('complementary', { name: 'Queue', exact: true }),
    ).toBeVisible();
  }

  await expectNoHorizontalOverflow(page, `YouTube videos at ${label}`);
}

async function expectShortsPage(page: Page, label: string) {
  await expectSingleH1(page, 'Shorts');

  await expect(
    page.getByRole('progressbar', { name: /daily Shorts budget used/ }),
  ).toBeVisible();
  await expect(
    page.getByLabel('Daily limit (minutes)', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Five minutes less', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Five minutes more', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Previous Short', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Next Short', exact: true }),
  ).toBeVisible();

  await expectNoHorizontalOverflow(page, `YouTube Shorts at ${label}`);
}

async function expectChannelsPage(page: Page, label: string) {
  await expectSingleH1(page, 'Channels');

  await expect(
    page
      .getByRole('navigation', { name: 'YouTube', exact: true })
      .getByRole('link', { name: /^Channels( · 3)?$/ }),
  ).toHaveAttribute('aria-current', 'page');

  await expect(
    page.getByLabel('Filter channels', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('group', {
      name: 'Filter channels by sync state',
      exact: true,
    }),
  ).toBeVisible();

  for (const title of [CHANNEL_ONE, CHANNEL_TWO, CHANNEL_THREE]) {
    await expect(
      page.getByRole('switch', { name: `Sync ${title}`, exact: true }),
    ).toBeVisible();
  }

  await expect(
    page.getByRole('button', { name: 'Refresh channels', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Disconnect YouTube account',
      exact: true,
    }),
  ).toBeVisible();

  await expectNoHorizontalOverflow(page, `YouTube channels at ${label}`);
}

function defineLayoutTests(label: string, isPhone: boolean) {
  test.describe(label, () => {
    test.use({ viewport: isPhone ? PHONE_VIEWPORT : DESKTOP_VIEWPORT });

    test('videos page, connected with channels and uploads, has one h1, section links, channel tabs, upload actions, and no horizontal overflow', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await signIn(page);
      await stubConnectedYouTube(page);
      await stubYouTubeEmbeds(page);
      await gotoStable(page, '/dashboard/youtube');

      await expectVideosPage(page, isPhone, label);
    });

    test('Shorts page, after the entry warning, shows the budget meter, the limit controls, and the Short navigation', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await signIn(page);
      await stubConnectedYouTube(page);
      await stubYouTubeEmbeds(page);
      await stubJsonGet(page, VIDEO_LIST_URL, {
        videos: SHORTS,
        total: SHORTS.length,
        totalPages: 1,
      });
      await gotoStable(page, '/dashboard/youtube/shorts');

      await page
        .getByRole('button', { name: 'Continue to Shorts', exact: true })
        .click();

      await expectShortsPage(page, label);
    });

    test('channels page lists the subscriptions with a filter, sync switches, refresh, and disconnect', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await signIn(page);
      await stubConnectedYouTube(page);
      await gotoStable(page, '/dashboard/youtube/channels');

      await expectChannelsPage(page, label);
    });

    test('first look, not yet connected, keeps Connect YouTube disabled until the acknowledgement is ticked', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await signIn(page);
      await stubJsonGet(page, AVAILABILITY_URL, { available: true });
      await stubJsonGet(page, ACCESS_URL, { granted: true });
      await stubJsonGet(page, STATUS_URL, {
        connected: false,
        status: 'not_connected',
      });
      await stubJsonGet(page, ACKNOWLEDGEMENT_URL, { acknowledgedAt: null });
      await gotoStable(page, '/dashboard/youtube');

      await expectSingleH1(page, 'Connect Your YouTube Account');
      await expect(
        page.getByRole('heading', {
          level: 2,
          name: 'Before you connect',
          exact: true,
        }),
      ).toBeVisible();

      const agreement = page.getByRole('checkbox');
      const connect = page.getByRole('button', {
        name: 'Connect YouTube',
        exact: true,
      });
      await expect(agreement).not.toBeChecked();
      await expect(connect).toBeDisabled();

      // Ticking only sets the form's local state; Connect is never pressed.
      await agreement.click();
      await expect(agreement).toBeChecked({ timeout: 30000 });
      await expect(connect).toBeEnabled();

      await expectNoHorizontalOverflow(page, `YouTube first look at ${label}`);
    });

    test('unreachable notice, when the availability read fails, offers Try again', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await signIn(page);
      await stubAvailabilityUnreachable(page);
      await gotoStable(page, '/dashboard/youtube');

      await expectSingleH1(page, "YouTube can't be reached right now");
      await expect(
        page.getByRole('button', { name: 'Try again', exact: true }),
      ).toBeVisible();

      await expectNoHorizontalOverflow(page, `YouTube unreachable at ${label}`);
    });

    test('callback without an authorization code shows Connection Failed with a way back', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await signIn(page);
      await stubConnectedYouTube(page);
      await gotoStable(page, '/dashboard/youtube/callback');

      await expectSingleH1(page, 'Connection Failed');
      await expect(
        page.getByText('No authorization code received from Google.', {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Back to Dashboard', exact: true }),
      ).toBeVisible();

      await expectNoHorizontalOverflow(page, `YouTube callback at ${label}`);
    });
  });
}

test.describe('YouTube layout (E2E)', () => {
  defineLayoutTests('1440px', false);
  defineLayoutTests('390px', true);
});
