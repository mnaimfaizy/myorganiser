# A change answers to every issue its commits close

## Status

accepted

## Context

The Spec axis of `/code-review` checks a diff against the issue that asked for it
([ADR 0071](0071-a-finding-blocks-only-on-evidence-and-a-verdict-is-computed-never-written.md)).
`tools/scripts/review/resolve-spec.ts` finds that issue in a fixed order — the branch name
`<type>/<issue>-<slug>`, then the first issue reference in a commit
([ADR 0076](0076-an-agent-branch-carries-its-issue-in-its-first-commit.md)) — and stops at the first
one it finds.

A branch name holds one number. A pull request can close two issues.

Pull request #1104 did: branch `fix/1078-tasks-subscriptions-keyboard-focus`, one commit, `Closes
#1078` and `Closes #1079`. The review loaded #1078 from the branch name and never read the commit.
It then raised `spec-behaviour-not-asked-for`, `should-fix`, high confidence, against the half of the
diff #1079 asked for, quoting #1078's own scope line as the rule. The finding was correct against the
spec it was given and wrong about the change. The quieter half of the same defect is that nothing
checked that hunk against #1079 at all: a requirement #1079 stated and the diff missed would have
passed in silence.

So for any pull request that closes more than one issue, the axis produced one guaranteed false
finding and one guaranteed blind spot. Neither is noise a rule can be tuned out of
([ADR 0079](0079-an-effective-false-positive-is-a-finding-nobody-acted-on.md)); the reviewer was
handed half a spec.

Three things had to be decided: which further issues count, how they are carried, and what happens
when a reference is not an issue.

## Decision

1. **A change answers to every issue its commits close.** The discovery order is unchanged and still
   yields one issue, the `ref`. Every _other_ issue that a commit in `base..head` closes is spec as
   well, and is named in `spec.also`, in commit order, once each. A change that closes one issue
   resolves exactly as it did before, and carries no `also`.

2. **Only a closing keyword adds an issue**: `close`, `fix`, `resolve` and their inflections. The
   first reference found may still be `Refs #12` or `see #12`, as ADR 0076 leaves it, because a
   branch with nothing better is otherwise reviewed on one axis. A _further_ issue has no such
   excuse. `Closes #13` is the author stating that this change finishes #13, which is what makes
   #13's text a claim about this diff. `Refs #13` only points at it, and a spec assembled from
   everything a commit mentions would ask the diff for work it never set out to do — the opposite
   false finding, `spec-requirement-missing`, on every pull request that cites a sibling. One keyword
   closes one issue, as on GitHub: `Closes #12, #13` closes #12.

3. **The further issues ride beside the first, not inside it.** `spec.json` keeps `title` and `body`
   for the `ref`, and gains `also: [{ ref, title, body, state }]`. The envelope's `spec` gains the
   optional `also: ["#13"]`. Nothing that read one issue has to change to keep working, and the
   dispatch line still carries `ref` alone: the Spec sub-agent is told by its brief to read `also`
   from the file it already opens.

4. **`also` is provenance, and decides nothing.** It moves no tier, no verdict, and no finding's
   identity, so `REPORT_SCHEMA_VERSION` stays where it is: the version says whether a stored report's
   ids are comparable, and they are. What `also` buys is that the report line states what the axis
   was actually handed —
   `spec: issue #1078 (found by branch), also #1079 (closed by commits)` — instead of naming one
   issue over a review of two ([ADR 0085](0085-an-artifact-states-no-claim-it-does-not-assert.md)).

5. **A closing reference to a pull request is dropped.** `gh issue view` answers for a pull request
   number too, and a pull request body is its author's summary of the diff, which ADR 0076 item 7
   keeps out of the spec. The resolver tells the two apart by the URL it is given back, says so in
   the job log, and leaves the reference out of both `also` lists, so the envelope never names a spec
   the axis was not handed.

6. **A further issue that cannot be fetched stops the resolve**, exactly as the first one does. A
   mistyped number skipped in silence would put back the blind spot this decision removes, with a
   report that looks complete.

## Consequences

- A pull request that closes two issues is reviewed against both, and the false
  `spec-behaviour-not-asked-for` on the second issue's half is gone at its cause.

- **A PRD integration branch now carries its slices as spec.** ADR 0076 has `dispatch-agents` anchor
  the branch with `Closes #<prd>` and each slice agent end its commit with `Closes #<slice>`, so a
  PRD pull request resolves the PRD Issue and every Slice Issue merged into it. That is the rule
  applied, not an exception to it — the slices are the tracked statement of what each part must do —
  but it is more spec text per review than before, and it has not been observed on a real PRD run.
  If the volume turns out to cost more than it finds, the answer is a decision about that case, not a
  cap written here in advance of any evidence.

- The first reference is still not checked for being a pull request. A branch named for a pull
  request number, or a first commit that references one, resolves it as before. Item 5 closes the
  hole for further issues only; closing it for the first is a change to ADR 0076's order and was not
  needed here.

- The interactive path has no resolver: the main agent follows the skill's step 2 by hand, which now
  states the same rule. Nothing asserts that it does.

- **Observed.** `review:spec` run against #1104's own range resolved
  `#1078 (found by branch), also #1079`, with both bodies written. A single-issue branch resolved to
  the same four keys as before. Not yet observed: a CI review reading `also` and judging a diff
  against both issues.

## Alternatives considered

- **Every reference, not only closing ones.** Rejected in item 2: it trades one false finding for
  another, and the new one would fire far more often.

- **A list in place of `ref`.** `spec: { refs: [...] }` is the tidier shape and breaks every reader
  of `spec.ref` — the dispatch template and its checker, the renderer, the sandcastle anchor, the
  golden set's stored cases — to express a case most pull requests never reach.

- **Concatenate the bodies into one `body`.** No reader changes at all, and the reviewer can no
  longer say which issue a requirement came from, so `source` on a finding would name the first issue
  for text written in the second.

- **Require one pull request per issue.** It moves the cost onto every author to spare the resolver
  a loop, and two defects with one cause are routinely, and rightly, fixed together.
