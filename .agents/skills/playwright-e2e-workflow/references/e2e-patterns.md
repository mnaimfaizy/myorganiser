# Playwright E2E Patterns and Anti-Patterns

Code-level reference for MyOrganiser E2E specs. This is the **single home** for these patterns —
`SKILL.md` covers workflow and policy, `runbook.md` covers the flow matrix and selector rules,
and this file covers what the code must actually look like.

Read this before implementing a spec. Do not restate it in agent prompts or briefs.

---

## Playwright API boundaries

`page.waitForFunction()` and `page.evaluate()` execute in the **browser** context — only
browser-native APIs are available there. Playwright APIs are only available in test context.

```typescript
// ❌ Wrong — Playwright APIs are not available in browser context
await page.waitForFunction(() => page.locator('#input').isVisible());

// ✅ Correct — browser-native APIs only
await page.waitForFunction(() => !!document.querySelector('#input'));
```

---

## Context menus (Radix DropdownMenu)

Radix DropdownMenu triggers are hidden by default with Tailwind `opacity-0` and become visible on
`group-hover`. They are **not** native context menus.

```typescript
// ❌ Wrong — won't find the hidden button
await page.dispatchEvent('contextmenu');

// ✅ Correct — hover reveals the button, then click
async function openContextMenu(page, cardText) {
  const card = page.locator('xpath=//div[contains(., "' + cardText + '")]').first();
  await card.hover(); // reveals hidden buttons via group-hover
  const menuButton = card.locator('button').first(); // three-dot button
  await menuButton.click();
}
```

---

## Vault unlock

