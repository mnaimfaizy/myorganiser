import { Locator, Page, expect } from '@playwright/test';

/**
 * The credentials every stubbed `/auth/login` route in this suite accepts.
 * Not re-exported from `./helpers`: specs get them as `submitLoginForm`'s
 * default rather than restating them.
 */
const E2E_EMAIL = 'testuser@example.com';
const E2E_PASSWORD = 'password123';

/**
 * Resolve once a controlled auth form's React handlers are attached.
 *
 * These forms are fully controlled — `value={...}` plus `onChange` — so a value
 * typed before hydration lands in the DOM but never reaches React state, and
 * submitting posts an empty form. The suite used to cover that with
 * `waitForLoadState('networkidle')` plus a 1.5s WebKit sleep. Neither observes
 * hydration: `networkidle` is DISCOURAGED by Playwright and hangs against a
 * production build, and a sleep is a guess (ADR 0050, issue #524).
 *
 * Password visibility is pure client state, so the field only unmasks once
 * `onClick` is bound — which makes it the one tell that hydration has landed.
 * The click is retried because a pre-hydration click is dropped, then reversed
 * so the caller starts from the masked field a user sees, and so
 * `input[type="password"]` still selects it.
 *
 * The alternation matters: the button relabels itself between "Show password"
 * and "Hide password", so a fixed name matches only half the time. Anchoring
 * then keeps it off signup's confirm-password eye, labelled "Show confirm
 * password".
 *
 * `password` is passed in because the two forms identify the field differently
 * — login has an `id`, signup does not.
 */
async function waitForPasswordFieldInteractive(
  page: Page,
  password: Locator,
): Promise<void> {
  const toggle = page.getByRole('button', { name: /^(Show|Hide) password$/ });

  await expect(toggle).toBeVisible({ timeout: 30000 });

  await expect(async () => {
    await toggle.click();
    await expect(password).toHaveAttribute('type', 'text', { timeout: 1000 });
  }).toPass({ timeout: 30000 });

  await expect(async () => {
    await toggle.click();
    await expect(password).toHaveAttribute('type', 'password', {
      timeout: 1000,
    });
  }).toPass({ timeout: 10000 });
}

/** Resolve once the login form's React handlers are attached. */
export function waitForLoginFormInteractive(page: Page): Promise<void> {
  return waitForPasswordFieldInteractive(page, page.locator('#password'));
}

/**
 * Resolve once the signup form's React handlers are attached.
 *
 * It matters more here than on login: every field is controlled and the terms
 * checkbox gates the submit, so a pre-hydration `fill`/`check` leaves React
 * Hook Form holding an empty, invalid form. Submitting then does nothing at
 * all — the spec sits on `/signup` until `toHaveURL` times out, with no clue
 * that the click was dropped (issue #597).
 */
export function waitForSignupFormInteractive(page: Page): Promise<void> {
  return waitForPasswordFieldInteractive(
    page,
    page.getByLabel('Password', { exact: true }),
  );
}

/**
 * Fill and submit the login form, leaving the browser on the dashboard.
 *
 * Assumes the caller has already navigated to `/login` and stubbed the
 * `/auth/login` route.
 */
export async function submitLoginForm(
  page: Page,
  credentials: { email: string; password: string } = {
    email: E2E_EMAIL,
    password: E2E_PASSWORD,
  },
): Promise<void> {
  await waitForLoginFormInteractive(page);

  await page.fill('input[type="email"]', credentials.email);
  await page.fill('input[type="password"]', credentials.password);

  const submitButton = page.locator('button[type="submit"]');
  await expect(submitButton).toBeVisible();
  await expect(submitButton).toBeEnabled();
  await submitButton.click();

  await expect(page).toHaveURL(/.*dashboard/, { timeout: 60000 });
  await waitForDashboardReady(page);
  await waitForVaultMountSettled(page);
}

/**
 * Resolve once the dashboard shell is live on the current page.
 *
 * `DashboardGuard` renders `null` until its client-side auth check resolves,
 * so any part of the dashboard shell being on screen proves the shell mounted
 * and the route's own content is rendering — which is what the callers were
 * reaching for when they waited for network quiet after landing on
 * `/dashboard`. The header's sidebar toggle names itself by what it will do.
 */
export async function waitForDashboardReady(page: Page): Promise<void> {
  await expect(
    page.getByRole('button', { name: /^(Collapse|Expand|Open) sidebar$/ }),
  ).toBeVisible({ timeout: 60000 });
}

/**
 * Resolve once the dashboard's mount-time vault async work —
 * VaultMetaConvergeRunner, VaultPullRunner, and VaultReconcileRunner's
 * first pass — has settled. Complements `waitForDashboardReady`, which
 * only proves `DashboardGuard` resolved: a hard navigation issued before
 * this settles can tear down those runners' in-flight requests mid-pass,
 * a race that intermittently crashed WebKit's navigation outright rather
 * than just flaking (issue #858).
 */
export async function waitForVaultMountSettled(page: Page): Promise<void> {
  await expect(page.getByTestId('dashboard-mount-settled')).toHaveAttribute(
    'data-settled',
    'true',
    { timeout: 60000 },
  );
}

/**
 * Wait for a full page reload triggered by a callback, then resolve once the
 * dashboard shell is live.
 *
 * A same-document `waitFor()` cannot distinguish a pre-reload document from
 * a post-reload one. This helper stamps a marker on the current `window`,
 * runs the callback (which triggers the reload), then waits for the marker
 * to vanish via `waitForFunction()`. `waitForFunction()` is resilient to
 * navigation and re-evaluates in the new execution context, so the absence
 * of the marker proves the reload committed. Then `waitForDashboardReady()`
 * ensures the new document's shell has mounted (issue #557), and
 * `waitForVaultMountSettled()` ensures the reloaded document's own mount-time
 * vault work has too — a reload remounts `VaultSessionProvider` exactly like
 * a fresh login does, so it is exposed to the same race (issue #858).
 */
export async function waitForReload(
  page: Page,
  callback: () => Promise<void>,
): Promise<void> {
  const marker = `__e2e_reload_marker_${Date.now()}`;
  await page.evaluate((m) => {
    (window as unknown as Record<string, boolean>)[m] = true;
  }, marker);

  await callback();

  await page.waitForFunction(
    (m) => !(window as unknown as Record<string, boolean>)[m],
    marker,
    { timeout: 60000 },
  );

  await waitForDashboardReady(page);
  await waitForVaultMountSettled(page);
}
