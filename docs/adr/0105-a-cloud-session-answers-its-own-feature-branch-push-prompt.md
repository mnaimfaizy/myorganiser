# A cloud session answers its own feature-branch push prompt

`.claude/settings.json` keeps `git push` and `yarn ai:create-pr` behind an `ask`
rule, and an `ask` rule prompts in every permission mode, auto included. At a
terminal that costs a keystroke. In a cloud session (claude.ai/code), which
exists to push a branch and open a pull request, it is a round trip to a
browser tab for the one command the session was started to run. So a
Claude-only `PermissionRequest` hook,
`tools/scripts/copilot-hooks/cloud-permission-request.ts`, answers that prompt
itself when Claude Code reports a cloud session. Everywhere else the prompt
stands.

## Status

accepted

## Context

Three facts from the Claude Code documentation shape this. None of them is
exercised by anything in this repository.

- Cloud sessions read only the committed `.claude/settings.json`. They read
  neither `settings.local.json` nor user settings, and they ignore
  `defaultMode: "bypassPermissions"` from any settings file. A checked-in file
  therefore cannot relax a cloud session without relaxing every clone.
- `ask` and `deny` rules are evaluated no matter what a PreToolUse hook
  returns. A `PermissionRequest` hook runs when Claude Code is about to prompt,
  including a prompt an `ask` rule forced, and it can answer that prompt. It
  still cannot override a matching `deny` rule.
- Claude Code sets `CLAUDE_CODE_REMOTE=true` in cloud sessions and nowhere
  else.

ADR 0099 is the same file seen from the CI reviewer: an `ask` rule is a refusal
when nobody is at a keyboard, and its fix was to change the instruction rather
than remove the `ask`. That holds here too. The `ask` rules stay, because they
protect the developer at a terminal. What changes is who answers them, in one
environment, for one narrow shape of command.

## Decision

**1. The hook approves only while `CLAUDE_CODE_REMOTE` is `true`.** A local
terminal, the desktop app's local sessions, and the CI reviewer never set it,
so for them the hook gives no decision and the existing prompt or refusal
applies.

**2. It approves two commands, both written as one plain command:**

- `git push [-u|--set-upstream] origin <branch>`, where neither side of the
  refspec is `main`, `master`, `HEAD`, `release/*`, or a tag;
- `yarn ai:create-pr …`, with or without a leading `corepack`. Its runner
  recomputes the merge base, pins its own lease, and refuses a push from the
  base branch.

**3. Anything else gets no decision.** That covers any flag other than
`-u`/`--set-upstream`, a force (`+`) or delete (`:branch`) refspec, a bare
`git push`, a remote other than `origin`, and any chaining, piping,
substitution, redirect, or quoting. These are left to the user because the
hook would have to guess what they resolve to: a bare `git push` goes wherever
the upstream config says, which may be `main`.

**4. `deny` stays the floor.** Force pushes, `--mirror`, `--delete`, and the
other destructive forms are `deny` rules, so no answer from this hook reaches
them.

## Consequences

A cloud session can push its feature branch and open its pull request without
waiting on a browser tab. Merging, releasing, and pushing to a protected
branch still prompt there, as they do everywhere else.

The hook depends on two documented behaviours this repository cannot test: that
`PermissionRequest` is dispatched for `ask`-forced prompts, and what
`CLAUDE_CODE_REMOTE` is set to. Its tests drive the script with a synthetic
payload. If a cloud session still prompts for a feature-branch push, check those
two behaviours before the matcher.

Widening the approved set is a change to this decision, not a tweak to a regex.
Each new shape needs the same argument as the two here: it runs in the
disposable VM, it cannot reach a protected ref, and a `deny` rule covers its
destructive forms.
