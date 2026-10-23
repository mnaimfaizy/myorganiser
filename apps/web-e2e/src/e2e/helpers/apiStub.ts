import { Page, Route } from '@playwright/test';

/**
 * Register an API stub that never intercepts document navigations or RSC soft navigations.
 *
 * Several stub patterns are deliberately origin-agnostic — `/\/vault\/?$/`,
 * `/\/admin\/users\/?$/` — so they match the backend wherever it is served
 * from. That also makes them match the app's own routes: navigating to
 * `/dashboard/vault` or `/admin/users` produced a document request that the
 * stub fulfilled with the API's JSON body, so the page under test never
 * rendered and every selector on it timed out (issue #506).
 *
 * Next.js App Router soft navigations arrive as fetch requests to the app's
 * own route with a `?_rsc=<hash>` query parameter and an `RSC: 1` request
 * header. If intercepted, the stub returns 401 (no Authorization header),
 * which causes Next.js to silently degrade to a full document load and
 * remount every session-holding component, losing in-memory state.
 *
 * API stubs only ever need to answer genuine fetch/XHR to the backend,
 * so document requests and RSC navigations are handed back to Next.js untouched.
 */
export async function routeApi(
  page: Page,
  url: Parameters<Page['route']>[0],
  handler: (route: Route) => Promise<void> | void,
): Promise<void> {
  await page.route(url, async (route) => {
    const request = route.request();

    // Fall back for document requests (issue #506)
    if (request.resourceType() === 'document') {
      await route.fallback();
      return;
    }

    // Fall back for Next.js RSC soft navigation requests.
    // Playwright lowercases header names, so check for 'rsc' not 'RSC'.
    const requestUrl = request.url();
    const hasRscParam = requestUrl.includes('_rsc=');
    const hasRscHeader = request.headers()['rsc'] === '1';

    if (hasRscParam || hasRscHeader) {
      await route.fallback();
      return;
    }

    await handler(route);
  });
}

function corsHeaders(origin: string) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
  } as const;
}

/**
 * Answer GET with a fixed JSON body and OPTIONS with a CORS preflight. Any
 * other method is handed to the network. Use it for reads a shell makes on
 * mount, where the body only has to be the generated client's response shape.
 */
export async function stubJsonGet(page: Page, url: RegExp, body: unknown) {
  await routeApi(page, url, async (route) => {
    const origin = new URL(page.url() || 'http://localhost:4200').origin;
    const headers = corsHeaders(origin);
    const request = route.request();

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }

    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        headers,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
      return;
    }

    await route.continue();
  });
}

/**
 * Answer POST with a fixed JSON body and OPTIONS with a CORS preflight. Any
 * other method is handed to the network. Use it for writes a page makes on
 * mount whose response the page ignores, such as a fire-and-forget mark.
 */
export async function stubJsonPost(page: Page, url: RegExp, body: unknown) {
  await routeApi(page, url, async (route) => {
    const origin = new URL(page.url() || 'http://localhost:4200').origin;
    const headers = corsHeaders(origin);
    const request = route.request();

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }

    if (request.method() === 'POST') {
      await route.fulfill({
        status: 200,
        headers,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
      return;
    }

    await route.continue();
  });
}
