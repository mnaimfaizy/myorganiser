import type { MetadataRoute } from 'next';

import { SITE_URL } from './site-url';

/*
 * The public, indexable pages. Each one also declares the same path as its
 * canonical URL in its own metadata; keep the two in step when a public page
 * is added or removed.
 */
const PUBLIC_PATHS = [
  '/',
  '/download',
  '/signup',
  '/login',
  '/privacy',
  '/terms',
  '/youtube/data-privacy',
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((path) => ({
    url: path === '/' ? SITE_URL : `${SITE_URL}${path}`,
  }));
}
