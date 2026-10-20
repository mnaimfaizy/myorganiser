# MyOrganiser Web v2.0

The approved v2.0 UI/UX design for the web app — user portal, admin portal, and the public pages — committed so that anyone building it, a person or an agent in a sandbox with no claude.ai login, reads the same design the maintainer approved ([ADR 0110](../../adr/0110-an-approved-design-is-committed-to-the-repo.md)).

|                  |                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| Source           | [Claude Design canvas](https://claude.ai/artifact/59o7kdnAyxfpsNTrPstwBt) (private; needs the owner's login) |
| Exported version | `1792474123-308c`                                                                                            |
| Exported         | 2026-10-20                                                                                                   |
| Approved for     | Web v2.0 PRD (filed next)                                                                                    |

**These files are the design of record.** When the canvas changes after approval, the change is exported here in its own commit; the canvas link is for collaborating on the next version, and the files here are what an issue or pull request builds to.

## Reading the files

- `artboards/` holds one HTML file per artboard, exactly as the canvas published it. Every size, colour, radius and string is written inline, so the markup answers "what does the design say here". Open a file in a browser to see it; the canvas runtime (`support.js`) and web fonts are not included, and artboards that import shared components (`<dc-import name="…">`) render those parts only on the canvas.
- Shared pieces are their own files and are reused by every page: `AppSidebar`, `AppHeader`, `AdminSidebar`, `TabBar`, `Illustration` (section illustrations), `CategoryIllustration` (grocery categories), `EmptyPage`, `EmptyPhone`, `PlaceDialog`.
- An artboard with a `data-props` editor (for example `state`, `view`, `kind`) shows several states; its `renderVals()` lists them. A small wrapper artboard (for example `VaultLocked`, `YourReportsEmpty`) imports a page with one of those states set.
- `canvas.json` is the canvas's own index: each artboard's page, title, size and position, and the notes. The tables below are generated from it. Each page's notes record the decisions made in review and the backend changes the design needs.
- Copy rule: wording is today's app wording unless a note says otherwise. Where an artboard and today's code disagree on wording, the artboard was written from the code — raise it rather than pick one silently. Where an artboard and a Foundations artboard disagree, raise it.
- Sample data (names, emails, dates, recovery keys) is invented. A recovery key is always the placeholder `XXXX-XXXX-…(sample)`.

## Artboards

### 0 · Foundations

| Artboard                                                 | File                                                                   | Size        |
| -------------------------------------------------------- | ---------------------------------------------------------------------- | ----------- |
| Tokens — colour, type, space                             | [Main.dc.html](artboards/Main.dc.html)                                 | 1440 × 1080 |
| Section illustrations (approved)                         | [Illustrations.dc.html](artboards/Illustrations.dc.html)               | 1440 × 760  |
| Component — illustration                                 | [Illustration.dc.html](artboards/Illustration.dc.html)                 | 160 × 160   |
| Component — phone tab bar                                | [TabBar.dc.html](artboards/TabBar.dc.html)                             | 390 × 88    |
| Component — app sidebar                                  | [AppSidebar.dc.html](artboards/AppSidebar.dc.html)                     | 272 × 1100  |
| Component — admin sidebar                                | [AdminSidebar.dc.html](artboards/AdminSidebar.dc.html)                 | 272 × 900   |
| Grocery category illustrations                           | [GroceryCategories.dc.html](artboards/GroceryCategories.dc.html)       | 1440 × 340  |
| Actions — buttons, links, icon buttons                   | [Buttons.dc.html](artboards/Buttons.dc.html)                           | 1440 × 900  |
| Form controls                                            | [Inputs.dc.html](artboards/Inputs.dc.html)                             | 1440 × 1000 |
| Component — page header bar                              | [AppHeader.dc.html](artboards/AppHeader.dc.html)                       | 1168 × 80   |
| Component — grocery category illustration                | [CategoryIllustration.dc.html](artboards/CategoryIllustration.dc.html) | 96 × 96     |
| Component — Add place dialog (Addresses, Mobile numbers) | [PlaceDialog.dc.html](artboards/PlaceDialog.dc.html)                   | 1440 × 900  |
| Component — empty phone screen                           | [EmptyPhone.dc.html](artboards/EmptyPhone.dc.html)                     | 390 × 844   |
| Status and feedback                                      | [Feedback.dc.html](artboards/Feedback.dc.html)                         | 1440 × 1100 |
| Containers and data                                      | [Data.dc.html](artboards/Data.dc.html)                                 | 1440 × 1200 |
| Component — empty feature page                           | [EmptyPage.dc.html](artboards/EmptyPage.dc.html)                       | 1440 × 900  |
| Desktop navigation and page header                       | [Navigation.dc.html](artboards/Navigation.dc.html)                     | 1440 × 1100 |
| Phone — app bar, tab bar, add button                     | [PhoneNav.dc.html](artboards/PhoneNav.dc.html)                         | 390 × 1320  |
| Phone — lists and rows                                   | [PhoneLists.dc.html](artboards/PhoneLists.dc.html)                     | 390 × 1420  |
| Phone — sheets and feedback                              | [PhoneOverlays.dc.html](artboards/PhoneOverlays.dc.html)               | 390 × 1320  |
| Phone — forms and controls                               | [PhoneForms.dc.html](artboards/PhoneForms.dc.html)                     | 390 × 1240  |

### 1 · Dashboard

| Artboard                   | File                                                         | Size        |
| -------------------------- | ------------------------------------------------------------ | ----------- |
| Desktop — Home (user)      | [UserDashboard.dc.html](artboards/UserDashboard.dc.html)     | 1440 × 1500 |
| Desktop — Admin overview   | [AdminDashboard.dc.html](artboards/AdminDashboard.dc.html)   | 1440 × 1350 |
| Phone — Home               | [HomePhone.dc.html](artboards/HomePhone.dc.html)             | 390 × 844   |
| Phone — Home, vault locked | [HomePhoneLocked.dc.html](artboards/HomePhoneLocked.dc.html) | 390 × 844   |
| Phone — Admin overview     | [AdminPhone.dc.html](artboards/AdminPhone.dc.html)           | 390 × 844   |

> Backend needed for the admin overview:
> • A stats endpoint: user totals by role, disabled, unverified, YouTube Access places used.
> • Audit log: actor and target names (today raw ids), plus paging past the newest 50.
> • Users list: paging, sort, and role / status filters (today search only).
> Each needs an API change and yarn openapi:sync before the UI can ship.

### 2 · Groceries

| Artboard                   | File                                                                     | Size        |
| -------------------------- | ------------------------------------------------------------------------ | ----------- |
| Desktop — Grocery Lists    | [GroceriesLists.dc.html](artboards/GroceriesLists.dc.html)               | 1440 × 1100 |
| Desktop — one Grocery List | [GroceriesList.dc.html](artboards/GroceriesList.dc.html)                 | 1440 × 1240 |
| Desktop — Catalog          | [GroceriesCatalog.dc.html](artboards/GroceriesCatalog.dc.html)           | 1440 × 1000 |
| Desktop — Add item dialog  | [GroceriesAddItem.dc.html](artboards/GroceriesAddItem.dc.html)           | 1440 × 900  |
| Phone — Grocery Lists      | [GroceriesPhone.dc.html](artboards/GroceriesPhone.dc.html)               | 390 × 844   |
| Phone — in the shop        | [GroceryListPhone.dc.html](artboards/GroceryListPhone.dc.html)           | 390 × 844   |
| Phone — Add to list sheet  | [GroceriesAddPhone.dc.html](artboards/GroceriesAddPhone.dc.html)         | 390 × 844   |
| Phone — empty list         | [GroceryListEmptyPhone.dc.html](artboards/GroceryListEmptyPhone.dc.html) | 390 × 844   |

> Decisions in this page:
> • Words follow CONTEXT.md: Grocery List (never "trip"), Catalog Item, Uncheck All, Remove Checked, Delete Grocery List.
> • Lines group by category in shop-walk order (GROCERY_CATEGORY_ORDER).
> • An empty list says so — no more "All checked".
> • The Catalog is its own tab, so it is reachable with zero lists.
> • Totals unchanged: a line counts its Catalog Item price once; Amount is a label. Multiplying by amount would be a domain change.

### 3 · Tasks

| Artboard                          | File                                                               | Size        |
| --------------------------------- | ------------------------------------------------------------------ | ----------- |
| Desktop — Tasks with detail panel | [TasksPage.dc.html](artboards/TasksPage.dc.html)                   | 1440 × 1150 |
| Desktop — Tasks, all clear        | [TasksAllClear.dc.html](artboards/TasksAllClear.dc.html)           | 1440 × 820  |
| Desktop — Add task dialog         | [TaskAddDialog.dc.html](artboards/TaskAddDialog.dc.html)           | 1440 × 900  |
| Phone — Tasks                     | [TasksPhone.dc.html](artboards/TasksPhone.dc.html)                 | 390 × 844   |
| Phone — Quick capture             | [TaskCapturePhone.dc.html](artboards/TaskCapturePhone.dc.html)     | 390 × 844   |
| Phone — Task detail               | [TaskDetailPhone.dc.html](artboards/TaskDetailPhone.dc.html)       | 390 × 844   |
| Phone — all clear                 | [TasksAllClearPhone.dc.html](artboards/TasksAllClearPhone.dc.html) | 390 × 844   |

> Decisions in this page:
> • Tick to complete: the checkbox moves a Task to done (closedAt set), Undo in the toast.
> • Groups: Overdue, Today, Upcoming, No date — then Done collapsed.
> • Description and estimated minutes finally get UI.
> • Status shows as a pill only when it is not the default (In progress, Blocked).
> • Filters: context segmented + status chips; archived behind a chip.
> • Same sort inside a group as today: priority, then due, then created.

### 4 · Addresses

| Artboard                          | File                                                                 | Size        |
| --------------------------------- | -------------------------------------------------------------------- | ----------- |
| Desktop — Addresses               | [AddressesList.dc.html](artboards/AddressesList.dc.html)             | 1440 × 1050 |
| Desktop — one Address             | [AddressDetail.dc.html](artboards/AddressDetail.dc.html)             | 1440 × 1250 |
| Desktop — Add address sheet       | [AddressAddSheet.dc.html](artboards/AddressAddSheet.dc.html)         | 1440 × 900  |
| Desktop — Add place to an address | [AddressPlaceDialog.dc.html](artboards/AddressPlaceDialog.dc.html)   | 1440 × 900  |
| Desktop — no addresses yet        | [AddressesEmpty.dc.html](artboards/AddressesEmpty.dc.html)           | 1440 × 900  |
| Phone — Addresses                 | [AddressesPhone.dc.html](artboards/AddressesPhone.dc.html)           | 390 × 844   |
| Phone — one Address               | [AddressDetailPhone.dc.html](artboards/AddressDetailPhone.dc.html)   | 390 × 844   |
| Phone — Add usage location        | [UsageLocationPhone.dc.html](artboards/UsageLocationPhone.dc.html)   | 390 × 844   |
| Phone — no addresses yet          | [AddressesEmptyPhone.dc.html](artboards/AddressesEmptyPhone.dc.html) | 390 × 844   |

> Decisions in this page:
> • Copy is the main action: tap a field to copy it, or Copy all. The clipboard clears after 60 s.
> • Usage Locations become a checklist with progress ("3 of 5 updated"); the 7-column table only remains on wide desktop as columns inside each row.
> • Status Current / Old can be changed from the detail page (today it has no control).
> • Delete moves to the detail page's danger zone; the list keeps a row menu.
> • Same pattern is reused by Mobile numbers.

### 5 · Mobile numbers

| Artboard                          | File                                                             | Size        |
| --------------------------------- | ---------------------------------------------------------------- | ----------- |
| Desktop — Mobile numbers          | [MobilesList.dc.html](artboards/MobilesList.dc.html)             | 1440 × 900  |
| Desktop — one Mobile number       | [MobileDetail.dc.html](artboards/MobileDetail.dc.html)           | 1440 × 1100 |
| Desktop — Add place to a number   | [MobilePlaceDialog.dc.html](artboards/MobilePlaceDialog.dc.html) | 1440 × 900  |
| Desktop — no mobile numbers yet   | [MobilesEmpty.dc.html](artboards/MobilesEmpty.dc.html)           | 1440 × 900  |
| Phone — Mobile numbers            | [MobilesPhone.dc.html](artboards/MobilesPhone.dc.html)           | 390 × 844   |
| Phone — one Mobile number, copied | [MobileDetailPhone.dc.html](artboards/MobileDetailPhone.dc.html) | 390 × 844   |
| Phone — Add place to a number     | [MobilePlacePhone.dc.html](artboards/MobilePlacePhone.dc.html)   | 390 × 844   |
| Phone — no mobile numbers yet     | [MobilesEmptyPhone.dc.html](artboards/MobilesEmptyPhone.dc.html) | 390 × 844   |

> Decisions in this page:
> • Parity with Addresses: search, counters, empty state with an action, visible delete (no hover-only button).
> • Copy number and a Call action (tel: link) on the detail page.
> • Country code uses the same searchable picker as Addresses.
> • Usage Locations reuse the Address checklist exactly; only the noun changes.

### 6 · Subscriptions

| Artboard                       | File                                                                         | Size        |
| ------------------------------ | ---------------------------------------------------------------------------- | ----------- |
| Desktop — Subscriptions        | [SubscriptionsPage.dc.html](artboards/SubscriptionsPage.dc.html)             | 1440 × 1150 |
| Desktop — Edit subscription    | [SubscriptionForm.dc.html](artboards/SubscriptionForm.dc.html)               | 1440 × 980  |
| Desktop — no subscriptions yet | [SubscriptionsEmpty.dc.html](artboards/SubscriptionsEmpty.dc.html)           | 1440 × 900  |
| Phone — Subscriptions          | [SubscriptionsPhone.dc.html](artboards/SubscriptionsPhone.dc.html)           | 390 × 844   |
| Phone — one Subscription       | [SubscriptionDetailPhone.dc.html](artboards/SubscriptionDetailPhone.dc.html) | 390 × 844   |
| Phone — New subscription       | [SubscriptionFormPhone.dc.html](artboards/SubscriptionFormPhone.dc.html)     | 390 × 844   |
| Phone — no subscriptions yet   | [SubscriptionsEmptyPhone.dc.html](artboards/SubscriptionsEmptyPhone.dc.html) | 390 × 844   |

> Decisions in this page:
> • One headline number: a monthly equivalent across cycles (per currency, plus the converted total when the user asks for it).
> • "Renews in N days" replaces a bare date; within 7 days it turns amber.
> • Status is a pill and a filter (Active default); Cancelled and Expired drop out of totals as today.
> • Payment method, renewal type and tier finally show on the detail.
> • Inline field errors on the form; end date available when adding.

### 7 · YouTube

| Artboard                                            | File                                                                     | Size        |
| --------------------------------------------------- | ------------------------------------------------------------------------ | ----------- |
| Desktop — YouTube videos                            | [YouTubeVideos.dc.html](artboards/YouTubeVideos.dc.html)                 | 1440 × 1100 |
| Desktop — Shorts with daily budget                  | [YouTubeShorts.dc.html](artboards/YouTubeShorts.dc.html)                 | 1440 × 1000 |
| Desktop — Channels                                  | [YouTubeChannels.dc.html](artboards/YouTubeChannels.dc.html)             | 1440 × 1000 |
| Desktop — Connect, withdrawn, unavailable           | [YouTubeConnect.dc.html](artboards/YouTubeConnect.dc.html)               | 1440 × 900  |
| Desktop — First look: access granted, not connected | [YouTubeFirstLook.dc.html](artboards/YouTubeFirstLook.dc.html)           | 1440 × 1300 |
| Desktop — Returning from Google: connecting, failed | [YouTubeCallback.dc.html](artboards/YouTubeCallback.dc.html)             | 1440 × 900  |
| Phone — Videos                                      | [YouTubePhone.dc.html](artboards/YouTubePhone.dc.html)                   | 390 × 844   |
| Phone — Shorts                                      | [ShortsPhone.dc.html](artboards/ShortsPhone.dc.html)                     | 390 × 844   |
| Phone — Access withdrawn                            | [YouTubeConnectPhone.dc.html](artboards/YouTubeConnectPhone.dc.html)     | 390 × 844   |
| Phone — First look                                  | [YouTubeFirstLookPhone.dc.html](artboards/YouTubeFirstLookPhone.dc.html) | 390 × 1640  |

> Decisions in this page:
> • One page header with tabs Videos / Shorts / Channels, no card-in-card.
> • Sync freshness and the Sync button sit together in the header.
> • Three distinct notices: Connect (first time), Access withdrawn (permanent, explains why and what was deleted), Temporarily unavailable (try later). Today one notice covers all three.
> • Empty directory copy points to Channels, not to a list that isn't there.
> • Weekly digest stays on the Account page; Channels links to it.
> Backend: telling "withdrawn" from "down" needs the availability check to return a reason.
> • First look (access granted, not connected) uses today's copy word for word: the six storage points, the Before you connect points, the agreement and Connect YouTube. Tweak "state" shows ticked, the not-ticked error and the revoked note.
> • Flagged, not changed: connecting imports no channels, so the first connected view says "No channels yet"; a failed status or auth-url call shows nothing.

### 8 · Vault

| Artboard                                      | File                                                                       | Size        |
| --------------------------------------------- | -------------------------------------------------------------------------- | ----------- |
| Desktop — Vault, unlocked                     | [VaultPage.dc.html](artboards/VaultPage.dc.html)                           | 1440 × 2400 |
| Desktop — Vault, locked (first open)          | [VaultLocked.dc.html](artboards/VaultLocked.dc.html)                       | 1440 × 2400 |
| Desktop — Change passphrase dialog            | [ChangePassphraseDialog.dc.html](artboards/ChangePassphraseDialog.dc.html) | 1440 × 1000 |
| Desktop — Rotate recovery key dialog, step 2  | [RotateKeyDialog.dc.html](artboards/RotateKeyDialog.dc.html)               | 1440 × 1100 |
| Desktop — Import: replace this device's vault | [ImportReplaceDialog.dc.html](artboards/ImportReplaceDialog.dc.html)       | 1440 × 900  |
| Desktop — Remove local vault dialog           | [RemoveVaultDialog.dc.html](artboards/RemoveVaultDialog.dc.html)           | 1440 × 900  |
| Desktop — Unlock gate on other pages          | [VaultUnlock.dc.html](artboards/VaultUnlock.dc.html)                       | 1440 × 900  |
| Desktop — First-time setup and recovery key   | [VaultSetup.dc.html](artboards/VaultSetup.dc.html)                         | 1440 × 900  |
| Phone — Vault, unlocked                       | [VaultPhone.dc.html](artboards/VaultPhone.dc.html)                         | 390 × 1240  |
| Phone — Vault, locked                         | [VaultLockedPhone.dc.html](artboards/VaultLockedPhone.dc.html)             | 390 × 1240  |
| Phone — Unlock gate on other screens          | [UnlockPhone.dc.html](artboards/UnlockPhone.dc.html)                       | 390 × 844   |
| Phone — Change passphrase                     | [ChangePassphrasePhone.dc.html](artboards/ChangePassphrasePhone.dc.html)   | 390 × 1000  |
| Phone — Rotate recovery key, step 2           | [RotateKeyPhone.dc.html](artboards/RotateKeyPhone.dc.html)                 | 390 × 1240  |
| Phone — Backups, export and import            | [BackupsPhone.dc.html](artboards/BackupsPhone.dc.html)                     | 390 × 1400  |
| Phone — Offline reader                        | [ReaderPhone.dc.html](artboards/ReaderPhone.dc.html)                       | 390 × 1240  |
| Phone — Save your recovery key (setup)        | [RecoveryKeyPhone.dc.html](artboards/RecoveryKeyPhone.dc.html)             | 390 × 844   |

> Decisions in this page:
> • Every section from today's Vault page is here, with its copy kept word for word: Unlock, Change passphrase, Rotate recovery key, Encrypted Escape Copy (Google Drive), Export, Import, the offline reader, Remove local vault.
> • First open while locked: the Unlock panel replaces the status hero. Passphrase and recovery-key cards are disabled with today's reason; backups, export, import and the reader still work.
> • Change passphrase and Rotate recovery key move into dialogs (phone: pushed screens) that carry their full explanations. The cards keep their one-line description.
> • Change passphrase has a tweak for the recovery-key unlock path ("Set new passphrase").
> • Import and Restore from Google Drive share one replace dialog; its text and tick box follow what the file changes.
> • Remove dialog: the button says "Remove from this device" instead of today's "Delete".
> • Sample recovery keys are placeholders, never real keys.

### 9 · Account

| Artboard                                      | File                                                                 | Size        |
| --------------------------------------------- | -------------------------------------------------------------------- | ----------- |
| Desktop — Account                             | [AccountPage.dc.html](artboards/AccountPage.dc.html)                 | 1440 × 1520 |
| Desktop — Delete account, step 1: Escape Copy | [DeleteAccountStep1.dc.html](artboards/DeleteAccountStep1.dc.html)   | 1440 × 900  |
| Desktop — Delete account, step 2: confirm     | [DeleteAccountDialog.dc.html](artboards/DeleteAccountDialog.dc.html) | 1440 × 900  |
| Phone — Account                               | [AccountPhone.dc.html](artboards/AccountPhone.dc.html)               | 390 × 1120  |
| Phone — Delete account, step 1                | [DeleteStep1Phone.dc.html](artboards/DeleteStep1Phone.dc.html)       | 390 × 844   |
| Phone — Delete account, step 2                | [DeleteStep2Phone.dc.html](artboards/DeleteStep2Phone.dc.html)       | 390 × 844   |

> Decisions in this page:
> • Wording follows today's Account page; new copy only where today has none (profile header, Preferences line, backup summary).
> • A profile header (today the page has no identity or title).
> • Order: backups summary, Preferences, Weekly YouTube digest (only when YouTube is connected), Install MyOrganiser (hidden once installed), Delete account.
> • The backup summary links to the Vault page instead of duplicating it.
> • Delete keeps today's two steps. Step 1 offers an Escape Copy; its button reads "Continue without a copy" until one is downloaded, then "Continue" (tweak on the step 1 board). Step 2 asks for the password and DELETE.

### 10 · Admin portal

| Artboard                          | File                                                             | Size        |
| --------------------------------- | ---------------------------------------------------------------- | ----------- |
| Desktop — Users                   | [AdminUsers.dc.html](artboards/AdminUsers.dc.html)               | 1440 × 1000 |
| Desktop — User detail             | [AdminUserDetail.dc.html](artboards/AdminUserDetail.dc.html)     | 1440 × 1100 |
| Desktop — Audit log               | [AdminAuditLog.dc.html](artboards/AdminAuditLog.dc.html)         | 1440 × 1000 |
| Desktop — Withdraw YouTube Access | [AdminActionDialog.dc.html](artboards/AdminActionDialog.dc.html) | 1440 × 900  |
| Phone — Users                     | [AdminUsersPhone.dc.html](artboards/AdminUsersPhone.dc.html)     | 390 × 844   |
| Phone — User detail               | [AdminUserPhone.dc.html](artboards/AdminUserPhone.dc.html)       | 390 × 844   |
| Phone — Audit log                 | [AdminAuditPhone.dc.html](artboards/AdminAuditPhone.dc.html)     | 390 × 844   |

> Decisions and backend needs:
> • Users: filter chips (role, status), sort, paging — needs list-users paging and filters.
> • User detail: sectioned cards; actions grouped by risk; you cannot disable or demote yourself (button disabled with a reason).
> • Recent activity on the user page — needs audit log filtered by user.
> • Audit log: names instead of raw ids, action pills, filters, paging past 50 — needs names joined and paging.
> • Every destructive action keeps a confirm dialog that says exactly what happens.

### 11 · Feedback

| Artboard                                      | File                                                                   | Size        |
| --------------------------------------------- | ---------------------------------------------------------------------- | ----------- |
| Desktop — Send feedback dialog                | [FeedbackDialog.dc.html](artboards/FeedbackDialog.dc.html)             | 1440 × 1180 |
| Desktop — Your reports                        | [YourReports.dc.html](artboards/YourReports.dc.html)                   | 1440 × 1400 |
| Desktop — Your reports, empty                 | [YourReportsEmpty.dc.html](artboards/YourReportsEmpty.dc.html)         | 1440 × 900  |
| Desktop — Fix Notice unsubscribe (email link) | [FixNoticeUnsubscribe.dc.html](artboards/FixNoticeUnsubscribe.dc.html) | 1440 × 900  |
| Phone — Send feedback                         | [FeedbackPhone.dc.html](artboards/FeedbackPhone.dc.html)               | 390 × 1360  |
| Phone — More tab, feedback entry points       | [MorePhone.dc.html](artboards/MorePhone.dc.html)                       | 390 × 844   |
| Phone — Your reports                          | [YourReportsPhone.dc.html](artboards/YourReportsPhone.dc.html)         | 390 × 1100  |
| Phone — Unsubscribe link no longer valid      | [UnsubscribePhone.dc.html](artboards/UnsubscribePhone.dc.html)         | 390 × 844   |

> Decisions in this page:
> • Wording is today's, word for word, from the dialog, Your reports, the follow-up form and the unsubscribe page.
> • Entry points: "Send feedback" in the sidebar footer and the account menu (desktop), and the More tab (phone). Your reports sits on the Account page with its Updated badge.
> • The dialog keeps the plaintext warning and shows the Report Context before sending. Tweak "kind" switches Bug report and Suggestion.
> • Status pills: Received and Under review neutral and blue, Planned violet, Fixed and Shipped teal, Won't do red, Can't reproduce amber outline.
> • The unsubscribe page has a tweak for its four states: working, done, invalid, error.
> • New illustration: feedback (two speech bubbles). Added to Foundations.

### 12 · Admin feedback

| Artboard                              | File                                                                 | Size        |
| ------------------------------------- | -------------------------------------------------------------------- | ----------- |
| Desktop — Feedback inbox              | [AdminFeedbackInbox.dc.html](artboards/AdminFeedbackInbox.dc.html)   | 1440 × 1000 |
| Desktop — Report, open for triage     | [AdminFeedbackReport.dc.html](artboards/AdminFeedbackReport.dc.html) | 1440 × 1300 |
| Desktop — Report, Fixed (Reopen only) | [AdminFeedbackFixed.dc.html](artboards/AdminFeedbackFixed.dc.html)   | 1440 × 1300 |
| Phone — Feedback inbox                | [AdminFeedbackPhone.dc.html](artboards/AdminFeedbackPhone.dc.html)   | 390 × 844   |
| Phone — Report and triage             | [AdminReportPhone.dc.html](artboards/AdminReportPhone.dc.html)       | 390 × 1500  |

> Decisions and backend needs:
> • Feedback joins the admin sidebar and the admin phone tab bar, with the slate inbox illustration.
> • Sidebar badge counts Received reports — needs a count endpoint (none today).
> • Inbox keeps today's filters (Status, Kind, Platform, Tracking issue). Platform becomes a dropdown (Any platform, Web, iOS, Android) instead of free text — the column is a plain string today, so the backend should validate these three values and columns; adds paging (Newer / Older) — needs offset or cursor paging (today: first 100, no paging).
> • Report detail splits the reading column from a Triage panel, so every action sits beside what it acts on. All wording is today's.
> • Triage keeps inline messages, no toasts or confirm dialogs, as today.
> • Fixed and Shipped show only the final note, the Tracking Issue and Reopen.
> • Admin Home is still a redirect today; the v2 Overview replaces it.

### 13 · Legal pages

| Artboard                                 | File                                                                     | Size        |
| ---------------------------------------- | ------------------------------------------------------------------------ | ----------- |
| Desktop — Privacy Policy                 | [LegalPrivacy.dc.html](artboards/LegalPrivacy.dc.html)                   | 1440 × 3300 |
| Desktop — Terms of Service               | [LegalTerms.dc.html](artboards/LegalTerms.dc.html)                       | 1440 × 2100 |
| Desktop — How we store your YouTube data | [LegalYouTubeData.dc.html](artboards/LegalYouTubeData.dc.html)           | 1440 × 1400 |
| Phone — Privacy Policy                   | [LegalPrivacyPhone.dc.html](artboards/LegalPrivacyPhone.dc.html)         | 390 × 6600  |
| Phone — Terms of Service                 | [LegalTermsPhone.dc.html](artboards/LegalTermsPhone.dc.html)             | 390 × 3900  |
| Phone — How we store your YouTube data   | [LegalYouTubeDataPhone.dc.html](artboards/LegalYouTubeDataPhone.dc.html) | 390 × 2300  |

> Decisions in this page:
> • Every word of Privacy, Terms and How we store your YouTube data is today's, unchanged. Only the layout is new.
> • One public layout for all three: a slim header with Privacy Policy and Terms of Service, a navy title band with an illustration, an On this page list, numbered section cards, and the landing footer line.
> • On the phone the On this page list sits above the text.
> • The same section components still feed the Sign up dialog (h3 there).
> • Operator & Contact shows placeholder values; the real ones come from OPERATOR_NAME and OPERATOR_CONTACT_EMAIL.
> • Flagged, not changed: Terms has no Last updated line; How we store your YouTube data links only to /dashboard/youtube, so a signed-out reader has no way back. There is no separate YouTube terms page — Terms links to YouTube's own.
