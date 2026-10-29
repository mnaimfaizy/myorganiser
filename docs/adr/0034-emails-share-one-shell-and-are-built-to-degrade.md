# Emails share one shell and are built to degrade

## Status

accepted

## Context

MyOrganiser sends three emails. Verification and password reset were unfilled boilerplate committed in June and never revisited: a logo referenced as `logo.png`, a relative path no mail client can resolve, a hardcoded `© 2023`, Bootstrap's default blue instead of a brand colour, and placeholder substitution by first-match string replacement. The YouTube Weekly Digest was built separately and inline, with its own inline styles and table layout, sharing no header, footer, or logo with the other two. None of the three sent a plain-text alternative.

Three emails had already produced two divergent styles, and the visible defects had survived three months in production.

## Decision

All MyOrganiser email renders inside one **Email Shell** that owns the logo, brand colours, typography, and footer. Each email supplies only its body and declares its class. The Weekly Digest migrates into the shell as part of this work rather than later.

The shell is **parameterised by email class, not uniform**. A Transactional Email must never carry an unsubscribe link — a User who opts out of password-reset mail can lock themselves out of their account — while a Notification Email must always carry one. Making the caller declare its class is what prevents the shell from ever putting an unsubscribe on mail a User cannot afford to lose.

The shell lives in a shared library rendering to an HTML string, consumed by the backend. It carries Storybook stories with fixture data.

The **CID linkage invariant belongs to the shell, not the sender**: a message's attachments and the body it ships with must describe the same set of Content-IDs. The shell returns its attachments alongside its HTML and asserts the two match on every render. The alternative — validating in the shared mail sender — was rejected because the sender is a pass-through that never sees how a body was built, so all it can check is that two things it was handed happen to agree; a caller that hands it a matched-but-wrong pair passes. The shell is the only place that knows what it just referenced.

Emails are built to **degrade into correct, not into broken**:

- The logo is a CID attachment, not a hosted URL.
- Layout is fluid — percentage widths inside a `max-width` container — with media queries only as progressive enhancement.
- Table-based layout with inline CSS, a plain-text alternative alongside the HTML, brand tokens rather than literal hex, escaping for every interpolated value, real alt text and semantic headings, and an explicit preheader.

## Considered Options

**A hosted URL for the logo** was rejected because it reproduces the reported bug everywhere except production. A developer or reviewer checking an email locally or on staging sees a broken image, which is exactly how a broken logo survived three months unnoticed. An email that only looks right in production cannot be verified before shipping. Remote images are also blocked by default in many clients and leak recipient IP and open time.

**Media queries as the primary responsive mechanism** were rejected. Gmail ignores them for mail delivered to non-Gmail addresses over IMAP and several clients strip or misapply them, so a layout that depends on one to be readable is broken in a large minority of inboxes. The cost of the fluid approach is that the shell is single-column throughout; a multi-column layout would require revisiting this.

**Dark-mode support** was rejected. Gmail and Outlook force their own colour inversion regardless of what the message specifies, and `prefers-color-scheme` is honoured by very few clients that matter. Chasing it yields fragile CSS fighting the client. Colours are chosen to survive inversion instead, and a single logo is used that reads on light and dark backgrounds rather than a light/dark pair.

**A skill, hook, or sub-agent monitoring pull requests that touch email templates** was requested in the originating issue and is deliberately rejected. It watches the wrong thing. These templates were broken on the day they were committed and no pull request touched them for three months, so such a monitor would never once have fired. The failure was invisibility, not careless edits — the emails could not be seen without sending them. Storybook stories address the actual cause and need no new machinery.

## Consequences

Stories render in a browser, which is not an email client. They will catch a missing logo or a wrong footer; they will never catch Outlook's Word rendering engine dropping a style. Testing against real clients remains a manual step before significant email changes.

Migrating the Weekly Digest is more than a wrapper swap. It emits thumbnails at fixed pixel widths inside an unconstrained table, which is the classic horizontal-scroll email on a narrow phone; its rows have to be made fluid.

Raster PNG logo assets must be produced and kept in sync with the SVG sources, because SVG does not render in Gmail, Outlook, or Yahoo. Adding CID attachments also requires attachment support in the shared mail sender, which today accepts only a recipient, subject, and HTML body.

The raster ships twice — as a `.png` for review and as a base64 TypeScript literal the shell attaches — so that rendering an email stays a pure function with no disk access. Resolving an asset path that differs between the TypeScript sources and the webpack bundle is the same dist-versus-dev candidate lookup that guarded the auth templates, and reintroducing it for the logo would trade one invisible failure for another.
