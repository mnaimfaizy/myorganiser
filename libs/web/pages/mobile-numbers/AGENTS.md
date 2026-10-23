# Mobile Numbers Page Agent Guide

## Scope

Dashboard mobile numbers page backed by the encrypted vault, plus the Mobile Number detail route at
`/dashboard/mobile-numbers/[id]`.

## Structure

- `hooks/use-mobile-numbers-page.ts` is the one vault controller for both routes. It reads and writes
  the `mobileNumbers` blob and owns every toast. Every write saves the whole list, so a write always
  starts from the list the controller has, and reloads on convergence (#587).
- `components/MobileNumbersPageClient.tsx` and `components/MobileNumberDetailPageClient.tsx` are thin
  page clients. They own the dialogs, sheets and confirms, and pick the desktop or phone view from
  `useIsMobileState`.
- The list is `mobile-numbers-board.tsx`, with `mobile-numbers-header.tsx`, `mobile-numbers-empty.tsx`,
  `mobile-number-row.tsx` (desktop) and `mobile-number-phone-row.tsx` (phone). The detail is
  `mobile-number-detail.tsx` (desktop) and `mobile-number-detail-screen.tsx` (phone).
- `utils/mobile-summary.ts` holds the pure helpers: summaries, filtering, place status, the delete
  wording, the updated line, and the `tel:` and `sms:` links.
- The Usage Locations checklist is the shared `PlacesCard` (desktop) and `PlacesPhone` (phone), and
  the place form is the shared `PlaceDialog` (desktop) and `PlaceSheet` (phone), all from
  `@myorganiser/web-usage-locations`. Do not fork them here; only the noun (`number`) differs.
- The Addresses page follows the same structure, so changes that affect both should be made in the
  shared library, not copied between the two pages.

## Why the detail route

Add and edit forms across the dashboard are summoned into a dialog or sheet, and a route may not
exist solely to host a form ([ADR 0037](../../../../docs/adr/0037-add-edit-forms-are-summoned-not-routed.md)).
`/dashboard/mobile-numbers/[id]` is kept anyway, and the reason is the **child collection**, not the
size of any form: the detail route owns the Usage Locations checklist. A Usage Location is one line on a
change-of-number checklist ([CONTEXT.md](../../../../CONTEXT.md)) — the organisation to notify, how
to reach them, and whether it has been done yet — so this page is the primary work surface, not a
decorated read-only view. Delete the checklist's home and it has nowhere to live.

This mirrors the [Addresses page](../addresses/AGENTS.md), which follows the same rule for the same
reason. The one deliberate divergence: the add-Mobile-Number form is a `Dialog`, not a `Sheet`. The
add-Address form is a `Sheet` because it is large (label, property number, street, suburb, state, zip,
country); the add-Mobile-Number form has three fields (label, country code, phone number) and fits a
`Dialog` without the multi-step treatment addresses needs. That is a container choice made from form
size, not a rule about this page.

The detail route also carries the Mobile Number's own delete, in a danger zone beside the places it
would remove, so the User reads the consequence where it is counted.

## Do

- Store mobile number entries and usage locations inside the `mobileNumbers` encrypted blob.
- Keep validation and display logic in this page library.
- Summon add and edit forms as dialogs on the page that holds the record. Add and edit differ by
  prop, not by route or query parameter.
- Keep dialog open state in client state only — no query parameter, no intercepting or parallel
  routes.
- Confirm both deletions through the shared `ConfirmDialog` with `tone="destructive"`. Deleting a
  Mobile Number destroys every Usage Location attached to it, so its confirmation says how many.
- Stamp `updatedAt` on every write to a Mobile Number, including ticking a place, as the controller does.

## Do Not

- Do not add plaintext mobile number storage or APIs.
- Do not add a route whose only content is a form.
- Do not auto-open a dialog across a navigation. A freshly created Mobile Number lands on an empty
  checklist, and that empty state is its own call to action.
- Do not hide a Mobile Number's delete behind hover on the list. The desktop row's delete is always
  visible.
