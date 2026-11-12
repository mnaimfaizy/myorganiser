# A docs-only change for a non-documentation issue is its design record, not its implementation

## Status

accepted

## Context

The Spec axis of `/code-review` judges a diff against the issue that asked for it
([ADR 0071](0071-a-finding-blocks-only-on-evidence-and-a-verdict-is-computed-never-written.md)).
`tools/scripts/review/resolve-spec.ts` finds that issue from the branch name first, then from commits
([ADR 0076](0076-an-agent-branch-carries-its-issue-in-its-first-commit.md),
[ADR 0125](0125-a-change-answers-to-every-issue-its-commits-close.md)), and since
[ADR 0137](0137-an-issue-is-specified-by-its-body-and-its-trusted-triage-brief.md) hands the
Spec axis the issue's triage brief as well.

Pull request #1475 recorded ADR 0143 for #1405 on a `docs/` branch whose name began with the issue number 1405.
The branch name matched, so the review resolved #1405 and judged a docs-only design record against
#1405's implementation brief, reporting every requirement as not implemented. Reordering how `Refs`
is honoured would not have helped: the branch name is matched before any commit is read. The resolver
had no way to say "this change is a design record for that issue".

## Decision

1. **The kind-mismatch rule.** After an issue is found, by branch or by commits, the spec resolves
   `none` when all three hold:
   1. the head branch's type is `docs/`;
   2. every file the change touches is documentation: under `docs/`, or `CONTEXT.md`;
   3. the found issue carries a kind Surface Label whose branch type is not `docs/` — `bug`,
      `security`, `enhancement`, `tooling`, `maintenance` or `dependencies` — read through the
      AGENTS.md branch-type table top to bottom, first match winning.

   An issue with no kind label, or labelled `documentation` or `research`, keeps its spec. If any
   condition fails, resolution is exactly as before, and `also` is untouched whenever a spec resolves.

2. **Every input is a fact.** The branch name, the diff and the issue's labels, which only maintainers
   set. Nothing the author writes switches the rule on.

3. **The `none` says why.** The spec gains `designRecordFor` (the issue found) and `reason`, rather
   than overloading `ref`, so a `none` stays "no ref, found by nobody" for every existing consumer.
   The report line reads `none (design record for #N, not its implementation)`. The Spec sub-agent is
   skipped and the tier steps down, as for any `none` spec.

4. **Unreadable labels never guess `none`.** If the labels cannot be read, the issue stays the spec.

5. The rule is a pure function, `applyDesignRecordRule`, run after discovery; the changed files and
   labels come in as inputs.

## Rejected alternatives

- **An author-written opt-out, such as a `Spec: none` trailer.** The author would decide whether its
  own change is judged, and an AFK agent could write it to skip the Spec axis. It is the trust
  problem that keeps the pull request body out of the spec sources (ADR 0076).
- **Every `docs/` branch with a docs-only diff resolves no spec.** A real `documentation` or
  `research` issue is implemented by exactly that: a docs-only change on a `docs/` branch. Skipping
  its spec would silently drop the axis where it is most useful.

## Consequences

- A design-record pull request is reviewed on Standards alone, one tier higher, and the report names
  the issue it is the record for.
- A maintainer who labels an issue `documentation` to get its docs reviewed against it gets that.
- `REPORT_SCHEMA_VERSION` is unchanged: the new fields are optional provenance like `also`.
- Out of scope: any other change to discovery order, `Refs` handling or `also`.
