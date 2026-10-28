# An issue is specified by its body and its trusted triage brief

## Status

accepted

## Context

Triage posts what it decided about an issue as a comment headed `## Agent Brief`: the agreed scope,
the choices made in grilling, acceptance criteria, and what is out of scope. The issue's body stays
the reporter's text, which is often an early idea that triage then narrowed or redirected.

Two readers act on an issue, and neither saw that comment:

- `dispatch-agents` built an AFK agent's prompt from the issue **body**, plus only the comments
  headed `## Maintainer Review`. An agent dispatched on a triaged issue worked from the report and
  never saw what triage decided.
- The CI code review's spec resolver (`tools/scripts/review/resolve-spec.ts`) fetched
  `title,body,state` and nothing else. It has done that since the review was introduced in #682. So
  the Spec axis judged the diff against the report too, and would flag work that followed the brief
  as "not asked for".

Forty-nine triaged issues carried briefs that neither reader would ever see. Reading comments raises a
second problem: the repository is public. Anyone can comment, and a comment that reaches an AFK
agent's prompt is an instruction the agent is told to treat as binding. The existing
`## Maintainer Review` reader accepted a comment from any author.

## Decision

1. **An issue's spec is its body, its latest trusted triage brief, and its trusted maintainer
   notes.** The brief is the text below the last comment whose `## Agent Brief` heading stands on a
   line of its own. Where the brief and the body disagree, the brief wins. A `## Maintainer Review`
   note is later still, and wins over both.
2. **Only the repository's owner, members, and collaborators can amend a spec.** This is GitHub's
   `authorAssociation` of `OWNER`, `MEMBER`, or `COLLABORATOR`. A comment from anyone else, or one
   that does not say who wrote it, is ignored by both readers, and that applies to maintainer notes
   too.
3. **One rule, two readers.** `tools/scripts/lib/issue-comments.ts` decides what counts.
   `dispatch-agents` appends the brief to the prompt after the body and before the notes.
   `review:spec` writes it to `spec.json` as `brief` and the notes as `notes`, beside each issue's
   `body`. A field with nothing in it is left out, so an untriaged issue resolves exactly as it did
   before.
4. **A re-triage posts a complete brief.** Only the latest counts, so a brief written as a diff
   against an earlier one loses that earlier one.
5. **The pull request body is still not a spec source** (ADR 0076). The brief is written before the
   work, by triage. A pull request body is written after it, by the author.

## Considered Options

- **Move the brief into the issue body.** This needed no code, but it overwrites or buries the
  reporter's text, and a re-triage would have to rewrite the body again. A comment keeps the history,
  and the readers take the latest one.
- **Read every comment.** This would replay the orchestrator's own status comments and anyone's
  instructions into the prompt. It was rejected for the reason the `## Maintainer Review` marker
  exists, and for the public-repository reason above.

## Consequences

- A triaged issue is dispatchable on its brief, and the Spec axis reviews against the same contract
  the agent built to. The `my-triage` Skill writes briefs in the form this ADR reads.
- A maintainer note from an untrusted commenter no longer reaches an agent. On this repository's
  existing issues nothing is lost, because every note and brief was written by its owner.
- The dependency edges `## Blocked by` and `## Blocks` stay in the issue body (ADR 0002). Only the
  brief is read from comments.
