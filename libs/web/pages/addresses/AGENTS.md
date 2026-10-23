# Addresses Page Agent Guide

## Scope

Dashboard addresses page backed by the encrypted vault, plus the Address detail route at
`/dashboard/addresses/[id]`.

## Why this page keeps a detail route

Add and edit forms across the dashboard are summoned into a dialog or sheet, and a route may not
exist solely to host a form ([ADR 0037](../../../../docs/adr/0037-add-edit-forms-are-summoned-not-routed.md)).
`/dashboard/addresses/[id]` is kept anyway, and the reason is the **child collection**, not the size
of any form: the detail route owns the Places checklist. A Usage Location is one line on a
change-of-address checklist ([CONTEXT.md](../../../../CONTEXT.md)) — the organisation to notify, how
to reach them, and whether it has been done yet — so this page is the primary work surface, not a
decorated read-only view. Delete the checklist's home and the checklist has nowhere to live.

The add-Address and edit-Address forms are `Sheet`s (`AddressFormSheet`) because the form is large;
that is a container choice and is **not** the reason the route survives. The place form is a
`Dialog` on desktop (`PlaceDialog`) and a bottom sheet on phone (`PlaceSheet`), both summoned from
the detail page the record already lives on.

## Structure

- `hooks/use-addresses-page.ts` — every vault read and write for the list and the detail route,
  with the toasts. Components consume its controller; they do not write the vault themselves.
- `utils/address-summary.ts` — pure presentation helpers (copy fields, filtering, deletion wording).
  `utils/presentation.ts` holds the status pill table.
- `components/AddressDetailPageClient.tsx` owns the dialog, sheet, confirm and leaving state for the
  detail route. `address-detail.tsx` is the desktop view and `address-detail-screen.tsx` the phone
  view; both are presentational and take their callbacks as props.
- `libs/web/usage-locations` owns the place form (`PlaceDialog`, `PlaceSheet`, `usePlaceForm`), the
  Places checklist (`PlacesCard`, `PlacesPhone`, and the progress and sorting helpers they use), and the
  copy action (`useExpiringCopy`). This page passes its Address's `usageLocations` and `noun="address"`.

## Do

- Store address entries and usage locations inside the `addresses` encrypted blob.
- Keep validation and display logic in this page library.
- Summon add and edit forms as dialogs or sheets on the page that holds the record. Add and edit
  differ by prop, not by route or query parameter.
- Keep dialog open state in client state only — no query parameter, no intercepting or parallel
  routes.
- Confirm both deletions through the shared `ConfirmDialog` (`tone="destructive"`), not
  `ConfirmDeleteDialog`. Deleting an Address destroys every Usage Location attached to it, so its
  confirmation says how many (`describeAddressDeletion`).
- Keep the post-delete redirect from flashing "Address not found." with a `leavingRef`.
- Let the checklist tick a Usage Location through `setLocationChanged`; the row is disabled while its
  write is pending.

## Do Not

- Do not add plaintext address endpoints or server-side search over sensitive fields.
- Do not add a route whose only content is a form.
- Do not auto-open a dialog across a navigation. A freshly created Address lands on an empty Places
  checklist, and that empty state is its own call to action.
