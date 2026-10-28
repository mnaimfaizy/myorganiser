# A golden replay reviews the case tree with the pull request's harness

Golden replay run [35833576958](https://github.com/mnaimfaizy/myorganiser/actions/runs/35833576958)
(pull request #884) missed `release-bump-leaves-generated-client-stale` by suppressing its expected
finding, and the suppression rested on a quotation from the wrong tree. Asked whether
`openapi:check` covers the incident head `8175cb6`, the reviewer Read and Grepped
`.github/workflows/ci.yml` from the job's checkout — the pull request — found
`run: corepack yarn openapi:check` at line 527, answered that the gate was wired, and raised
nothing. At `8175cb6` that line is `timeout-minutes: 30`; `openapi:check` did not reach CI until
2026-08-21, three days after the incident. The same run read `check-fix-attribution.mjs` and ADR
0100 from the pull request and listed ADR 0100 in `standardsSources` for a range that predates it by
a month. Its one attempt to check the citation at the head, a `git show` piped into `sed`, was
refused, and it wrote the answer from the checkout instead
([results](../review/golden-replay-results.md), "A miss that quoted the wrong tree").

## Status

accepted

## Context

The replay job checked out the pull request, because the pull request's skill and scripts are what
it measures, and then told the reviewer in one prompt line that "the head is NOT the current
checkout" and to read the range with `git show <head>:<path>`. Every other instruction the reviewer
carries, and every tool it holds, points the other way. Read, Grep and Glob take a path and read the
disk; the skill reaches standards by path; a gate run for executed evidence runs what is on disk.
One sentence against all of that loses whenever the reviewer stops thinking about which tree it is
in, and the failure is silent: a quotation from the checkout looks exactly like a quotation from the
head until something compares it to the head.

The checkout is the pull request's tree, and a golden case asks about a tree that is weeks or months
older. Both kinds of thing the reviewer read from the wrong one:

- **Facts about the code** — which gates `ci.yml` runs, which scripts exist, what a file says. The
  wired-gate obligation's answer is one of these, and so is every `coveringGate` suppression under
  ADR 0074.
- **Standards** — `AGENTS.md`, `CODING_STANDARDS.md` and what it indexes, the ADRs. A reviewer
  holding a range to a rule written after it is reviewing with hindsight.

Three shapes were available:

1. **Keep the pull request checkout and a worktree at the case head**, the arrangement that failed.
   It needs the reviewer to address every read to the worktree, which is the discipline run
   35833576958 did not keep.
2. **The case head for the code, the pull request's documents for the standards.** This is a tree
   no pull request ever has. Its standards describe gates and files the code beside them does not
   contain — ADR 0074 says `tailwind:classes:check` is invoked by `ci.yml`, beside a `ci.yml` that
   does not invoke it — so it reintroduces the contamination through the documents the reviewer is
   told to trust most.
3. **The case head for everything the reviewer reads, with only the reviewer's harness laid over it
   from the pull request.** This is the tree a reviewer would have had at the time, reviewed by
   today's reviewer: the shape production has, where the standards and the code are one tree.

## Decision

**1. The replay's working tree is the case head.** After loading the case, the replay job checks
out the case head, detached, in the workspace. Read, Grep, Glob, a gate run for executed evidence,
and `git worktree add … HEAD` all land on the case's tree without the reviewer having to remember
anything. The prompt says the working tree is the head; it no longer has to win an argument with
the tools.

**2. The standards are the case tree's.** A document the head does not contain is not a standard
the range could have broken, and the prompt tells the reviewer not to go looking for later ones.

**3. Only the harness comes from the pull request, and it is named.** Five paths are laid over the
case tree from the pull request, because they are what the replay measures or what makes the
session run the way it does in production:

- `.agents/skills/code-review` — the skill, including the rule catalogue it pastes;
- `.claude` — the permission rules the session loads ([ADR 0099](0099-a-project-ask-rule-is-a-refusal-in-a-headless-run.md))
  and the link through which the skill is found;
- `tools/scripts/copilot-hooks` and `.agents/skills/upstream-brief` — the hook scripts those settings
  run by cwd-relative path, and the module they import;
- `.github/actions/code-reviewer` — the composite action the job's next step `uses:` from the
  workspace.

The prompt names them as harness, not subject. A case whose own diff touches one of them is
reviewed with the pull request's copy on disk; the job warns on that case's run and the prompt tells
the reviewer to read such a path with `git show <head>:<path>`. No case in the set does today.

**4. The review scripts run from outside the workspace.** The obligation selector, the validator,
the obligation-answer check, and the scorer — with `tools/scripts/lib` and `tools/config`, which
they read — are extracted from
the pull request with `git archive` into the runner's temp directory. They are not in the reviewer's
tree, so no Read or Grep of its lands on them, and not a worktree, so `git worktree list` does not
offer them. They resolve modules through a link to the one `node_modules` the job installed. The
shared action takes a `tooling-dir` input for the two scripts it runs itself; it defaults to `.`,
which leaves `code-review.yml` running exactly what it ran before. The scripts that read git — the
selector and the answer check — run through `tools/scripts/review/run-from-tooling.ts`, which gives
them the tooling copy as their working directory and the workspace's repository as their git, since
an extracted copy is not a repository. The reviewer is given the
validator's path, because the case's `package.json` predates the `review:*` scripts and
`corepack yarn review:validate` does not resolve there.

## Consequences

**What a replay measures changes, and this is the intended change.** It now measures the pull
request's reviewer against the tree as it stood at the incident, not against the pull request's
tree with a note saying otherwise. The obligation catalogue, the rule catalogue and the skill are
still the pull request's, so a lesson that lives in the harness is carried to every case. A lesson
that lives only in a standards document written after the incident is not.

**Two cases lose their document.** `groceries-blob-type-without-fanouts` (guard) and
`export-envelope-drops-tasks` (frontier) expect `standard-enum-fanout-not-pinned`, whose catalogue
entry cites [ADR 0053](0053-a-fan-out-over-a-domain-enum-is-pinned-at-its-call-site.md). ADR 0053
postdates both heads, and neither head's `AGENTS.md` carries the rule. The rule id is still in the
catalogue the skill pastes, so the reviewer can name the defect; it can no longer cite the document
that forbids it. A miss on either case in the replays after this decision is a question about the
apparatus before it is a question about the reviewer, and is not by itself a demotion under ADR
0072: the resolution is to carry the lesson in the harness — an obligation, as the other four cases'
lessons are — or to retire the case as unwinnable as written, with a reason.

**Old case trees are older than the tooling assumes.** The oldest head in the set, `b030fd1`, has
no `ci.yml` and no `docs/adr`. That is the truth about that tree, and a reviewer answering "not
wired" there is right. Executed evidence runs against the pull request's installed dependencies
rather than the case's, which was already true of the worktree the old arrangement used, since a
worktree inside the workspace resolves the same `node_modules`. A gate or test that needs the case's
own lockfile installed will fail there, and the reviewer records what it ran either way.

**The answer-sheet check runs from the tooling copy too.** [ADR 0101](0101-a-replay-whose-answer-sheet-fails-its-check-measured-nothing.md)
closed the other gap run 35833576958 left: the replay runs `review:obligations:check` before it
scores, and a sheet that fails it is a void. That check reads the head by commit, so it never
depended on the checkout; under this decision it runs from the extracted tooling like the other
review scripts, and the replay's own checker recognises a script run by its file as well as by its
package name. With the tree fixed, a quotation read from disk matches the head, so a failure there
now means a citation that was made up rather than one read from the wrong tree.
