# A public tree hides an operator, not a product

MyOrganiser has one git tree, and it is public. An **Operator Fingerprint** does not enter it. A **Product Surface** may, because hiding one hides nothing from anyone who can use the app.

## Status

accepted

## Context

Issue #563 was taken out of the #437 grilling: the operator asked whether a private fork could hide production-related content — production web and mobile specifics — while the public repository stayed the shared core. [ADR 0056](0056-ci-owns-host-apply-without-describing-the-jail.md) had already refused a private duplicate as the home of Host Apply, and recorded that a second codebase is a product split needing its own grill. This is that grill.

Grilled 2026-09-16. Four answers decided it before any option was priced.

**The content is operator fingerprints** — host, paths, account names, deploy topology — not features and not credentials. That is the one category ADR 0056 already handles: connection values and on-host pins live in GitHub Environment secrets, and public workflows carry the algorithm and secret names only. The discipline is holding where it was written: `docs/deployment/HOST_APPLY_OPERATOR_SETUP.md` uses `<port> <user>@<host>` throughout, and `tools/scripts/check-host-apply-workflow.ts` gates the two deploy workflows against secret-name drift.

**There is one app and one audience.** Both open-core shapes #563 listed — shared public libraries with private application packages, and a true product split — exist to serve a second audience. Paying their cost with one audience is overhead and nothing else. No `.gitmodules`, no publishable Nx project, and no private registry exists today, so neither is a rearrangement of what is here; both are a package-publishing pipeline that would have to be built.

**Feature flags answer a different question.** A flag hides a feature. The content named is a fingerprint, and the code carrying a fingerprint stays public whether or not a flag guards the behaviour around it.

**Product identity is already public, and has been since `d91ad6a` (2026-01-06).** `myorganiser.app` sits in `apps/backend/src/config/http.ts`, `apps/web/src/app/layout.tsx`, `README.md`, and the deployment docs, across five commits of public history. Moving those strings to environment variables today changes nothing a clone can learn: `git log -S` recovers them in one command. Only a history rewrite would, on a public repository that others may already have cloned.

One genuine fingerprint was found in source: an API hostname under the operator's personal domain, in `apps/backend/src/config/http.ts` and three times in `apps/backend/src/main.test.ts`. It is not a product URL. It ties MyOrganiser's API host to the operator's other web presence, which is the category the issue was about. **This document does not spell the value out** — by its own reasoning below, an artifact that names a forbidden value publishes it, and that reasoning does not stop applying because the artifact is an ADR. The file and line are enough to act on; #806 carries the removal.

The adversaries named — a casual cloner, an attacker, a competitor, and plain discomfort — collapse under the answers above. A cloner and a competitor presuppose the second audience that does not exist. An attacker is the case ADR 0056 already adjudicated: a private tree defeats one only until a single clone leaks, where a secret store defeats one structurally.

## Decision

