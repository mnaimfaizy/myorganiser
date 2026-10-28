# A file grant is anchored where the session started

## Status

accepted

## Context

[ADR 0075](0075-a-reviewers-writable-surface-is-scoped-to-its-own-tmp-directory.md) scoped the
reviewer's writable surface to its own directory, and wrote the grant as
`Write(tmp/code-review/**)` and `Edit(tmp/code-review/**)`. Both halves of that spelling were wrong,
and neither was visible until a run moved.

Golden replay run 35716439899 replayed `export-envelope-drops-tasks`. Partway through, the reviewer
ran a Bash command that began `cd <workspace>/tmp/code-review/worktree && …`. The Bash tool keeps a
`cd` for the rest of the session. From then on every Write to
`<workspace>/tmp/code-review/report.json` and `…/obligations.answers.json` was refused — six
refusals, including a 14-byte probe file — with "Claude requested permissions to write to `<path>`,
but you haven't granted it yet". A sibling attempt in the same run, at the same commit, wrote the
same absolute paths without trouble; it never ran `cd`. The transcripts expired after seven days;
[issue #880](https://github.com/mnaimfaizy/myorganiser/issues/880) carries the timeline read from
them before they did.

Claude Code's permission rules explain both attempts
(<https://code.claude.com/docs/en/permissions#read-and-edit>):

- A path with no leading anchor is relative to the session's **current** directory. Once the session
  was in `tmp/code-review/worktree`, the grant covered `…/worktree/tmp/code-review/**`, and the real
  output paths fell outside it.
- A `/path` rule passed as a CLI flag anchors at the session's **primary working directory**, which
  a `cd` does not move.
- File permissions are checked against `Edit(path)` and `Read(path)` rules only. An `Edit` rule
  covers every built-in tool that edits files, Write included; a `Write(path)` rule is accepted and
  never consulted. The `Write(…)` half of ADR 0075's grant never did anything.

The run then ended `subtype: success` with no report. The action's `prevented` output looked only at
`error_max_turns`, so it said `false`, and the replay printed "no valid report" — the reading
[ADR 0072](0072-a-golden-case-earns-its-replay-frequency.md) scores as a miss.

The code-review skill had already gained "Never `cd` into the worktree" after this run. That is an
instruction, and the command that broke the grant ran without any grant of its own: nothing
mechanical stood behind it.

## Decision

1. **The reviewer's file grant is `Edit(/tmp/code-review/**)`.\*\* One rule, on the tool Claude Code
   consults, anchored at the primary working directory. This corrects ADR 0075 item 1's spelling and
   leaves its decision — the writable surface is the reviewer's own directory — exactly as it was.

2. **The spelling is asserted, not remembered.** `yarn review:allowlist:check` fails an `Edit` or
   `Read` path rule in `--allowedTools` with no anchor, and any path rule on `Write`, `NotebookEdit`,
   or `MultiEdit`. A grant that reads as scoping something and scopes nothing is the same defect as
   an instruction nothing permits, which is what that checker already exists to catch.

3. **A refused write to a required output is a prevented measurement, whatever the run's subtype.**
   `tools/scripts/review/classify-reviewer-run.ts` reads the transcript's final `result` event and
   reports `prevented=true` when a Write or Edit to the report or the obligation answer sheet was
   refused, as well as on the turn ceiling with denials. The judgments moved out of the action's
   shell so fixture transcripts can test them: a transcript expires, and a live run costs a session.

4. **Run 35716439899 is a void.** It is recorded in `docs/review/golden-replay-results.md` as
   prevented, and it moves no tier.

## Consequences

- A reviewer that changes directory keeps its grant. The skill's instruction not to `cd` stays — a
  moved shell still breaks relative paths in the reviewer's own commands — but the report no longer
  depends on it being followed.
- A local session with the new grant was run against both spellings: after
  `cd tmp/code-review/worktree`, the old grant refused the write to the report path, the new one
  allowed it, and both refused a write outside `tmp/code-review/`.
- `Bash(rm -f tmp/code-review/*)` is a Bash rule, matched on the command's text, and is untouched.
- The checker asserts how a file grant is anchored and takes no position on which directory it
  names. That is still ADR 0075's decision, and there is no second source to compare it against.
