# An ADR is authored `accepted`

## Status

accepted

## Context

[ADR 0042](0042-adr-numbers-are-claims-until-merged.md) settled that an ADR's
number is a claim while its pull request is open and a fact once it merges.
`AGENTS.md` extended the same line to the status: an ADR was to be `proposed`
while open and `accepted` once merged, "so flip it in the pull request that
lands it".

That sentence was itself written after four ADRs sat `proposed` on `main` with
nobody noticing. On 2026-09-22 a sweep found five more in exactly the same
state — 0090, 0092, 0093, 0094 and 0095 — every one of them merged, every one
still claiming to be under discussion. Nine ADRs across two occurrences, the
second occurring entirely under a rule written to prevent the first.

[ADR 0085](0085-an-artifact-states-no-claim-it-does-not-assert.md) already names
this shape and names it about this repo's own conventions: ADR 0043 contained
the clause "the direction is recorded in the checker's header", five of
thirty-five checkers followed it, and the checker that followed it best was one
of the six that got it wrong. A rule that lives only in a sentence is an
Unasserted Claim. The status rule is the same rule twice: written down, obeyed
by most, and silently broken by the cases nobody looked at.

The obvious remedy — assert that an ADR merged on `main` does not say
`proposed` — cannot be written honestly. On a `pull_request`, CI checks out
`refs/pull/N/merge`. That vantage point is what makes
`check-adr-numbering.ts` true, because a duplicate number is visible as a
duplicate in the merged tree. It does the opposite here: in that same tree an
ADR the pull request is _adding_ is indistinguishable by content from one that
merged a month ago. Telling them apart requires git, and the resulting check
fires one pull request late, failing an author over a file they never touched.

The corpus also turns out to carry three status shapes, not one: 76 ADRs use a
`## Status` section, six use YAML frontmatter `status:` (0005-0008, 0011, 0089),
and 13 carry no status at all. The authoring template,
`.agents/skills/domain-modeling/ADR-FORMAT.md`, documents the frontmatter form,
marks Status optional, and lists `proposed` first in its vocabulary. The rule
and the template disagreed, and the template is what authors read.

## Decision

**An ADR is authored `accepted`. `proposed` is not a status this repo uses.**

The parallel to ADR 0042 is exact, and running it to its conclusion is what
resolves the problem rather than restating it. Nobody writes the _number_
differently while the pull request is open — the ADR claims `0097` from the
first commit, and merging is what converts the claim to a fact. The status
works the same way. The document records the decision the pull request is
asking for; the merge is what makes it binding. Nothing about that needs a
second word, and a second word is a second step.

`proposed` therefore has no correct moment, and the assertion collapses to a
directory listing: **no ADR's status slot reads `proposed`**, in either form
the corpus uses. `tools/scripts/check-adr-status.ts` asserts it, wired into
the `gates:run` aggregate, with a contract suite as ADR 0085 requires.

Reading both forms is load-bearing rather than thorough: a checker that knew
only the `## Status` section would pass a frontmatter `status: proposed` by not
looking at it, and six ADRs use that form.

The checker reads the status _slot_, never the file. Every ADR with a
Considered Options section discusses proposals; this one uses the word four
times outside its status.

## Considered Options

**Assert that an ADR present at the merge base does not say `proposed`** —
rejected on the vantage point, above. It also needs a shrink-only baseline for
the 13 status-less ADRs on day one, and it fires on the pull request after the
one that caused the drift. It detects the state instead of removing it, which
is strictly more machinery for a strictly weaker result.

**A scheduled sweep of `main` that opens an issue** — rejected. It blames
nobody, which is its appeal, but it is not a gate: it would need a written
reason in `gate-coverage-optout.json` and it cannot stop the drift, only
report it after the fact, for the third time.

**Keep the sentence and try harder** — rejected on evidence. This is the second
occurrence, and the second occurred under the sentence. ADR 0043's reasoning
about its own header clause applies: a claim nothing asserts is a claim that
rots.

**Require every ADR to carry a status** — rejected, and deliberately not
bundled. 13 ADRs carry none because the template marks Status optional and an
ADR may legitimately be one paragraph. Nothing has ever broken because an ADR
stayed silent. Requiring one is a decision about the ADR _format_, not about
this drift, and folding it in would make a 13-file migration the price of
closing a two-occurrence bug.

## Consequences

**This gate cannot catch the drift that motivated it, and must not be described
as if it could.** Those nine ADRs said `proposed` correctly under the rule in
force when they were written. The gate prevents the next occurrence by
abolishing the state, not by detecting a stale one. A reader who expects it to
find stale statuses will conclude it is broken.

The rule now lives in two places that must agree: the `AGENTS.md` sentence and
`ADR-FORMAT.md`'s vocabulary line. The template was the more load-bearing of
the two all along and was never updated when the original sentence was written,
which is part of why the sentence did not hold.

**An ADR whose decision is genuinely unsettled has nowhere to say so, and that
is intended.** A decision still being argued belongs in the pull request, in an
issue, or in a grilling session — not on `main` wearing a status that says it
is undecided. If a future need for a real `proposed` state emerges, it arrives
with a mechanism for leaving it, or it repeats this ADR.

`deprecated` and `superseded by ADR-NNNN` are untouched and unasserted. Whether
a `superseded by` pointer names a real ADR is a claim about another decision's
state; the checker's header says it does not check that, per ADR 0085.

The 13 status-less ADRs stay status-less and stay unasserted. That is recorded
here as a known gap with a reason, not left as something nobody noticed.

Landing this requires the five `proposed` ADRs on `main` to be flipped first,
or the gate fails on its own introduction.