- **MyOrganiser has one tree.** No private fork, mirror, operator-notes companion, or private application package. A private companion was considered separately and refused: everything a runbook needs is either a placeholder, which is public and useful, or a secret, which belongs in a secret store.
- **The boundary is Product Surface versus Operator Fingerprint**, defined in [`CONTEXT.md`](../../CONTEXT.md) § Release & Deploy. A Fingerprint does not enter the tracked tree.
- **The hosting provider's name is an accepted exception.** `docs/deployment/CPANEL_*.md` name cPanel and Namecheap, and a runbook a human must follow on that provider's dashboard is useless without them. This is the trade ADR 0056 already made for shared-account blast radius: discipline, not isolation.
- **An Operator Fingerprint is not a secret.** A secret is defeated by a secret store; a Fingerprint is defeated only by not writing it down. Do not reach for a private tree on the belief that it is the second kind of secret store — it is not a secret store at all.
- **A bundle identifier is a Product Surface.** `app.myorganiser` is adopted for the Android `applicationId` and `namespace` and the iOS `PRODUCT_BUNDLE_IDENTIFIER`. Nothing is registered with either store yet, so the convention choice is free today and only gets more expensive as the stubs propagate. The signing keystore and the store service credentials are secrets and never enter git.
- **Product identity is not recovered and history is not rewritten.** Writing this down is load-bearing: without it the split is re-proposed on grounds this grill already eliminated.
- **The fingerprint in `DEFAULT_CORS_ORIGINS` is to leave the source** — replaced by the per-environment `CORS_ORIGINS` that `.env.example` and `docs/deployment/CPANEL_BACKEND_HOSTING.md` already declare. **This has not happened yet**: it is tracked as #806 and blocked on an operator prerequisite, and at the time this ADR was accepted the value was still in `apps/backend/src/config/http.ts` and `apps/backend/src/main.test.ts`. The value of that edit is stopping accretion, not erasing the past.
- **Enforcement is the rule catalogue, not a checker.** `tools/config/review-rules.json` carries `standard-operator-fingerprint-in-source` citing this ADR, and [the code-review skill](../../.agents/skills/code-review/SKILL.md) offers the id in its Standards brief. What that asserts is narrower than this ADR decides: a reviewer may raise a fingerprint it notices in a diff, and nothing blocks on it. No gate proves the tree is free of fingerprints.

## Considered Options

- **Private companion holding operator notes only** — rejected. ADR 0056 already refused a private tree as a secret store, and a notes repository inherits that flaw while adding a second place to look and a second thing to drift. Nothing concrete was named that is neither a placeholder nor a secret.
- **Shared public libraries with private application packages** — rejected. Open-core serves two audiences; there is one.
- **True product split, two apps over a shared core** — rejected for the same reason, at higher cost, and it would need new `CONTEXT.md` terms for a product that does not exist.
- **Feature flags or env-gated surfaces** — rejected as an answer to _this_ content. They hide behaviour, not fingerprints. Nothing here argues against using them for their own purpose.
- **Making the repository private** — considered and refused because public is a goal, not an accident of how the repository started.
- **Rewriting history to remove the product domain** — rejected. It does not restore secrecy on a repository others may have cloned, and it invalidates every published SHA.
- **A denylist checker naming forbidden fingerprints** — rejected on its face. A file that names a value as forbidden publishes, in a public repository, the exact value it protects. This applies to any tracked artifact, this ADR included, which is why the fingerprint above is described rather than quoted.
- **An allowlist checker over hostname literals** — rejected on signal. Scoped to non-test `apps/**` and `libs/**` there are 36 distinct hostnames, of which roughly 30 are documentation links in comments and third-party APIs. An allowlist that is 85% noise asserts nothing, which is the failure [ADR 0085](0085-an-artifact-states-no-claim-it-does-not-assert.md) names. A narrower positional variant — a hostname literal is a finding only in a runtime configuration position — was drafted and set aside as not worth the maintenance against one known occurrence.

## Consequences

- Removing the `DEFAULT_CORS_ORIGINS` literals has an **operator prerequisite**: those literals are a fallback, so an environment riding the fallback rather than setting `CORS_ORIGINS` loses CORS on the next restart. A CORS failure appears in a browser console, not in a red deploy. Confirm the variable is set per environment before the edit lands.
- The mobile identity change is larger than two lines. Android's `namespace` drags `MainActivity.kt` and `MainApplication.kt` into a new package directory, and iOS currently ships `org.reactjs.native.example.$(PRODUCT_NAME:rfc1034identifier)` — React's own reverse domain, not a placeholder of ours, and not submittable.
- `standard-operator-fingerprint-in-source` sits next to the existing `standard-secret-committed` in the catalogue. They are deliberately distinct: conflating them is what produced #563. It also adds one rule to the budget [ADR 0079](0079-an-effective-false-positive-is-a-finding-nobody-acted-on.md) measures at 10% per rule.
- No gate asserts that the tree is free of Operator Fingerprints. This ADR states that plainly rather than implying coverage it does not have.
- Vocabulary: [`CONTEXT.md`](../../CONTEXT.md) § Release & Deploy (Product Surface, Operator Fingerprint).
