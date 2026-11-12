# The Merge Train auto-merges only on facts it reads for the head it merges

## Status

accepted

Amends [ADR 0144](0144-a-batch-of-pull-requests-merges-through-the-merge-train-not-the-admin-bypass.md) with a mode in which the Merge Train starts itself, and [ADR 0048](0048-a-qa-plan-carries-only-what-automation-does-not-prove.md) on what an item left for a person means when nobody is merging. Puts into effect the merge rules [ADR 0070](0070-a-review-tier-is-a-fact-about-the-diff-and-a-gate-tier-is-a-decision-about-the-work.md) item 1 wrote for `review:auto` and `review:agent`, which no merge has applied until now: the Maintainer started every one.

## Context

`finish-standalone-runs` and `orchestrate` end by handing the Maintainer a `yarn merge:train <pr>…` command. Of the last 100 merged Pull Requests, 31 were `review:agent` and 1 was `review:auto`. So about a third of merges wait on a person whose review ADR 0070 already said they do not need.

PrAuthor now writes a Merge Danger section in every Pull Request description. It is tempting to gate on it, but it is a model's judgment of the diff. [ADR 0073](0073-a-required-check-is-a-fact-about-the-pipeline-not-a-judgment-about-the-diff.md) keeps judgments out of gates. The description is also editable, and it is not tied to a commit.

## Decision

1. **Auto-merge runs in the Merge Train, as `yarn merge:train --auto <pr>…`.** The rules below are pure in `tools/scripts/lib/merge-train.ts`. The session that builds the merge order passes the candidates in that order and applies no rule itself. A candidate that fails a rule is skipped with its reason, and the train moves on. The stop-at-first-red behaviour of ADR 0144 still applies to a train the Maintainer starts.
2. **It runs from the agent session, on the Maintainer's `gh` login.** No GitHub Actions workflow and no new credential. A merge made with a workflow's `GITHUB_TOKEN` does not start the `push` workflows on `main`.
3. **A Pull Request may auto-merge only when every fact below holds for the head being merged:**
   - Its Review Tier job output is `auto` or `agent`. The label is not read.
   - Its Agent Verdict is `approve`. For `review:auto` this is ADR 0070's rule. For `review:agent` it is stricter than ADR 0070's rule (no Blocking finding), until decision 6 relaxes it.
   - Its QA Report says QA passed with no item left for a person, or it records that no manual QA was needed. Only a commit written on the branch makes the report stale. The train's own merge of `main` into the branch does not, because the required checks on the updated head cover that merge.
   - Its Merge Danger Door does not say `one-way`. Only that line is read. A missing section, a missing line, or `two-way` changes nothing, so Merge Danger can hold a merge back but never allow one. A `one-way` Door on an `auto` or `agent` Pull Request is reported as a mismatch, for the Maintainer to correct either PrAuthor or `tools/config/review-tier-paths.json`.
   - The latest CI run on `main` is green. If it is not, nothing auto-merges in that pass.
   - Every required check of `main`'s ruleset is green, exactly as ADR 0144 already requires.
4. **One setting in `tools/config/` holds the mode: `off`, `shadow`, or `on`.** Under `shadow` the train posts one comment on each candidate, "would auto-merge at `<sha>`" or "held: `<reason>`", and merges nothing. Under `on` it merges. Under `off` it does nothing. Changing the setting is a Pull Request, and `tools/config/` is a `review:human` path.
5. **Shadow ends on a measured record.** At least 20 "would auto-merge" decisions over at least two weeks. Every one was merged by the Maintainer without changes, none was reverted or needed a follow-up fix within seven days, and no "held" reason was a misread.
6. **A bad Auto-merge resets the record.** If an auto-merged Pull Request is reverted, or needs a follow-up fix within seven days, the setting returns to `shadow` and the count starts again. `review:agent` relaxes to ADR 0070's own rule only after a separate record of the same shape, kept under `on`.
7. **The QA Report becomes machine-readable.** Its result line, the commit it names, and its count of items left for a person get a fixed form that the train parses. A report the train cannot parse holds the merge back.

## Considered Options

- **Gate on Merge Danger instead of the Review Tier.** This was rejected because Merge Danger is a judgment, not tied to a commit, and editable.
- **A GitHub Actions workflow, or a scheduled cloud agent, that starts the train.** Either would merge while nobody is working. Either needs a new credential with merge rights, and a workflow would need a GitHub App token so that `push` CI still runs on `main`. This is deferred until the record under `on` justifies it.
- **Let the session apply the rules from the skill's prose.** This was rejected because the merge decision would become a model's reading of a QA Report.
- **Include only `review:auto`.** This was rejected because it covers about 1% of Pull Requests.
- **Treat the train's merge of `main` as making the QA Report stale.** This was rejected because nothing could ever auto-merge once `main` had moved.

## Consequences

- An item left for a person now holds back an Auto-merge, though under ADR 0048 it still does not block a merge the Maintainer starts.
- Tightening only: the Review Tier, the Agent Verdict, QA, Merge Danger, and `main`'s state can each hold a merge back, and none can allow one alone.
- At today's rate, the shadow record takes about 60 Pull Requests to fill.
- The train gains GitHub reads per candidate (the tier job output, the review report, the QA Report, the description, and `main`'s latest run), all covered by the fake-GitHub tests that already drive the loop.
