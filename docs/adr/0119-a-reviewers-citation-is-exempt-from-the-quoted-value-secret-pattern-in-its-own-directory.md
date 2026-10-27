# A reviewer's citation is exempt from the quoted-value secret pattern in its own directory

## Status

accepted

## Context

[ADR 0078](0078-a-citation-that-does-not-match-its-source-is-a-fact-about-the-pipeline.md) makes the
reviewer's obligation answers checkable: each cites a tracked source line, and the checker compares
the quote to the tree byte for byte. A redacted quote fails that comparison, so the reviewer has to
write the line as it is.

Five tracked E2E specs hold a fixture of one shape — a `passphrase` constant assigned a multi-word
English phrase of 28 characters (`vault.spec.ts`, `vault-export-import.spec.ts` twice,
`groceries.spec.ts`, `groceries-items.spec.ts`). The secret-scan PreToolUse hook
(`tools/scripts/copilot-hooks/secret-scan.ts`) denies any tool input matching a credential-like
name, `=` or `:`, then a quoted value of 16 or more characters. The fixture matches. A reviewer that
cites it has its Write to `tmp/code-review/obligations.answers.json` refused, and the review ends
with no report. Reproduced against the hook: the same payload with a short value is allowed. The
hook also refused a shell command carrying the line, and refused the author's first attempt to
reproduce the defect in this session — so the defect is not the reviewer's alone.

[Issue #887](https://github.com/mnaimfaizy/myorganiser/issues/887) set out four options and
recommended none:

1. Exempt the reviewer's directory from content scanning.
2. Allow content that quotes a tracked file.
3. Change the fixtures so they stop matching.
4. Accept redacted quotes in the answer sheet.

## Decision

1. **One pattern is exempt, in one directory, for file-writing tools only.** A `Write`, `Edit`, or
   `MultiEdit` whose every destination resolves to strictly inside `<repo root>/tmp/code-review/`
   skips the quoted-value pattern. The other four patterns — private key marker, GitHub token,
   cloud and API key shapes, JWT-like token — still apply there, so a real credential written into
   the answer sheet is still refused.

2. **Everything else is scanned as before.** A path outside the directory, a shell command (including
   one that redirects into it), a call with no destination, and a call that names the directory
   itself are all unexempt. The exemption is carried on the pattern (`exemptInReviewerOutput`), so
   the next pattern added is scanned in the reviewer's directory by default.

3. **The directory is anchored to the script, not to the session.** The root is derived from the
   script's own location. A relative destination is resolved against the payload's `cwd`. A
   reviewer whose shell has moved into `tmp/code-review/worktree` ([ADR 0118](0118-a-file-grant-is-anchored-where-the-session-started.md))
   keeps the exemption on the real output paths and gains none elsewhere.

4. **Paths are compared in one canonical spelling.** Separators unified, case folded, `.` and `..`
   collapsed, by hand rather than `node:path` — a hook payload can carry a Windows path on a POSIX
   host. `tmp/code-review/../../apps/x`, `tmp/code-review-evil/`, and `apps/tmp/code-review/` all fail
   the check.

## Consequences

- Rejected: option 3. It fixes five fixtures and none of the next ones, and the pattern would still
  refuse any other tracked line of that shape. Option 4 changes ADR 0078's contract to solve a
  hook problem, and a redacted quote is no longer a citation. Option 2 needs a file read, and a
  diff against the tree, inside a five-second hook that fails open on error.
- Residual risk, accepted: a real credential shaped as a quoted word list, written into
  `tmp/code-review/`, is not refused by this pattern. The directory is git-ignored, so nothing
  written there reaches a commit, and the other four patterns still stand. Case folding is applied
  on every host, so a differently-cased sibling such as `tmp/Code-Review/` is treated as the same
  directory on a case-sensitive filesystem; it is equally git-ignored. A symlink inside the
  directory is not resolved.
- The exemption names Claude Code's file-writing tools. Copilot and VS Code tool names that write
  files (`create`, `create_file`, `replace_string_in_file`) are not exempt: the reviewer runs under
  Claude Code, and widening the set is a one-line change if another harness ever runs it. Every
  harness gets the same script, but not every harness's tool names.
- A destination is read from the keys `WRITE_PATH_KEYS` in `lib.mjs` lists. A write tool that named
  its target under a key outside that list would have the key ignored; Claude Code's `Write`,
  `Edit`, and `MultiEdit` use `file_path`, so nothing reachable today does.
- A shell command carrying the fixture line stays refused. The reviewer records citations with
  Write; relaxing the shell path is a larger exemption and would need its own decision.
- The wiring in `.claude/settings.json` and `.github/hooks/secret-scanner.json` is unchanged; both
  run the same script, so every harness gets the same behaviour.
