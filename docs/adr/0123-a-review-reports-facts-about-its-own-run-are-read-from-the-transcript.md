# A review report's facts about its own run are read from the transcript

## Status

accepted

## Context

CI review run [37576528356](https://github.com/mnaimfaizy/myorganiser/actions/runs/37576528356)
(pull request #1030, 2026-10-07) published "No findings" on the Standards axis and listed four
`standardsSources`. Its transcript shows the Standards sub-agent made two tool calls and opened none
of the four. It had run `ls` on two of them. Its reply said in prose that it had not opened
`CODING_STANDARDS.md`, and listed the files in its JSON anyway. The main agent copied the list into
the report, because the skill told it to use the sub-agent's list and not recompute it (issue
#1031).

The same transcript shows the main agent doing more than assembling:

- It dispatched 22 of the Standards catalogue's 37 rule ids. The 15 it dropped include every
  `obligation-*` id, `standard-secret-committed`, and `standard-vault-plaintext-leaves-the-client`.
- It added "Only report real defects; empty findings is fine" to both dispatches. Neither sentence
  is in the skill.
- Its shortened contract dropped the `confidence` enum. A sub-agent returned `0.6`, and the main
  agent rewrote it to `"medium"`.
- It re-read the one finding's file and decided the severity should stand.

The report also carried `durationMs: 20000` for a session the harness timed at 39,859 ms, and an
`executed` list holding prose in place of commands. `tools/scripts/review/schema.ts` checks the
shape of all of these fields and the truth of none.

[ADR 0071](0071-a-finding-blocks-only-on-evidence-and-a-verdict-is-computed-never-written.md)
already settled this for the verdict: it is computed, and no model writes it. Everything else the
report says about its own run was still written by the model being described.

## Decision

**In CI, what a review report says about its own run is read from the reviewer transcript after the
reviewer has exited. The reviewer does not write it.**

1. **Four envelope fields are pinned.** A step reads the transcript and writes a facts file. The
   validator takes that file the way it takes `--tier`, and overwrites `standardsSources`,
   `executed`, `durationMs`, and `model` from it. A fifth, `cost`, joined them in issue #1057; see
   Consequences. The CLI version is recorded beside the model. The
   report schema version stays at 4. This ADR first said 5. The version exists to say whether
   finding ids are comparable between runs, and this decision does not change a finding's identity,
   so the new fields are optional additions and a report written before them still lends its ids. This
   reverses what the ADR said, and it is made here and not in a superseding ADR for one reason:
   nothing was ever built or run at version 5, so there is no decision in force to supersede, only
   a sentence that was wrong before anyone acted on it.
2. **A Standards Source is listed when the Standards sub-agent opened it.** Opened means a tool call
   that returns a file's content by path: the Read tool at any range, `cat`, or
   `git show <sha>:<path>`. A search is not an open. A file qualifies when it is
   `CODING_STANDARDS.md`, a path that index links to, or an `AGENTS.md` at any depth.
   `docs/review/REVIEW_CHECKLIST.md` is excluded by name. Root `AGENTS.md` and `CLAUDE.md` are loaded
   by the harness without being opened. The published comment says so in a fixed note and does not
   list them.
3. **An interactive run has no transcript to read.** Its fields stay self-reported, and the report
   marks them as such.
4. **Two transcript facts fail `Agent Review Ran`.** No sub-agent read the brief of an axis that was
   meant to run: the Standards axis always, the Spec axis only when the spec is not `none`. Or a
   finding in the report is not equal, field for field, to a finding a sub-agent returned. Both are
   facts about the pipeline
   ([ADR 0073](0073-a-required-check-is-a-fact-about-the-pipeline-not-a-judgment-about-the-diff.md)):
   the axis did not run as built, or the main agent authored a finding. Dropping a Standards finding
   under the one-axis-per-defect rule is not a change. One kind of finding has no sub-agent origin
   and is not a failure: a finding the main agent raised from an obligation answer, carrying that
   obligation's mirrored rule id at a site the worklist names. The worklist and the report are both
   files, so this stays a fact the pipeline can read
   ([ADR 0078](0078-a-citation-that-does-not-match-its-source-is-a-fact-about-the-pipeline.md)). This
   exception was added to the ADR after it merged and before anything implemented it. It corrects
   an oversight in how the rule was first written and reverses nothing, so it is made here and not
   in a superseding ADR. A run that fails this way is published all the same, with the failure
   stated in the comment, and its effective tier is `review:human`: a review that did not run as
   built vouches for nothing
   ([ADR 0070](0070-a-review-tier-is-a-fact-about-the-diff-and-a-gate-tier-is-a-decision-about-the-work.md)
   item 5).
5. **Three transcript facts tighten the effective tier and are published.** The Standards sub-agent
   read its brief but never opened `CODING_STANDARDS.md`. A dispatch carried text beyond the skill's
   fixed template. Or the transcript's shape could not be read. Together they cost at most one tier
   step, on top of the separate step a missing spec already costs. The implementation names the
   third in two parts, an unreadable transcript and an unparseable sub-agent reply, so the comment
   can say which happened. They are one fact here and on a golden replay's result line. A dispatch
   that reads neither brief and names neither is off the template too: the skill has no template
   for it. What it returned still counts as returned, so without this the main agent could hand
   its own finding to a third sub-agent on a run that reads as fully on template.
6. **"Cannot tell" is its own answer.** The step asserts the transcript's shape before reading facts
   from it. A transcript that fails is recorded as unknown, never as an empty list and never as the
   model's own claim. The step raises an error annotation naming the CLI version. A sub-agent reply
   the step cannot parse is unknown in the same way. A reply is unparseable only when no list of
   findings can be read out of it. One that wrapped its JSON in a code fence, or added a sentence
   after it, broke its brief and still says plainly what it returned, so it is read.
7. **The golden replay follows production.** Whatever fails `Agent Review Ran` in production voids a
   replay, with two new reasons, `brief-not-read` and `finding-not-returned`
   ([ADR 0101](0101-a-replay-whose-answer-sheet-fails-its-check-measured-nothing.md)). Whatever only
   tightens the tier is scored, and the fact is recorded on the result line.

## Considered Options

**Check the reviewer's list against the transcript and fail on a mismatch.** This was the issue's
own proposal, after
[ADR 0078](0078-a-citation-that-does-not-match-its-source-is-a-fact-about-the-pipeline.md). It was
rejected because the model stays the author of the fact. A reviewer that reads nothing and lists
nothing passes, so the less honest list is the one that fails. And the check would fail on pull
requests whose diff is fine, at whatever rate the model mislists.

**Fail `Agent Review Ran` when `CODING_STANDARDS.md` is not opened.** Rejected. Thoroughness is not a
gate (ADR 0078). The run above skipped the index and still found a real gap on the Spec axis. A red
check there would give the author nothing to do but re-run. A tightened tier and a published line
tell a human the review was thin, which is what happened.

**A threshold on how many sources were opened.** Rejected. Any number would be invented, and a diff
touching one area needs only the index and one Agent Guide.

**Pin the Claude Code CLI version so the transcript's shape cannot move.** Left out. The shape check
in item 6 turns drift into a visible event with the version attached. A pin trades that for a
version nobody remembers to raise.

## Consequences

When this ADR was written, nothing in the tree did any of this: the skill copied the sub-agent's
list into the envelope. Issue #1031 carries the implementation as three pull requests. The first
moved the briefs into files and fixed the dispatch template. The second reads the run facts from the
transcript and publishes them, enforcing nothing. The third enforces items 4, 5 and 7: it fails the
check, tightens the tier, and voids a replay. The issue also holds the parts of the design this
ADR leaves out as ordinary implementation: where the briefs live, how the command rules are worded,
and what the briefs say about the always-on agent policy.

A required-eligible check now depends on the transcript format of a CLI this repository does not
version. Item 6 is what keeps a format change from reading as "no sub-agent read its brief" on every
pull request. The contract tests need fixtures cut from real transcripts. The four fixtures the
classifier had before this decision hold no sub-agent events.

A golden replay that misses because the reviewer skipped the index is a miss. Voiding it would hide
the regression this decision exists to show. The result line records the skip, so the results file
can say whether a miss came from a thin review without anyone downloading a transcript.

The note in item 2 is a claim about the harness. It was confirmed once, in an interactive session
on 2026-10-08: a `general-purpose` sub-agent told to call no tool quoted two lines of root
`AGENTS.md` correctly. It was confirmed in CI the same day, in run 37727869175 on pull request
#1065 (issue #1056), with Claude Code CLI 2.1.293 and `claude-sonnet-5-5`. The session was started
by `anthropics/claude-code-action@v1` and granted the Agent tool alone. Its one `general-purpose`
sub-agent made no tool call and quoted the sentence under `## Scope` and the first bullet under
`## Do Not` of root `AGENTS.md`, and the paragraph under `# Claude Code` of root `CLAUDE.md`, word
for word. The dispatch message carried none of that text. That is one run on one CLI version: a
release that stops loading the files into sub-agents makes the note false, and the brief then has
to tell the sub-agent to open them.

The envelope's optional `cost`, its input and output token counts, was left self-reported by item 1
and is read from the transcript since issue #1057. The figures are summed over every model the
`result` event lists under `modelUsage`, because the event's top-level `usage` counts the main
agent's turns alone and most of a review is spent in its sub-agents. Input counts fresh, cache-read,
and cache-written tokens together. A `result` event that lacks a figure for any model records the
cost as unknown, never as zero and never as what the reviewer wrote.

A finding's own executed evidence, its command and exit code, was left self-reported by this
decision. Since issue #1039 it is compared with the transcript, under
[ADR 0126](0126-a-findings-executed-evidence-is-compared-with-the-transcript.md).
