# Subscriptions Page Agent Guide

## Scope

Dashboard subscriptions list page backed by the encrypted vault. Add and edit happen in a dialog (desktop) or a bottom sheet (phone) summoned from the page; no route hosts a form (see ADR 0037).

`/dashboard/subscriptions/[id]` is a detail route, not a form route: on phone it is the pushed detail screen, on desktop it opens the list with that subscription's detail panel. Its content is the detail itself, which is why it survives ADR 0037.

## Do

- Store subscription data inside the `subscriptions` encrypted blob.
- Use account currency preferences for totals and conversions when needed.
- Keep vault reads and writes in `hooks/use-subscriptions-page.ts`, and pure totals, renewal and sorting logic in `utils/subscription-summary.ts`.

## Do Not

- Do not send plaintext subscription details to backend APIs.
