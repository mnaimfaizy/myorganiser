# Web Usage Locations Agent Guide

## Scope

The Usage Location UI that Addresses and Mobile numbers share: the add-place dialog, its form schema, the labels for the organisation-type, update-method and priority vocabularies, the Places checklist (`PlacesCard` on desktop, `PlacesPhone` on phone), and the copy-to-clipboard action with its 60-second confirmation (`useExpiringCopy`). A page library passes its subject and noun; everything else is written once here.

## Commands

- Test: `yarn nx test web-usage-locations`.
- Lint: `yarn nx lint web-usage-locations`.

## Do

- Build from `@myorganiser/web-ui` primitives. A control both pages need and no other page does belongs here; a control any page could use belongs in web-ui.
- Read the vocabularies from `@myorganiser/vault-core`, and label them through the pinned `satisfies Record<…>` tables in this library. Never title-case an enum value for display.
- Keep the page-specific words (the subject, "address" or "number") as props. A string that differs between the two pages is a prop, not a branch.

## Do Not

- Do not save, sync or encrypt here. The page owns the Usage Location record and the Vault write; this library returns form values.
- Do not import from a page library.