Do not hand-roll this. `helpers/vaultGate.ts` exports `createOwnedVault` and
`unlockWithPassphrase`; import them from `./helpers` rather than copying a local variant into a
spec. Eleven call sites each carried their own copy and every copy was wrong in the same way; it
broke the nightly WebKit leg from `tasks.spec.ts` (issue #597). Do not write a twelfth.

What the shared helpers encode, and why:

- **The gate's panel must be required, never probed.** Both modes of the unlock panel render a
  "Use passphrase" toggle, so that button appearing is the panel's readiness signal, and clicking it
  is idempotent. The old copies probed each state with `isVisible({ timeout })` — which samples once
  and never waits — then returned early on the miss: eight keyed that early return on
  `if ((await input.count()) === 0) return;`, and the groceries three on the toggle's own
  visibility. Count is also 0 before React has rendered the panel, and the toggle is equally
  absent, so on slow hardware both read _not mounted yet_ as _the vault is open_, and handed the
  rest of the spec a gate that never opens. A `throw` further down does not save it — the early
  return has already decided.
- **The failure surfaces nowhere near its cause.** The nightly WebKit leg reported a two-minute
  timeout clicking "Add Task"; the page snapshot showed the unlock panel still on screen. A spec
  that genuinely needs an "already unlocked" path should branch at its own call site, where the
  reader can see the assumption.
- **`waitForOwnedVault` is not a signal about the screen.** `handle.initialize()` writes the stored
  record and _then_ resolves, so React commits the recovery-key step strictly afterwards. Wait for
  the "I saved it" button — which is what `createOwnedVault` does.
- **Click "Unlock", never `press('Enter')`** — Firefox does not reliably submit it.
- **The input disappearing is the unlock landing**, not the click resolving. PBKDF2 is slow by
  design and slower again on WebKit, so the assertion timeout is generous. A generous timeout is not
  a sleep; the sleep is what is forbidden.

For vault flows, the full unlock/lock cycle belongs in the preconditions of the flow matrix.

---

## Vault API stubs

Vault Absent Evidence treats a 200 from `GET /vault` as "the server holds a Vault" and withholds
create (#1963142). A dummy body such as `{ version: 1 }` is therefore not "no vault" — it is a
real-looking Vault Meta, and gated routes render "Getting your vault back" instead of create/unlock.

```typescript
// ❌ Wrong — 200 with a dummy meta withholds the create offer.
let serverMeta: object | null = { version: 1 };

// ✅ Correct — 404 until the spec's own PUT writes one.
let serverMeta: object | null = null;
```

Stub blob routes as well (`vaultBlobRouteRelative()` / `vaultBlobTypeExtractor()` in
`helpers/vaultBlobRoutes.ts`). Reconcile will GET every Vault Blob Type on mount; an unstubbed
request can leak to a real backend, or a stub that never records PUT will later restore wrapping
with `data: {}`. Do not seed a recovery key into every vault spec — only the flow that is proving
recovery-key evidence needs one.

Stub the Vault Blob Inventory too, with `routeVaultBlobInventory` from
`helpers/vaultBlobInventoryRoute.ts`, derived from the same in-memory maps the per-blob stub reads.
A Vault Pull Pass reads `GET /vault/blobs` **first** and has no fallback: a spec that stubs only the
per-blob routes converges nothing, and the unstubbed inventory request is the one that leaks
([ADR 0087](../../../../docs/adr/0087-a-vault-pull-pass-asks-the-vault-blob-inventory-and-absence-deletes-nothing.md)).
Note that the pull pass no longer GETs every Vault Blob Type — it asks only about the ones the
inventory names with an ETag this device has not already bookmarked — so a per-blob stub that is
never hit is now a normal result rather than a sign the route pattern is wrong.

```typescript
await routeVaultBlobInventory(page, {
  headers: () => corsHeaders(new URL(page.url() || 'http://localhost:3000').origin),
  // Read live, never snapshotted: the inventory has to see the spec's own PUTs.
  state: () => ({
    blobs: serverBlobs,
    etags: serverBlobEtags,
    updatedAt: serverBlobUpdatedAt,
  }),
});
```

---

## Vault reconcile and claim leftovers

Reconcile's download is two writes, not one. It first saves the server wrapping with `data: {}`,
then pulls each blob. A `readOwnedVault` immediately after removal + reload snapshots that
intermediate and fails byte-identity against the record that still had ciphertext
(`multi-user-vault` Test 4). Poll until the stub has the blob **before** treating the server as
the source of truth, then poll the local record until it matches.

A Vault Claim **copies** the Unclaimed Local Vault; it does not move it. After a silent claim the
unsuffixed slot still holds the same wrapping. `gotoStable` is a full `page.goto` that retries
only interrupted-by-another-navigation — not WebKit engine-internal errors
([ADR 0090](../../../../docs/adr/0090-gotostable-retries-only-interrupted-navigation.md)).
`login()` (which already lands on the dashboard) followed by `gotoStable` to another dashboard
route remounts `VaultSessionProvider` and re-asks claim evidence. Owned + leftover copy is the
same Vault, not a second one — the primitive returns `skipped-already-owned`, and the gate must
show unlock, never "Replace this device's vault?" (#673 FLOW 2). Do not plan a replace-offer
assertion for that leftover.

---

## Accessible names that contain each other

`getByLabel('New passphrase')` is a substring match. It also resolves "Confirm new passphrase",
which Playwright reports as a strict-mode violation after a 30s wait that looks like the field
never appeared (`vault-passphrase-change-reaches-open-tab`). The unlock helper already uses
`{ exact: true }` for "Passphrase" versus "Show password".

```typescript
// ❌ Wrong — matches both "New passphrase" and "Confirm new passphrase".
page.getByLabel('New passphrase');

// ✅ Correct — one accessible name.
page.getByLabel('New passphrase', { exact: true });
```

When inspecting a form, list every accessible name and flag any that contain another. Put
`exact: true` on those locators in the plan; do not leave TestScaffold to discover it from a
red run.

---

## Async component initialization

Vault init and Next.js hydration are client-side async. The network can be idle while React is
still initializing, so wait for **content**, not network state.

```typescript
// ❌ Wrong — network idle does not mean the UI is ready. Playwright marks
// `networkidle` DISCOURAGED, and it hangs against a production build.
await page.waitForLoadState('networkidle');

// ✅ Correct — assert the route has settled into one of the states it can
// reach. `.or()` keeps both legs in one auto-retrying web assertion.
await expect(page.getByRole('heading', { name: 'No items yet' }).or(page.getByRole('article').first()).first()).toBeVisible({ timeout: 30000 });
```

Reach for `waitForFunction` only when the condition is not expressible as a locator — reading
`localStorage`, say. It polls in browser context and reports failures far less usefully than
`expect`.

---

## Controlled inputs whose state lands after an await

`locator.check()` clicks and then verifies the checked state **once**, without retrying. That is
fine for a checkbox holding its own local state, and wrong for a controlled one whose `checked`
prop only flips after an awaited round-trip — every vault-backed toggle in this app, which
persists before it re-renders. Under WebKit the persist regularly outlives the verification, and
the test fails with `Clicking the checkbox did not change its state` on a click that in fact
worked (issue #557).

```typescript
// ❌ Wrong — one verification, no retry. Races the persist.
await checkbox.check();
await expect(checkbox).toBeChecked();

// ✅ Correct — click, then let the web assertion retry until the state lands.
await checkbox.click();
await expect(checkbox).toBeChecked({ timeout: 30000 });
```

The same applies to `uncheck()`; a second `click()` plus `not.toBeChecked()` replaces it.

---

## Waiting out a full page reload

A locator assertion cannot tell the pre-reload document from the post-reload one. When the app
calls `window.location.reload()` — `RemoveVaultCard` does, after removing a Vault — any wait for
persistent chrome is satisfied **immediately, by the doomed document**, and the next
`page.evaluate` races the navigation commit and dies with `Execution context was destroyed`
(issue #557).

Pin the current document, then wait for it to be gone. `waitForFunction` survives navigation and
re-evaluates in the new context, which is exactly the property needed here.

```typescript
// ❌ Wrong — this chrome is already on screen, so the wait returns before the reload commits.
await confirmButton.click();
await waitForDashboardReady(page);

// ✅ Correct — `waitForReload` (helpers/auth.ts) marks the document, runs the click,
// and resolves only once the marker is gone and the new shell has mounted.
await waitForReload(page, () => confirmButton.click());
```

---

## API mocking with CORS preflight

Mocked endpoints must handle `OPTIONS` (CORS preflight) or the test fails with CORS errors.

```typescript
await page.route(/\/auth\/login\/?(\?.*)?$/, async (route) => {
  const request = route.request();
  const origin = new URL(page.url() || 'http://localhost:3000').origin;

  if (request.method() === 'OPTIONS') {
    await route.fulfill({
      status: 204,
      headers: {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'access-control-allow-headers': 'content-type,authorization,if-match',
      },
    });
    return;
  }

  await route.fulfill({
    status: 200,
    headers: { 'access-control-allow-origin': origin },
    contentType: 'application/json',
    body: JSON.stringify({ token: 'fake-jwt-token', expires_in: 3600, user: {} }),
  });
});
```

---

## Parallel execution resilience

Concurrent tests saturate the network, which is one more reason never to wait on it. A
`networkidle` ladder with a `domcontentloaded` fallback is not resilience — when the first leg
times out the test has already burned its budget waiting for something it never needed.

```typescript
// ❌ Wrong — waits 10s for a condition that says nothing about the page,
// then falls back to one that says almost nothing either.
try {
  await page.waitForLoadState('networkidle', { timeout: 10000 });
} catch {
  await page.waitForLoadState('domcontentloaded');
}

// ✅ Correct — name what the page must show. Under load this waits longer;
// on a quiet machine it returns as soon as the element is there.
await expect(page.getByTestId('export-vault-button')).toBeVisible({
  timeout: 60000,
});
```

### Hydration

A controlled React form drops values typed before hydration: `fill()` writes to the DOM, but
React state stays empty and the form submits blank. Neither `networkidle` nor a sleep observes
hydration. Probe it with an interaction whose visible result is pure client state, and retry the
click — a pre-hydration click is dropped. `waitForLoginFormInteractive` in
`apps/web-e2e/src/e2e/helpers/auth.ts` is the worked example.

```typescript
await expect(async () => {
  await toggle.click();
  await expect(password).toHaveAttribute('type', 'text', { timeout: 1000 });
}).toPass({ timeout: 30000 });
```

Tests running in parallel must also use deterministic fixtures with no shared state, and document
their network expectations in a test comment.

---

## Form-based flows (React Hook Form + Zod)

Production incidents traced to gaps between test expectations and component lifecycle. Verify the
component's form configuration before writing assertions.

### MyOrganiser form defaults

```typescript
// Item-edit dialog pattern
const form = useForm<ItemData>({
  mode: 'onChange', // ← real-time validation; REQUIRED for save-button UX
  resolver: zodResolver(itemSchema),
  defaultValues: itemData,
});

// Parent ensures form state resets per item
<ItemEditDialog
  key={editingItemId ?? 'none'} // ← forces remount per item; REQUIRED
  item={editingItem || null}
/>;

// Dialog resets defaults and re-runs validation on item change
useEffect(() => {
  if (item) {
    form.reset(itemData, { keepDirty: false, keepErrors: false });
    form.trigger();
  }
}, [item?.id, form]);

// Save button logic
<Button disabled={isLoading || !form.formState.isDirty || !form.formState.isValid}>Save</Button>;
```

### Pre-implementation checklist

Confirm from the component code (not from assumption):

- [ ] Form library and validation mode (`onChange` vs `onSubmit` vs `onBlur`)
- [ ] Remounting strategy (e.g. `key={itemId}` on dialogs)
- [ ] Form reset behavior — which `useEffect` dependencies trigger it
- [ ] Exact conditions under which each button enables/disables
- [ ] How and when validation errors become visible

### Pattern 1 — assert button state transitions explicitly

```typescript
it('should enable Save button when a valid field is modified', async () => {
  await page.click('[aria-label="Edit Item"]');
  await page.waitForSelector('[role="dialog"]');

  const saveButton = page.locator('button', { hasText: 'Save' });
  expect(await saveButton.isDisabled()).toBe(true); // not dirty yet

  await page.locator('input[placeholder="Item Name"]').fill('Updated Item');

  // ✅ Assert the transition — do not wait and hope
  await expect(saveButton).toBeEnabled({ timeout: 5000 });
});
```

### Pattern 2 — validation errors block submission

```typescript
it('should prevent save when a required field is empty', async () => {
  await page.click('[aria-label="Edit Item"]');
  await page.waitForSelector('[role="dialog"]');

  await page.locator('input[aria-label="Item Name *"]').fill('');

  await expect(page.locator('text=/Item name is required/')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('button', { hasText: 'Save' })).toBeDisabled();
});
```

### Pattern 3 — form resets when switching items

```typescript
it('should reset the form when editing a different item', async () => {
  await page.click('[aria-label="Edit Item 1"]');
  await page.waitForSelector('[role="dialog"]');
  await page.locator('input[placeholder="Item Name"]').fill('Modified Name');
  await page.click('button:has-text("Save")');
  await page.waitForSelector('[role="dialog"]', { state: 'hidden' });

  await page.click('[aria-label="Edit Item 2"]');
  await page.waitForSelector('[role="dialog"]');

  // ✅ Fresh defaultValues for item 2, not the modified name
  expect(await page.locator('input[placeholder="Item Name"]').inputValue()).toBe('Item 2 Original Name');
});
```

### Pattern 4 — explicit form-state helpers

Prefer named helpers with explicit conditions over arbitrary waits.

```typescript
async function waitForFormValid(page: Page, timeout = 5000) {
  await expect(page.locator('button[type="submit"]:not(:disabled)')).toBeEnabled({ timeout });
}

async function waitForFormInvalid(page: Page, timeout = 5000) {
  await expect(page.locator('button[type="submit"]')).toBeDisabled({ timeout });
}
```

### Debugging form state

When a button doesn't change state as expected:

1. **Do NOT try different interaction patterns** (keyboard vs `fill` vs selectAll+type) — that is
   the wrong layer. Stop and investigate component architecture instead.
2. Check: does the dialog remount per item (`key={itemId}`)? Does `form.reset()` run on item
   change? Is `mode: 'onChange'` set?
3. Add debug output before concluding an interaction is correct:
   - `await page.screenshot({ path: 'dialog.png' })`
   - `console.log('Save disabled:', await button.isDisabled())`
   - `expect(page.locator('[aria-invalid="true"]')).toBeVisible()`

### Early error detection

1. Verify the test reaches the first form assertion (dialog opens, fields visible) before writing
   all remaining steps.
2. After filling fields, assert button state **before** attempting to click it.

---

## Cross-browser considerations

| Browser  | What to account for                                                                                                         |
| -------- | --------------------------------------------------------------------------------------------------------------------------- |
| Chromium | Baseline. Fastest; least forgiving of arbitrary timeouts hiding real races.                                                 |
| Firefox  | Keyboard events may not submit forms — click buttons explicitly. Assert the state change; do not sleep before asserting it. |
| WebKit   | Timing differs; be generous with assertion timeouts — never with sleeps.                                                    |
| All      | Use role-based selectors; never rely on incidental Tailwind/CSS classes.                                                    |

Run on all three browsers before marking an E2E change complete.

---

## Redirect-class statuses in route mocks

Playwright's WebKit route layer cannot fulfill with redirect-class statuses (304, 301, 302, etc.)
and throws `route.fulfill: Cannot fulfill with redirect status: 304`. On Chromium and Firefox,
answer the intended redirect status. On WebKit, substitute an equivalent non-redirect status.

```typescript
// ❌ Wrong — fails on WebKit with "Cannot fulfill with redirect status: 304"
if (request.headers()['if-none-match'] === body.etag) {
  await route.fulfill({ status: 304, headers });
  return;
}

// ✅ Correct — detect browser and substitute for WebKit
if (request.headers()['if-none-match'] === body.etag) {
  const browserName = route.request().frame().page().context().browser()?.browserType().name();
  if (browserName === 'webkit') {
    await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(body) });
  } else {
    await route.fulfill({ status: 304, headers });
  }
  return;
}
```

The Vault Blob Inventory (`vaultBlobInventoryRoute.ts`) uses this pattern: when the client sends
an `If-None-Match` ETag, it answers 304 on Chromium/Firefox but 200 with the same body on WebKit.
The client treats both identically because every inventory etag equals its Sync Bookmark, so zero
per-type blob reads follow in either case. Assert the response status conditionally in the test:

```typescript
const browserName = test.info().project.name;
expect(response.status()).toBe(browserName === 'webkit' ? 200 : 304);
```

---

## Anti-pattern table

| Anti-pattern                                               | Why it's wrong                                                                                 | Correct approach                                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Using `role="button"` for non-buttons                      | Semantic HTML violation; breaks accessibility                                                  | Use `role="article"` / `role="listitem"` for cards                                 |
| `input.press('Enter')` for form submission                 | Firefox doesn't reliably trigger it                                                            | Explicitly click the submit button                                                 |
| `page.locator()` inside `waitForFunction()`                | Browser context has no Playwright APIs                                                         | Use `document` APIs only in browser context                                        |
| Assuming standard HTML context menus                       | Radix DropdownMenu is not native; buttons are hidden                                           | Hover + click                                                                      |
| `waitForLoadState('networkidle')` anywhere                 | DISCOURAGED by Playwright; misses client-side async, and hangs against a production build      | Assert what the page must show                                                     |
| A `networkidle` → `domcontentloaded` fallback ladder       | Burns the timeout budget on a condition nothing needs                                          | One `expect(locator)` with a generous timeout                                      |
| `locator.isHidden({ timeout })` to wait for removal        | `isHidden` samples once and resolves; Playwright marks the timeout deprecated and ignores it   | `await expect(locator).toHaveCount(0, { timeout })`                                |
| `locator.isVisible({ timeout })` to wait for appearance    | Identical no-op — it never waits, so it races the render                                       | Assert the page has settled, then branch on it                                     |
| An "already unlocked" branch keyed on `count() === 0`      | Count is 0 before React renders the panel too, so it reads _not mounted yet_ as _already open_ | Require the gate's panel, then unlock; branch on "maybe unlocked" at the call site |
| `expect(input).toHaveValue(v)` after `fill(v)`             | `fill` sets the DOM value, so it is true either way — it does not prove React state took       | Under `/dashboard/*` no wait is needed; on a server-rendered form, probe hydration |
| Testing on one browser only                                | Firefox and WebKit have different patterns                                                     | Test on all three                                                                  |
| Not mocking CORS preflight                                 | Tests fail with CORS errors                                                                    | Handle `OPTIONS` in route mocks                                                    |
| Arbitrary `page.waitForTimeout()` delays                   | Hides real races; flakes under load                                                            | Wait for explicit state changes                                                    |
| Changing interaction method when a button won't enable     | Wrong layer — it's component architecture                                                      | Investigate remount / reset / form mode                                            |
| Assuming `defaultValues` are fresh after a dialog reopens  | Stale form state carries over                                                                  | Verify `key={itemId}` or reset `useEffect`                                         |
| Asserting retry / concurrency / timeout behavior           | The UI usually doesn't implement it                                                            | Only test behavior the flow exposes                                                |
| `locator.check()` on a checkbox persisted through an await | Its state verification does not retry, so it races the round-trip that flips `checked`         | `click()`, then `expect(...).toBeChecked({ timeout })`                             |
| Waiting for persistent chrome after `location.reload()`    | The pre-reload document already satisfies it; the next `evaluate` loses its execution context  | `waitForReload(page, () => trigger())`                                             |
| Dummy `{ version: 1 }` as `GET /vault` "no vault"          | A 200 is Vault Absent Evidence that the server holds a Vault; create is withheld               | Start `serverMeta` at `null` (404) until the spec's PUT                            |
| `readOwnedVault` immediately after vault removal + reload  | Reconcile writes wrapping with `data: {}` first, then blobs                                    | Poll the stub for the blob, then poll local storage until it matches               |
| `getByLabel('New passphrase')` without `exact`             | Substring match also hits "Confirm new passphrase"; strict mode waits 30s                      | `{ exact: true }` whenever one accessible name contains another                    |
| Asserting replace-offer after a silent claim leftover      | Claim copies; a later `page.goto` re-asks and the leftover is the same Vault                   | Expect unlock (`skipped-already-owned`); replace-offer is a different vault        |
