import type { MetadataRoute } from 'next';

import { SITE_URL } from './site-url';

/*
 * Everything stays crawlable on purpose. Signed-in and one-off pages
 * (/dashboard, /admin, the unsubscribe pages) carry a `noindex` robots meta
 * tag from their own metadata instead. A Disallow here would stop Google
 * fetching those pages, so it would never read the `noindex` and would keep
 * listing them.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
