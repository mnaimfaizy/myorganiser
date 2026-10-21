import { type Page } from '@playwright/test';
import { routeApi } from './apiStub';

/**
 * Admin console session scaffolding: the seeded persona in localStorage and
 * the `/auth/refresh` stub that answers it. Imported by path, not re-exported
 * from `helpers/index.ts`, so only the admin specs take this dependency.
 */

export interface PersonaUser {
  id: string;
  name: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'user' | 'platform_admin';
  disabled: boolean;
}

export function corsHeaders(origin: string) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
  } as const;
}

export async function seedSession(page: Page, user: PersonaUser) {
  await page.addInitScript((seedUser: PersonaUser) => {
    window.localStorage.setItem('myorganiser_access_token', 'fake-jwt-token');
    window.localStorage.setItem('myorganiser_token_storage', 'local');
    window.localStorage.setItem('myorganiser_user', JSON.stringify(seedUser));
  }, user);
}

export async function stubAuthRefresh(page: Page, user: PersonaUser) {
  const refreshUrl = /\/auth\/refresh\/?(\?.*)?$/;

  await routeApi(page, refreshUrl, async (route) => {
    const origin = new URL(page.url() || 'http://localhost:4200').origin;
    const headers = corsHeaders(origin);

    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }

    await route.fulfill({
      status: 200,
      headers,
      contentType: 'application/json',
      body: JSON.stringify({
        token: 'fake-jwt-token',
        expires_in: 3600,
        user,
      }),
    });
  });
}
