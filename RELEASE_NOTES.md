# v2.2.0

This release delivers the Web v2.0 redesign across the web app, a reworked admin portal, and paging for the admin APIs. Two database migrations run on deploy.

## Added

- Redesigned dashboard shell: navy desktop sidebar and header; phone layout with a bottom tab bar and More screen
- Redesigned Home with a navy hero, today's task progress, spaces and coming-up cards, plus a phone Home and locked-vault view
- Redesigned Tasks, grouped into Overdue, Today, Upcoming and No date, with quick add, inline detail and undo on completion
- Redesigned Groceries with Lists and Catalog tabs, a new list view, a phone screen, and category illustrations
- Redesigned Addresses and Mobile numbers: places to update become a checklist, with a searchable country code
- Redesigned Subscriptions with totals cards, status chips, sorting, a detail screen, and an end date when adding
- Redesigned Vault page with dedicated passphrase, recovery key, backups and reader screens (presentation only; no crypto or storage change)
- Redesigned Account page with preferences and YouTube digest sections; account deletion opens as a bottom sheet on phone
- Redesigned Send feedback dialog and "Your reports" list with status pills
- Redesigned YouTube Videos, Shorts and Channels pages, a connect view, and a Shorts "min left today" meter
- Privacy Policy, Terms of Service and YouTube data pages share one restyled public layout
- Admin Overview with user, admin, unverified and disabled counts, YouTube places, and 7-day sign-ups
- Admin Users directory with status and role filters, sorting and paging
- Admin audit log with actor and target names, Action and User filters, and paging
- Admin Feedback inbox with a platform filter, paging, and a redesigned triage view
- Admin user detail page with confirmed lifecycle actions and recent activity; admins cannot disable or demote themselves
- Local development: `NEXT_ALLOWED_DEV_ORIGINS` lets `next dev` accept LAN hosts for phone testing

## Fixed

- Subscriptions "Each year" card now includes yearly totals for plans in other currencies
- Users created before this release show their real sign-up date instead of the deploy date
- Admin Users: a failed "load more" keeps the users already loaded
- Admin audit log: long action labels no longer collide with names, and the phone filter sheet fits short screens
- Tasks on phones no longer flash the desktop layout on load
- Organisation names with accents (e.g. "Bär") now match their plain form in duplicate checks
- A failed log-out on phone now shows an error toast
- Vault screens no longer overflow at 390 px, and vault sub-pages have breadcrumb labels
- The mobile sidebar drawer is labelled for screen readers

## Changed

- Admin API: `GET /admin/audit-logs`, `GET /admin/users` and `GET /admin/feedback/reports` now return a paged envelope (`{ …, total, page, pageSize }`) and take `page`/`pageSize` instead of `limit`
- Feedback `platform` accepts only `web`, `ios` or `android`, and `trackingIssueNumber` must be a positive integer; other values return 422
- Database: adds `User.created_at`, backfilled from each user's ID
- Grocery wording moves from "trip" to "Grocery List"
- Deleting a task uses the shared "Delete task" confirmation dialog
- Buttons, inputs, dialogs, toasts and tables restyled to the Web v2.0 design system
- The admin "Last active" column is removed
- Security: Next.js updated to 16.4.2, clearing three advisories (two critical); Vite and Storybook dev tooling patched
