# A Feedback Report becomes Fixed when the Production deploy ships its Tracking Issue

A Bug Report becomes Fixed, and a Suggestion Shipped, when a Release reaches Production carrying a commit that closes the report's Tracking Issue. The Production deploy workflow sets it, through a narrow service credential to the backend. A merged pull request never does.

## Status

accepted

## Context

Grilled 2026-10-17 alongside the landing-page redesign. MyOrganiser had no way for a User to report a bug or suggest an improvement, and no way to tell them their report was dealt with. The grill agreed that Feedback Reports live on MyOrganiser's own backend, not in public GitHub Issues or a third-party board, because a report is server-readable plaintext and must never carry vault contents. It also agreed that only a signed-in User can send one, and that "Fixed" means the fix is in a Release, not merely merged (CONTEXT.md: Fixed, Shipped).

The repository already makes every fix traceable to an issue. A branch or its first commit names its issue (ADR 0076), and a Release is a `vX.Y.Z` tag that is live in Production.

## Decision

- **An admin links a report to a Tracking Issue during triage.** That link is the only manual step, and many reports may share one Tracking Issue. Duplicates are folded this way, not marked as such.
- **The Production deploy sets Fixed and Shipped.** After a Release is live, the deploy workflow lists the issues closed by commits between the previous Release tag and the new one. It then tells the backend that every Feedback Report on one of those Tracking Issues is Fixed or Shipped in that Release. The backend records the Release and sends any opted-in Fix Notices.
- **The workflow's credential can do exactly that and nothing else.** It authorises one endpoint that takes a Release tag and a list of issue numbers. It cannot read report content or identities, and it is not an admin session.
- **An admin can still mark a report by hand.** This covers a fix that never had a Tracking Issue, and Mobile Releases, whose `mobile-v*` workflow does not run this step yet.

## Considered Options

- **An admin marks each report by hand after a Release.** Rejected as the default because it depends on someone remembering, and a forgotten report never gets its Fix Notice. It remains as the override.
- **Mark Fixed when the fixing pull request merges.** Rejected: a merge is not a Release, so the reporter would be told something was fixed while the live app still had the bug.
- **Link reports to pull requests instead of issues.** Rejected: a fix may take several pull requests, and one issue gathers duplicate reports where a pull request cannot.

## Consequences

- Production deploys gain a step that writes to the backend. If it fails, the Release stays live and the reports stay Planned, so the step is safe to re-run for the same tag.
- A Fix Notice is sent at most once per report. It is claimed in a per-report ledger before anything reaches SMTP, the same trade the Weekly Digest makes ([ADR 0016](0016-digest-period-claimed-before-smtp.md)). A notice that fails after its report is marked is not sent again: a re-run marks only Planned reports, and the ledger already holds that report's row. Losing one notice is the deliberate price of never mailing a reporter twice; the outcome still shows on their Your reports page, and the deploy reports the failure as `fixNoticesFailed`.
- An issue closed by mistake in a Release range marks its reports Fixed. Reopening the issue does not undo that; an admin corrects the report by hand.
