# A finding's executed evidence is compared with the transcript

## Status

accepted

## Context

A code review Finding may carry `evidence.kind: "executed"`: a `command`, an `exitCode`, and an
`outputExcerpt`. Under
[ADR 0071](0071-a-finding-blocks-only-on-evidence-and-a-verdict-is-computed-never-written.md) that
is one of the two kinds of evidence that can make a Finding Blocking.

All three fields are written by the model that claims to have run the command.
`tools/scripts/review/schema.ts` checks their shape. Nothing checked that the command was run, so a
Finding could name a command and an exit code that never happened and still earn Blocking.

[ADR 0123](0123-a-review-reports-facts-about-its-own-run-are-read-from-the-transcript.md) took the
report's envelope out of the model's hands: in CI, `standardsSources`, `executed`, `durationMs`,
`model`, and `cost` are read from the reviewer transcript and overwrite what the reviewer wrote. It
left a Finding's own executed evidence self-reported, because that needs two things the envelope did
not (issue #1039).

The first is a matching rule. An envelope list is replaced, so nothing is compared. A Finding's
command has to be compared with the calls the transcript shows, and a model quoting a command it
ran rarely quotes it byte for byte.

The second is a consequence that is not an overwrite. A report is accepted whole or rejected whole
(ADR 0071), and a Finding in the report must equal the one a sub-agent returned (ADR 0123 item 4).
The check cannot correct a Finding's evidence or lower its severity.

## Decision

**In CI, a Finding's executed evidence is compared with the Bash calls in the reviewer transcript,
and evidence the transcript does not bear out fails `Agent Review Ran`.**

1. **The transcript reader records every Bash call**, with the exit code its result carries and
   whether the main agent or a sub-agent made it. An exit code is read only from a result the Claude
   Code CLI marked as an error and opened with `Exit code <n>`. A result that is not an error is
   exit 0. A call with no result in the transcript, an error that names no code (a timeout), and a
   backgrounded call have no code. A call the result event lists under `permission_denials` was
   refused by the harness and is not recorded: it did not run.
2. **The command is compared on what ran, not on how it was typed.** Evidence matches a call when
   every simple command it quotes is one the call ran, adjacent and in the call's order, after four
   allowances: whitespace between words, quoting that leaves the same words, being one part or
   several adjacent parts of a call chained with `&&`, `||`, `;`, `|`, or a newline, and unquoted
   redirections with a trailing `&`. A call holding a here-document matches whole or not at all,
   because its body reads as commands and is text. Nothing else is allowed: `yarn nx test backend` is not `corepack yarn nx test backend`, and an
   added flag is a different command. The rule is written out in full where the check lives,
   `tools/scripts/review/executed-evidence.ts`, and that file is the authority on it.
3. **The exit code is compared only where the transcript carries one for what was quoted.** The
   transcript holds one code per call. Evidence that quotes the whole call is compared with it.
   Evidence that quotes one part of a chained call has no code of its own there, and is not
   compared. A command run more than once matches if any run agrees.
4. **A sub-agent's Finding is held to the commands sub-agents ran.** An obligation Finding is the
   main agent's own (ADR 0123 item 4), so the command behind it may be the main agent's too.
5. **A mismatch is a third fact that fails `Agent Review Ran`**, with the reason
   `evidence-not-executed`. It is a comparison between two artifacts, the report and the transcript,
   and says the reviewer's own evidence does not hold up. That is a fact about the pipeline
   ([ADR 0073](0073-a-required-check-is-a-fact-about-the-pipeline-not-a-judgment-about-the-diff.md)),
   in the same family as a citation that does not match its source
   ([ADR 0078](0078-a-citation-that-does-not-match-its-source-is-a-fact-about-the-pipeline.md)). It
   is not a Finding, and no Finding is edited, dropped, or downgraded. The report is published
   whole with the failure stated in the comment, and its effective tier is `review:human`, as for
   the other two failures.
6. **"Cannot tell" fails nothing.** An unreadable transcript, a facts file that predates the
   recorded calls, a call with no exit code, and a part of a chained call are all not compared.
7. **The golden replay follows production.** `evidence-not-executed` voids a replay, as ADR 0123
   item 7 says of whatever fails `Agent Review Ran`.
8. **An interactive run has no transcript.** Its executed evidence stays self-reported.

## Considered Options

**Tighten the tier and fail nothing.** ADR 0123 does this for a skipped standards index, because
thoroughness is not a gate. Rejected here. A skipped index is a thin review. Evidence for a command
nobody ran is a false statement in the report, and it is the statement that earns Blocking. One
tier step would leave a `review:auto` change with fabricated evidence at `review:agent`.

**Rewrite the Finding's evidence to `inferred`, or cap its severity.** Rejected. A report is
accepted or rejected whole, and a Finding the pipeline rewrote is one no sub-agent returned.

**Reject the report.** Rejected. A rejected report publishes nothing, and the other findings in it
are still worth reading. ADR 0123 publishes a failed run for the same reason.

**Match the command byte for byte.** Rejected. The check would fail on a stray space or a `2>&1`,
on pull requests whose diff is fine, and a red check that means nothing gets re-run, not read.

**Match on the program and its first arguments.** Rejected. `yarn nx test backend` would stand as
evidence for `yarn nx test web-vault`. Every word is compared.

## Consequences

A required-eligible check can now fail because a model misquoted its own command in a way the four
allowances do not cover. The briefs tell the sub-agents that the command and exit code are compared,
and to write the command as run. If a kind of near-miss turns up in real runs, the allowance is
added to `executed-evidence.ts` with a test, and this ADR does not change.

The exit code of one part of a chained call is not compared, and `cd dir && cmd` and `cmd | tail`
are the commonest shapes a call takes. A Finding that quotes `cmd` from either can still state an
exit code the command did not return. Closing that needs a rule for what a chain's one code says
about each part, which is left until real transcripts show how often it matters.

`outputExcerpt` and `cwd` are not compared. An excerpt is a model's selection from output, and
matching it would need a rule for elision that nothing yet justifies. So a Finding can still quote
output a real command did not print. What is bought is narrower: the command ran, and where the
transcript can say so, it exited the way the Finding claims.

How a Bash result carries its exit code is a property of the Claude Code CLI, like the rest of the
transcript's shape. The transcript fixtures under `tools/scripts/review/fixtures/transcripts` were
cut before this decision and hold no sub-agent tool results, so the tests add that one event to a
real transcript. The first CI transcript in which a sub-agent's command fails should be cut into a
fixture. Until then a CLI release that words the result differently reads as "no exit code", which
compares nothing and fails nothing.
