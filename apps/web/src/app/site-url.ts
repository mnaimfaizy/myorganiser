/**
 * The public origin of the web app, for metadata that needs an absolute URL:
 * `metadataBase` in the root layout, robots.txt, and sitemap.xml.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? 'https://myorganiser.app';
