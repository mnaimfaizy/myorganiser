import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  expectNoHorizontalOverflow,
  expectSingleH1,
  gotoStable,
} from './helpers';
import { PHONE_VIEWPORT } from './helpers/shellLayout';

/**
 * Standalone legal pages layout (issue #1260, Web v2.0 Legal pages).
 *
 * Asserted at 1440px and at 390px, on /privacy, /terms and /youtube/data-privacy:
 * - one h1 with the page title;
 * - the "Legal" navigation with links to /privacy and /terms, the current
 *   document's link marked aria-current="page", and no link marked on the
 *   YouTube page;
 * - the "MyOrganiser home" link pointing at /;
 * - on Privacy Policy and Terms of Service, the "On this page" navigation: each
 *   link is a `#id` that resolves to a region (section) named by the same title;
 * - on the YouTube page, no "On this page" navigation, a list of seven items, and
 *   a "Back to YouTube" link to /dashboard/youtube;
 * - no horizontal overflow.
 * Placement, on Privacy Policy and Terms of Service: at 390px the "On this page"
 * navigation sits above the first section card; at 1440px it sits to the left of
 * it, on the same row.
 *
 * Not asserted here:
 * - the Operator & Contact section, in either direction: the operator env vars are
 *   unset in e2e, so the section and its "On this page" entry are omitted by design;
 * - the section body copy, the "Last updated" date, and the footer;
 * - following any link. Links are checked by their href, because the destinations
 *   (the home page and the signed-in YouTube dashboard) are outside this spec;
 * - the hero's Back control and the Actions buttons.
 *
 * Hermetic: the three pages are public and fetch nothing at render time, so no
 * API route is stubbed and nobody signs in.
 */

const DESKTOP_VIEWPORT = { width: 1440, height: 1000 };

type LegalDocument = 'privacy' | 'terms';

function expectCurrentMark(link: Locator, isCurrent: boolean) {
  if (isCurrent) {
    return expect(link).toHaveAttribute('aria-current', 'page');
  }
  return expect(link).not.toHaveAttribute('aria-current');
}

async function expectLegalNavigation(page: Page, current?: LegalDocument) {
  const legal = page.getByRole('navigation', { name: 'Legal', exact: true });
  const privacy = legal.getByRole('link', {
    name: 'Privacy Policy',
    exact: true,
  });
  const terms = legal.getByRole('link', {
    name: 'Terms of Service',
    exact: true,
  });

  await expect(privacy).toHaveAttribute('href', '/privacy');
  await expect(terms).toHaveAttribute('href', '/terms');
  await expectCurrentMark(privacy, current === 'privacy');
  await expectCurrentMark(terms, current === 'terms');
}

async function expectHomeLink(page: Page) {
  await expect(
    page.getByRole('link', { name: 'MyOrganiser home', exact: true }),
  ).toHaveAttribute('href', '/');
}

/**
 * Each "On this page" link must be `#id`, and a region with that id must be
 * labelled by the link's text. Checking both ends keeps the TOC from pointing at
 * a missing or renamed section.
 */
async function expectOnThisPageMatchesSections(page: Page) {
  const toc = page.getByRole('navigation', {
    name: 'On this page',
    exact: true,
  });
  await expect(toc).toBeVisible();

  const links = toc.getByRole('link');
  const entries = await links.evaluateAll((elements) =>
    elements.map((element) => ({
      href: element.getAttribute('href') ?? '',
      title: (element.textContent ?? '').trim(),
    })),
  );
  expect(entries.length).toBeGreaterThan(0);

  for (const entry of entries) {
    expect(entry.href).toMatch(/^#[a-z-]+$/);
    const id = entry.href.slice(1);
    await expect(
      page.getByRole('region', { name: entry.title, exact: true }),
    ).toHaveAttribute('id', id);
  }
}

async function expectNoOnThisPageNavigation(page: Page) {
  await expect(
    page.getByRole('navigation', { name: 'On this page', exact: true }),
  ).toHaveCount(0);
}

async function boxOf(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('Expected a visible element with a bounding box.');
  }
  return box;
}

/** The "On this page" navigation and the first section card of the document. */
function tocAndFirstSection(page: Page) {
  return {
    toc: page.getByRole('navigation', { name: 'On this page', exact: true }),
    firstSection: page.getByRole('main').getByRole('region').first(),
  };
}

/** The three layout tests, run at each viewport. */
function defineLayoutTests() {
  test('Privacy Policy has one h1, the Legal and On this page navigations, matching section regions, and no horizontal overflow', async ({
    page,
  }) => {
    await gotoStable(page, '/privacy');

    await expectSingleH1(page, 'Privacy Policy');
    await expectLegalNavigation(page, 'privacy');
    await expectHomeLink(page);
    await expectOnThisPageMatchesSections(page);
    await expectNoHorizontalOverflow(page, 'Privacy Policy page');
  });

  test('Terms of Service has one h1, the Legal and On this page navigations, matching section regions, and no horizontal overflow', async ({
    page,
  }) => {
    await gotoStable(page, '/terms');

    await expectSingleH1(page, 'Terms of Service');
    await expectLegalNavigation(page, 'terms');
    await expectHomeLink(page);
    await expectOnThisPageMatchesSections(page);
    await expectNoHorizontalOverflow(page, 'Terms of Service page');
  });

  test('How we store your YouTube data has one h1, a Legal navigation with no current link, a seven-item list, a Back to YouTube link, and no horizontal overflow', async ({
    page,
  }) => {
    await gotoStable(page, '/youtube/data-privacy');

    await expectSingleH1(page, 'How we store your YouTube data');
    await expectLegalNavigation(page);
    await expectHomeLink(page);
    await expectNoOnThisPageNavigation(page);
    await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(7);
    await expect(
      page.getByRole('link', { name: 'Back to YouTube', exact: true }),
    ).toHaveAttribute('href', '/dashboard/youtube');
    await expectNoHorizontalOverflow(page, 'YouTube data page');
  });
}

test.describe('Legal pages layout (E2E)', () => {
  test.describe('Legal pages layout at 1440px (E2E)', () => {
    test.use({ viewport: DESKTOP_VIEWPORT });

    defineLayoutTests();

    test('On this page navigation sits to the left of the first section card, on the same row, on Privacy Policy and Terms of Service', async ({
      page,
    }) => {
      for (const path of ['/privacy', '/terms']) {
        await gotoStable(page, path);
        const { toc, firstSection } = tocAndFirstSection(page);
        const tocBox = await boxOf(toc);
        const sectionBox = await boxOf(firstSection);

        expect(tocBox.x + tocBox.width).toBeLessThanOrEqual(sectionBox.x);
        expect(tocBox.y).toBeLessThan(sectionBox.y + sectionBox.height);
        expect(sectionBox.y).toBeLessThan(tocBox.y + tocBox.height);
      }
    });
  });

  test.describe('Legal pages layout at 390px (E2E)', () => {
    test.use({ viewport: PHONE_VIEWPORT });

    defineLayoutTests();

    test('On this page navigation sits above the first section card on Privacy Policy and Terms of Service', async ({
      page,
    }) => {
      for (const path of ['/privacy', '/terms']) {
        await gotoStable(page, path);
        const { toc, firstSection } = tocAndFirstSection(page);
        const tocBox = await boxOf(toc);
        const sectionBox = await boxOf(firstSection);

        expect(tocBox.y + tocBox.height).toBeLessThanOrEqual(sectionBox.y);
      }
    });
  });
});
