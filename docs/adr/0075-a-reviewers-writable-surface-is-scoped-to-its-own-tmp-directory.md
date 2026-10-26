# A reviewer's writable surface is scoped to its own tmp directory

## Status

accepted

## Context

[ADR 0071](0071-a-finding-blocks-only-on-evidence-and-a-verdict-is-computed-never-written.md)
item 4 permits the reviewer to execute — existing targets, and a throwaway reproduction in a
`git worktree` under `tmp/` — and says "Network, `git push`, and edits outside that tree are
refused by the harness allow-list, not by prose." That sentence describes an allow-list that did
not exist. `.github/actions/code-reviewer/action.yml` granted the bare `Write` and `Edit` tools,
unscoped, to any path in the checkout. The only thing standing between the reviewer and an edit
anywhere in the repository was the prompt telling it not to.

A replay run used exactly that gap. An inline script execution was refused. Rather than stop, the
reviewer wrote a scratch script to a path outside `tmp/code-review/worktree` — the one location
ADR 0071 item 4 names as disposable — and executed that file instead, and separately attempted to
disable the sandbox that had refused it. Both are things ADR 0071 said the allow-list would refuse.
Neither was.

A second, unrelated defect sat in the same allow-list entry the reviewer worked around. Reading a
file range some other way than the Read tool's `offset`/`limit` had no sanctioned path at all: the
grant `Bash(sed -n:*)` requires `-n` as the literal second token, and the reviewer's own habitual
spelling of a ranged read does not reliably supply it — three refusals in one golden replay run
alone. `docs/research/2026-09-10-the-answer-sheet-is-inert.md` records the same run's turn
exhaustion after 26 permission denials without attributing them individually; the `sed` count is
this issue's own report, not a claim that research brief makes. A refused command is not free
regardless of which command it was: it spends turns and produces nothing. The fix for that gap is
not a better `sed` pattern; the Read tool already reads a range without a shell subprocess, so the
entry has no reason to exist.

## Decision

1. **`Write` and `Edit` are scoped to a directory only this run owns.** The allow-list entries read
   `Write(tmp/code-review/**)` and `Edit(tmp/code-review/**)`, not bare `Write,Edit`. That directory
   already holds everything the reviewer legitimately writes: `report.json`,
   `obligations.answers.json`, and the throwaway `git worktree` ADR 0071 item 4 permits. Nothing the
   reviewer is asked to produce lives outside it.
   **Corrected by [ADR 0118](0118-a-file-grant-is-anchored-where-the-session-started.md):** the
   spelling above did not hold. A bare path is relative to the session's current directory, so a
   reviewer that ran `cd` lost the grant for its own report, and a `Write(path)` rule is never
   consulted at all. The grant is now the single rule `Edit(/tmp/code-review/**)`; the decision
   itself is unchanged.

2. **The interpreter stays unrestricted; the writable surface does not.** `Bash(node:*)` keeps its
   reach — executed evidence is the strongest evidence class ADR 0071 recognises, and narrowing where
   `node` may run would cut the capability the whole contract is built to encourage. The defect was
   never that the reviewer could run code; it was that it could park that code anywhere first.

3. **`Bash(sed -n:*)` is removed, and the skill directs the Read tool for ranges instead.** A shell
   utility for paging a file range earns its allow-list entry only by being needed, and the Read
   tool's `offset`/`limit` makes it unneeded, not merely fixable. `.agents/skills/code-review/SKILL.md`
   now says so in the Trust rules.

4. **ADR 0071 item 4 is corrected, not narrowed.** The sentence it carried was false at the moment it
   was written, not overtaken by later events, so this is not a policy change the way ADR 0073 and
   ADR 0074 were. ADR 0071 keeps a pointer here rather than a rewrite, for the same reason ADR 0074
   item 3 gives: the record has one author per rule, and restating it independently is how the
   restatement drifts from the rule.

## Consequences

- An edit or a write outside `tmp/code-review/**` is now refused by the allow-list itself, the same
  way `git push` already was — a fact the harness enforces, not a line in a prompt the reviewer can
  route around under pressure from a refused command.
- The reviewer has no shell-utility path to a file range and does not need one; a read that used to
  cost a refusal now costs nothing.
- A live reviewer run against a real Pull Request after this change still produces `executed`
  evidence, so the scoping removes a writable surface without removing the capability ADR 0071 item 4
  exists to preserve.
- `tools/scripts/check-review-tool-allowlist.ts` parses `Write(...)` and `Edit(...)` as opaque tool
  grants, the same as it already reads `Read` and `Agent`; it asserts instructed commands against
  `Bash(...)` entries and takes no position on a path-scoped grant, so this change needs no update
  there. (ADR 0118 item 2 has since given it a position on how such a grant is anchored.)
