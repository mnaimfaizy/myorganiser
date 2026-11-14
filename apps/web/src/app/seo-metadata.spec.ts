/**
 * @jest-environment node
 */
import type { Metadata } from 'next';

const DEFAULT_ORIGIN = 'https://myorganiser.app';
const STAGING_ORIGIN = 'https://staging.example.test';

const PUBLIC_PATHS = [
  '/',
  '/download',
  '/signup',
  '/login',
  '/privacy',
  '/terms',
  '/youtube/data-privacy',
];

const SIGNED_IN_OR_TOKEN_SEGMENTS = [
  'dashboard',
  'admin',
  'unsubscribe',
  'reset',
  'verify',
  'forgot-password',
  'account-deleted',
];

// Each public path maps to the module that owns its `metadata` export.
// Keys must match the sitemap paths exactly (see the coverage test below).
const CANONICAL_OWNERS: Record<string, () => Promise<{ metadata: Metadata }>> =
  {
    '/': () => import('./page'),
    '/download': () => import('./download/page'),
    '/signup': () => import('./(auth)/signup/layout'),
    '/login': () => import('./(auth)/login/layout'),
    '/privacy': () => import('./privacy/page'),
    '/terms': () => import('./terms/page'),
    '/youtube/data-privacy': () => import('./youtube/data-privacy/page'),
  };

const ORIGINAL_APP_URL = process.env.NEXT_PUBLIC_APP_URL;

// SITE_URL is read at module load, so each load sets or clears the env var and
// resets the module registry first.
async function loadRoutes(appUrl?: string) {
  if (appUrl === undefined) {
    delete process.env.NEXT_PUBLIC_APP_URL;
  } else {
    process.env.NEXT_PUBLIC_APP_URL = appUrl;
  }
  jest.resetModules();
  const sitemapModule = await import('./sitemap');
  const robotsModule = await import('./robots');
  return {
    sitemap: sitemapModule.default,
    robots: robotsModule.default,
  };
}

function pathOf(url: string): string {
  return new URL(url).pathname;
}

afterEach(() => {
  if (ORIGINAL_APP_URL === undefined) {
    delete process.env.NEXT_PUBLIC_APP_URL;
  } else {
    process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_APP_URL;
  }
});

describe('sitemap()', () => {
  it('lists the seven public URLs under the default origin, with the root having no trailing slash', async () => {
    const { sitemap } = await loadRoutes();

    expect(sitemap()).toStrictEqual([
      { url: DEFAULT_ORIGIN },
      { url: `${DEFAULT_ORIGIN}/download` },
      { url: `${DEFAULT_ORIGIN}/signup` },
      { url: `${DEFAULT_ORIGIN}/login` },
      { url: `${DEFAULT_ORIGIN}/privacy` },
      { url: `${DEFAULT_ORIGIN}/terms` },
      { url: `${DEFAULT_ORIGIN}/youtube/data-privacy` },
    ]);
  });

  it('contains no signed-in, token, or one-off routes', async () => {
    const { sitemap } = await loadRoutes();

    const firstSegments = sitemap().map(
      ({ url }) => pathOf(url).split('/')[1] ?? '',
    );

    for (const segment of SIGNED_IN_OR_TOKEN_SEGMENTS) {
      expect(firstSegments).not.toContain(segment);
    }
  });
});

describe('robots()', () => {
  it('allows every user agent to crawl / and sets no disallow rule', async () => {
    const { robots } = await loadRoutes();

    expect(robots().rules).toStrictEqual({ userAgent: '*', allow: '/' });
  });

  it('points the sitemap at /sitemap.xml under the default origin', async () => {
    const { robots } = await loadRoutes();

    expect(robots().sitemap).toBe(`${DEFAULT_ORIGIN}/sitemap.xml`);
  });
});

describe('NEXT_PUBLIC_APP_URL override', () => {
  it('uses the configured origin for sitemap URLs and the robots sitemap pointer', async () => {
    const { sitemap, robots } = await loadRoutes(STAGING_ORIGIN);

    expect(sitemap()).toStrictEqual([
      { url: STAGING_ORIGIN },
      { url: `${STAGING_ORIGIN}/download` },
      { url: `${STAGING_ORIGIN}/signup` },
      { url: `${STAGING_ORIGIN}/login` },
      { url: `${STAGING_ORIGIN}/privacy` },
      { url: `${STAGING_ORIGIN}/terms` },
      { url: `${STAGING_ORIGIN}/youtube/data-privacy` },
    ]);
    expect(robots().sitemap).toBe(`${STAGING_ORIGIN}/sitemap.xml`);
  });
});

describe('canonical metadata stays in step with the sitemap', () => {
  it('maps every sitemap path to an owner, and no owner is left without a sitemap path', async () => {
    const { sitemap } = await loadRoutes();

    const sitemapPaths = sitemap()
      .map(({ url }) => pathOf(url))
      .sort();

    expect(sitemapPaths).toStrictEqual([...PUBLIC_PATHS].sort());
    expect(Object.keys(CANONICAL_OWNERS).sort()).toStrictEqual(sitemapPaths);
  });

  it('gives each sitemap path an owner whose canonical equals that path', async () => {
    const { sitemap } = await loadRoutes();

    const sitemapPaths = sitemap().map(({ url }) => pathOf(url));

    for (const path of sitemapPaths) {
      const owner = CANONICAL_OWNERS[path];
      expect(owner).toBeDefined();

      const { metadata } = await owner();
      expect(metadata.alternates?.canonical).toBe(path);
    }
  });
});
