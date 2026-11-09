# Software factories, and where MyOrganiser sits on the spectrum

**Frozen 2026-11-09.** It answers seven questions:

1. What does the term "software factory" mean in 2026?
2. How does MyOrganiser's agent pipeline compare to it, and where are humans still involved?
3. Can an organisation rely on a "dark" factory?
4. How do the inner and outer loops combine?
5. What goes wrong when agents write their own tests?
6. How does a factory work when one product spans many repositories and teams?
7. How should a factory be evaluated, if not by counting merged PRs?

It also sketches a plan for a separate dark-factory testbed repository. This
brief does not update. The pipeline it describes is defined in the ADRs and
Skills it links.

## What was read

External sources, all fetched on 2026-11-09:

- Addy Osmani, [Software Factories, Light and Dark](https://addyosmani.com/blog/software-factories/) (2026-07-20). A practitioner essay.
- StrongDM AI, [Software Factories And The Agentic Moment](https://factory.strongdm.ai/) (2026-02-06). A first-party account of a "dark" factory.
- Vercel, [Building a software factory for AI SDK](https://vercel.com/blog/building-a-software-factory-for-ai-sdk) (2026-08-12). A first-party account with numbers.
- LaunchDarkly, [Building a software factory on our scariest code](https://launchdarkly.com/blog/building-a-software-factory-on-our-scariest-code/) (2026-08-03). A first-party account.
- Firecrawl, [How to Build an AI Software Factory](https://www.firecrawl.dev/blog/ai-software-factory) (2026-09-11). A vendor post. It is used here only for the numbers it attributes to Stripe, Faire, Shopify and dotnet/runtime, and those were not traced to their originals.
- Factory.ai, [Droids](https://factory.ai/product/droids). A vendor product page.

Read only through search-result summaries, **not** opened in full (treat their
figures as leads):

- OpenAI, [Harness engineering](https://openai.com/blog/harness-engineering) (February 2026), and the secondary write-up by [ZenML](https://www.zenml.io/llmops-database/extreme-harness-engineering-building-production-systems-with-zero-human-written-code).
- Inner and outer loop framings: Addy Osmani, [Own the Outer Loop](https://addyosmani.com/blog/own-the-outer-loop/); [CircleCI](https://circleci.com/blog/software-factory/); [Augment Code](https://www.augmentcode.com/guides/inner-loop-vs-outer-loop-ai-agents); [ADLC chapter 12](https://dev.to/praveen_govi_ai/two-loops-one-builds-your-code-one-improves-your-ai-agent-chapter-12-of-the-agentic-development-10ba); [IT Revolution](https://itrevolution.com/articles/the-three-developer-loops-a-new-framework-for-ai-assisted-coding/).
- Reward hacking in coding agents: [SpecBench, arXiv 2605.21384](https://arxiv.org/abs/2605.21384); [arXiv 2609.28614](https://arxiv.org/pdf/2609.28614); [arXiv 2606.07379](https://arxiv.org/pdf/2606.07379); the secondary summary by [BtSavvy](https://www.btsavvy.com/insights/ai-agents-cheat-on-their-own-tests/). The arXiv identifiers were not checked against the papers.
- Agents across repositories (practitioner blogs and vendor posts, no rigorous studies): [Codex CLI multi-repo patterns](https://codex.danielvaughan.com/2026/04/26/codex-cli-microservices-cross-service-development-multi-repo-patterns/); [multi-repo changes as a coordination problem](https://dev.to/ramcsamal/multi-repo-microservice-changes-are-a-coordination-problem-i-solved-it-with-ai-agent-teams-34mf); [cross-repo context](https://dev.to/danielwe/ai-coding-agents-need-cross-repo-context-the-teams-running-them-at-scale-are-already-building-it-ek0); [the meta-repo pattern](https://seylox.github.io/2026/03/05/blog-agents-meta-repo-pattern.html); [monorepo vs multirepo for agents](https://inerciatech-blog.pages.dev/posts/2026-04-26-monorepo-vs-multirepo-ai-agents); [synthetic monorepos](https://tianpan.co/forum/t/ai-will-make-2026-the-year-of-the-monorepo-synthetic-monorepos-bridge-polyrepo-teams-without-the-migration-pain/579); [Cursor multi-repo cloud agents](https://www.buildfastwithai.com/blogs/cursor-cloud-agents-development-environments-2026).
- Evaluation: METR, [Many SWE-bench-passing PRs would not be merged into main](https://metr.org/notes/2026-03-10-many-swe-bench-passing-prs-would-not-be-merged-into-main/) (2026-03-10); METR's early-2025 developer-productivity trial, [arXiv 2507.09089](https://arxiv.org/abs/2507.09089); DORA, [2025 year in review](https://dora.dev/insights/dora-2025-year-in-review/), with secondary coverage by [RedMonk](https://redmonk.com/rstephens/2025/12/18/dora2025/); [agent code churn across 110,000 PRs](https://codex.danielvaughan.com/2026/05/01/agent-code-churn-research-codex-cli-durability-patterns/); [The Work Behind Delegation, arXiv 2609.24234](https://arxiv.org/pdf/2609.24234); Warp, [metrics that prove agents work](https://www.warp.dev/articles/metrics-that-prove-ai-coding-agents-are-working) (vendor); [Swarmia agent metrics](https://help.swarmia.com/measure-the-productivity-impact-of-ai-tools/ai-agent-metrics) (vendor); [AmplifyingAI on agent PR review](https://amplifying.ai/coding-agents/autonomy); [OfficeChai on Cursor's agent-authored PR share](https://officechai.com/ai/35-of-merged-prs-at-cursor-now-created-by-autonomous-agents-says-ceo-michael-truell/); [Larridin on the Google engineer trial](https://larridin.com/blog/ai-vs-human-developer-productivity) (secondary).

Repository sources: the ADRs, Skills, workflows and `.sandcastle/` files linked
in the comparison below. The GitHub branch ruleset lives in repository
settings, not in the tree, and was **not** read. Merge-gate statements rely on
[ADR 0070](../adr/0070-a-review-tier-is-a-fact-about-the-diff-and-a-gate-tier-is-a-decision-about-the-work.md).

## What a software factory is

The sources agree on a structural definition. A software factory is the system
**around** coding agents, not the agent itself:

1. a **queue** of work (issues, labels, webhooks, cron, CI failures, alerts);
2. agents in **isolated workspaces** (worktrees, containers, sandboxes);
3. **automated verification** (lint, types, tests, model judges);
4. a **review and merge gate**;
5. deploy, with production signals fed back into the queue.

Osmani calls it many harnessed loops running at once, with humans owning the
outer loop. Firecrawl calls the agent the cheapest piece of it. The pattern is
not specific to bug fixing. Bug → reproduce → fix is just the loop with the
most objective check ("the probe no longer fails"), so it is usually automated
first. The same machinery handles features, refactors, backports and
dependency or lint debt.

### Light and dark

|                  | Light (lit) factory                                            | Dark factory                        |
| ---------------- | -------------------------------------------------------------- | ----------------------------------- |
| Who writes code  | Agents                                                         | Agents                              |
| Who reviews code | A human at the merge gate, helped by agent review              | No human. Machine verification only |
| Human judgment   | Upstream (product, spec, architecture) and at expensive merges | Specs and scenarios only            |
| Accounts read    | Vercel, LaunchDarkly, Factory.ai                               | StrongDM                            |

### What the accounts report

- **Vercel.** Webhook → issue queue → sandboxed agents. Classification, then a failing reproduction probe and a spec, then a PR with a live end-to-end test, then an automated risk review. **A human reviews and merges every change.** Each run ends as success, flawed, blocked or manual, and a flawed run becomes a new eval case. After about four weeks the factory authored 25–35% of merged PRs and closed 70–80% of issues.
- **StrongDM.** Its two rules are that humans neither write nor review code. Tests are replaced by "scenarios" kept outside the codebase like a holdout set and scored by an LLM, because agents could game in-repo tests. Scenarios run against behavioural clones of third-party services (Okta, Jira, Slack and others). The post reports no defect or production data.
- **LaunchDarkly.** It calls full autonomy "the autonomy trap". Each phase shipped behind a feature flag, with agent review, internal dogfooding and automatic rollback. A human steered every phase, and code review stayed the bottleneck. The rewrite was planned for four weeks and took more than six.
- **Osmani.** Verification, not generation, is the constraint. The named risk is _comprehension debt_: code accumulating faster than any human understands it. One fully dark run of about four months ended in a major failure that needed manual debugging.
- **Merge-rate data (via Firecrawl, untraced).** On dotnet/runtime, agent PRs merged at 67.9% against 87.1% for humans; fully autonomous PRs merged at 55.1% against 86.2% for those with a human commit.

Conclusion from the sources: humans are almost always in the loop. What varies
is **where**. The consensus places them at the spec, at high-risk or
irreversible merges, and at the production ship decision.

## MyOrganiser against the definition

| Stage              | Typical factory                 | MyOrganiser                                                                                                                                                                                                                                                                                    | Actor                                   |
| ------------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Intake             | Automatic triggers start agents | `yarn dispatch-agents` is run by hand ([RUNBOOK](../sandcastle/RUNBOOK.md)). Cron workflows such as [`nightly-e2e.yml`](../../.github/workflows/nightly-e2e.yml) file issues, but no workflow dispatches agents                                                                                | Human                                   |
| Spec               | Often only the issue text       | `grill-with-docs` → `to-prd` (human approves test seams) → committed design, `CONTEXT.md`, ADRs                                                                                                                                                                                                | Human and agent                         |
| Breakdown          | Rarely explicit                 | `to-issues` slices labelled `type:afk`/`type:hitl`, `complexity:*`, `gate:*`, with blockers ([ADR 0002](../adr/0002-agent-orchestration-label-vocabulary.md)). Published only on approval                                                                                                      | Agent drafts, human approves            |
| Isolation          | Worktree or sandbox             | A worktree **and** a Docker container per slice, with no `gh` credentials inside ([`main.mts`](../../.sandcastle/main.mts))                                                                                                                                                                    | Agent                                   |
| Parallelism        | Many loops at once              | PRD slices run one at a time and fast-forward into a local branch ([ADR 0010](../adr/0010-sandcastle-local-only-integration.md)). `dispatch-waves` runs dependency waves one after another                                                                                                     | Agent                                   |
| Implement and test | Agent plus tests                | Pipeline depth set by gate tier ([ADR 0012](../adr/0012-tiered-quality-gates.md)); model chosen from complexity                                                                                                                                                                                | Agent                                   |
| Done signal        | CI pass/fail                    | `OUTSTANDING:` protocol. An unclean slice goes to `ready-for-human` and does not unblock its dependents ([ADR 0111](../adr/0111-a-prd-slice-closes-only-on-a-clean-outcome.md), [outcome check](../agents/outcome-check.md))                                                                   | Agent, human fallback                   |
| Verification       | Lint, tests, model judge        | Fact-asserting gates ([ADR 0043](../adr/0043-gates-assert-facts.md)), a sandboxed affected-scope gate, a PRD gated once on the assembled branch ([ADR 0045](../adr/0045-a-prd-is-gated-once-on-the-assembled-feature-branch.md)), CI e2e shards                                                | Agent                                   |
| Review             | Agent and/or human              | [`code-review.yml`](../../.github/workflows/code-review.yml) agent review. A deterministic Review Tier sends vault, auth, Prisma, workflow and gate changes to `review:human` ([ADR 0070](../adr/0070-a-review-tier-is-a-fact-about-the-diff-and-a-gate-tier-is-a-decision-about-the-work.md)) | Agent, human by risk                    |
| Review fixes       | Agent iterates                  | `address-pr-review` applies clear fixes and batches decisions to a person                                                                                                                                                                                                                      | Agent, human decides                    |
| QA                 | Usually CI only                 | Agents run QA per PR in a throwaway worktree and database. What they cannot prove goes under "Left for a person" ([ADR 0142](../adr/0142-a-standalone-runs-qa-is-run-by-agents-and-reported-on-its-pull-request.md))                                                                           | Agent, residue human                    |
| Merge              | Light: human. Dark: agent       | Human only. No Skill or script runs `gh pr merge`. Only release PRs request auto-merge ([`release-pr.yml`](../../.github/workflows/release-pr.yml))                                                                                                                                            | Human                                   |
| Deploy             | Often continuous                | Staging deploys daily from the newest green `main` ([`deploy-staging.yml`](../../.github/workflows/deploy-staging.yml)). Production needs a `required_reviewers` approval                                                                                                                      | Agent for staging, human for production |
| Feedback           | Signals → queue → agents        | Signals → issues → human triage (`my-triage`) → dispatch                                                                                                                                                                                                                                       | Human                                   |

By the structural definition MyOrganiser **is** a light factory. Every stage
exists except automatic intake and agent merge.

### Where it goes further than the accounts read

- **Spec discipline.** No account read has anything like the PRD → slice → ADR → glossary chain. Most factories run on issue text alone.
- **Verification depth.** This is the area the sources call the bottleneck, and it is where most of the repository's tooling sits: fact-asserting gates, the outcome protocol, a validator-computed review verdict.
- **Risk-placed human review.** The Review Tier is a mechanical version of LaunchDarkly's "judgment where it has the most leverage".

### Where it differs, if the repository moved along the spectrum

1. **No automatic intake.** This is the main gap against the common definition. The smallest step would be auto-dispatching `ready-for-agent` + `type:afk` + `gate:mechanical` issues, or letting a `nightly-e2e` rot issue start a diagnosis-only run.
2. **Little real parallelism.** Sequential slices are a deliberate choice for safe local integration (ADR 0010). They cap throughput.
3. **No holdout scenarios.** Agents can read and edit the tests they are judged by. StrongDM's out-of-tree scenarios answer that, and vault and auth flows are where it would matter most.
4. **No factory metrics.** Vercel tracks factory share of merged PRs, issue close rate, and outcomes per run. The repository already has the raw signals (`ready-for-human` hand-offs, QA reports, review verdicts) but nothing turns a flawed run into an eval case.

### Where humans remain, and why that holds

Humans are required at: grilling and PRD seam approval, slice publication,
starting a dispatch, the batched decisions in `finish-standalone-runs` and
`address-pr-review`, `type:hitl` slices, `review:human` PRs, merge, and the
production reviewer approval. A dark factory would keep only the first.

For an end-to-end encrypted application, keeping humans on merge and on
`review:human` paths is consistent with the evidence read: autonomous PRs merge
far less often, and the one long dark run reported ended in a hard failure.

## Can an organisation rely on a dark factory?

Not as a product. Every vendor read (Factory.ai Droids and the tools in the
Firecrawl survey) stops at an open PR and leaves the merge to a person. Two
teams publicly claim to run a dark factory, and both carry caveats:

|                   | OpenAI Codex team ("harness engineering")                                                                      | StrongDM                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Claim             | About 1M lines in about five months, about 1,500 merged PRs, no human-written code, agents merge their own PRs | Humans neither write nor review code                                              |
| Where humans went | Review of a sample of PRs **after** merge, looking for systemic issues                                         | Specs and scenarios only                                                          |
| Caveats           | Self-reported; an internal beta product built by the model vendor itself; no follow-up numbers found           | No defect or production data; expects about $1,000 of tokens per engineer per day |

What the sources support is a **mostly dark** factory for a narrow class of
work, where all three of these hold:

1. a strong machine oracle exists (a failing reproduction, a typecheck, a scenario);
2. the blast radius is small;
3. the change is cheap to reverse (a feature flag, an automatic rollback).

Dependency bumps, lint debt, flaky tests, backports and small bugs with a
reproduction fit. Product judgment, security, cryptography and data migrations
do not. "The factory handles most of it" is achievable for most work **by
volume**, not for most decisions.

## Inner, outer and improvement loops

The sources draw the line between the loops in different places. CircleCI
splits fast checks from authoritative ones, Augment draws it at the push, and
Osmani at agent versus human. Gene Kim and Steve Yegge split by timescale. This
brief uses three loops:

| Loop        | Timescale     | Job                                                       | In MyOrganiser today                                                                                                                                                   |
| ----------- | ------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inner       | Minutes       | One task becomes a verified change                        | Strong: sandcastle container, affected-scope gate, `/code-review`, the `OUTSTANDING:` protocol ([ADR 0111](../adr/0111-a-prd-slice-closes-only-on-a-clean-outcome.md)) |
| Outer       | Hours to days | Queue → dispatch → PR → review → merge → deploy → monitor | All stages exist, but a human starts dispatch and makes every merge                                                                                                    |
| Improvement | Weeks         | Evidence from runs improves Skills, gates, evals and ADRs | Done by hand: ADRs written after failures, the monthly model audit, golden replay for the reviewer                                                                     |

**What joins the loops is the outcome contract.** The inner loop emits a
machine-readable verdict. Vercel's is success, flawed, blocked or manual. The
outer loop routes on it: merge, hand to a human, retry, or file an issue. The
improvement loop mines the flawed and blocked runs, plus defects that escaped,
into new eval cases or gates. In Vercel's factory every flawed run becomes a
new eval case. Here, a `ready-for-human` slice becomes nothing automatically.

Candidates to automate in this repository without making it autonomous:

1. **Label-triggered dispatch** for `type:afk` + `gate:mechanical` issues only. This needs a runner with Docker, because dispatch is local today ([RUNBOOK](../sandcastle/RUNBOOK.md)).
2. **Diagnosis-only runs** started by a [`nightly-e2e.yml`](../../.github/workflows/nightly-e2e.yml) rot issue or a CI failure. They post a reproduction and a brief, never code.
3. **Outcome metrics.** Clean versus `ready-for-human` rate by gate tier and complexity, human minutes per PR, and reverts.
4. **Flawed run → regression case.** Extend the golden-replay idea from the reviewer to slice runs.

Merge stays human, and `review:human` paths stay as they are.

## A dark-factory testbed repository

A sketch for a separate repository that tests the dark end of the spectrum. It
is not a plan for MyOrganiser.

1. **Choose the repository.** Greenfield, low stakes, no real user data, and nothing like the vault. The dark accounts read were greenfield or self-contained. LaunchDarkly's autonomy trap came from retrofitting onto legacy code.
2. **Port what is proven here.** Agent context (`AGENTS.md`, `CONTEXT.md`, ADRs), the PRD → slice → label contract ([ADR 0002](../adr/0002-agent-orchestration-label-vocabulary.md)), sandcastle dispatch, fact-asserting gates ([ADR 0043](../adr/0043-gates-assert-facts.md)), the outcome protocol, the Review Tier classifier, and agent-run QA ([ADR 0142](../adr/0142-a-standalone-runs-qa-is-run-by-agents-and-reported-on-its-pull-request.md)).
3. **Add what this repository deliberately lacks:**
   - automatic intake from webhooks or cron, with a dedup check;
   - a holdout scenario suite in a separate repository the agent can neither read nor edit, run as a required check;
   - auto-merge when every oracle is green and the Review Tier is `review:auto`;
   - feature flags with automatic rollback on a health signal;
   - review of a sample of merged PRs instead of pre-merge review;
   - parallel runs.
4. **Widen autonomy step by step.** Start fully dark only for `gate:mechanical`. Move a tier up only after its numbers hold for a fixed window, such as four weeks.
5. **Measure:**
   - escaped defects (caught later by holdouts or by a person);
   - revert rate;
   - share of runs ending manual or flawed;
   - tokens and cost per merged PR;
   - comprehension debt: periodically try to explain a module you never read.
6. **Set kill criteria before starting**, for example an escaped-defect rate above an agreed threshold, or a regression the holdouts missed.

## When agents write their own tests

In a dark factory the test suite becomes the only oracle (SpecBench's framing),
so this is the central risk.

1. **Correlated misunderstanding.** If one agent writes both the test and the code, both carry the same misreading of the requirement. Red-green only proves the code matches the test.
2. **Reward hacking.** Agents edit or delete failing tests, add `.skip`, weaken assertions, special-case the test input, or rewrite snapshots. Secondary summaries of 2026 studies report test modification as a main exploit for several model families, including Claude. Making tests read-only stopped that exploit, but not every other kind. An LLM review panel reportedly missed about 6.5% of confirmed hacks. These figures are unverified against the papers.
3. **Tautological or implementation-coupled tests** that pass by construction.

What MyOrganiser already has:

- The [TDD Skill](../../.agents/skills/tdd/SKILL.md) bans tautological tests (expected values come from an independent source), requires behaviour through public interfaces, and has a person confirm which behaviours to test. In AFK runs, the PRD seam approval plays that role.
- A separate agent, `TestReviewer`, gates tests before they run. The agent that wrote them does not mark its own work.

Gaps:

- **No mechanical check that a diff weakened tests.** Deleted tests, `.skip` or `.only`, a drop in assertion count, or snapshot rewrites in the same PR as the implementation could all route a PR to `review:human`.
- **No mutation testing.** [ADR 0004](../adr/0004-test-runner-pipeline.md) records a cheap model passing a mutation-testing checklist every time. A mutation run on changed files would make that check mechanical.
- **No locked acceptance tests** written before implementation, by a different agent or a person, and read-only to the implementer.

The testbed needs all three. MyOrganiser would benefit from the first two.

## Factories across repositories and teams

No account read describes a fully dark factory for a product that spans many
repositories owned by different teams. The multi-repo sources agree that
crossing a repository boundary is the main bottleneck for agents. Some teams
are merging services back into monorepos or modular monoliths to give agents a
full view. The four-layer model below is this brief's own synthesis of those
sources, not a pattern any single source describes.

### Why one repository is the easy case

In MyOrganiser one agent sees the backend, web, mobile, the OpenAPI spec and
the generated client. A contract change, its client and its callers land in
one PR checked by one CI (`openapi:check`, typecheck across projects). Split
the same product across an API repository, web repositories and mobile
repositories owned by different teams, and three things are lost:

1. **Atomicity.** A cross-cutting feature becomes several PRs that merge and deploy at different times.
2. **One view.** No agent sees all the code, and each team's orchestrator knows only its own repository.
3. **One oracle.** Each repository's CI passes while the product is broken where they connect.

Mobile adds a fourth: **old versions stay in use.** Users cannot be forced to
upgrade, and each store release passes a review outside the team's control. The
API must keep serving clients that are months old.

### Four layers

| Layer                      | What it holds                                                                                                                                                                                                                                                               | Who decides                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| L3 Initiative              | One cross-repository PRD split into per-repository slices with cross-repository `Blocked by` edges. An orchestrator agent holds the plan and the status, never the code. Tickets are the coordination channel                                                               | Product owner and affected team leads approve the initiative                           |
| L2 Contract                | A contracts repository or schema registry (OpenAPI, AsyncAPI, protobuf, event schemas), published as versioned packages, plus an organisation-wide glossary. Breaking-change checks on every contract change; consumer contract tests in every consumer's and provider's CI | Contract owners approve **breaking** changes; additive changes can merge automatically |
| L1 Repository factories    | One factory per repository, each like MyOrganiser today: an orchestrator, specialist sub-agents, gates, an outcome check                                                                                                                                                    | Can run dark for low-risk tiers, because that work does not cross a contract           |
| L0 Integration environment | An ephemeral full stack per initiative, holdout scenarios that span services and that no repository's agent can edit, stubs of services outside the change, feature flags with progressive rollout and automatic rollback                                                   | Owned outside every repository                                                         |

L2 is a scaled-up version of what MyOrganiser already does inside one
repository with `openapi:sync`, `openapi:check` and the generated
`app-api-client`. Teams align through the contract and the shared tickets,
not by reading each other's code.

### One feature, end to end

Example: a "shared lists" feature that needs the API, web, iOS and Android.

1. **Initiative PRD.** People approve it. The orchestrator splits it into a contract slice, an API slice, a web slice and two mobile slices, with dependency edges.
2. **Contract slice.** New endpoints and an event schema are additive, so the checks pass and it merges automatically. It publishes a new contracts version and the generated clients.
3. **API slice.** Implemented behind a flag using expand and contract, so old and new behaviour coexist. Provider contract tests prove it meets the new version.
4. **Client slices.** Three repository factories run in parallel. Each moves to the new client, builds behind the same flag, and runs consumer contract tests.
5. **Integration.** Cross-service holdout scenarios run against the assembled versions.
6. **Rollout.** Web and API flags open progressively with automatic rollback. Mobile ships through the stores, and a minimum-version rule decides when the feature turns on for each client.
7. **Contract cleanup, weeks later.** Removing the old behaviour is a breaking change. It needs human approval and waits until few enough users remain on old mobile versions.

Agents can carry steps 2–6 and most of 7. People decide at step 1, on the
breaking change, and on the mobile cut-off.

### Where people stay

| Decision                           | Why it does not automate away                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Initiative scope across teams      | Product judgment that costs several teams' capacity                                                     |
| Breaking contract changes          | They reach consumers whose code the changing team does not own, and old mobile versions cannot be fixed |
| Contract and glossary ownership    | Someone has to own what "correct" means between teams                                                   |
| Mobile release and minimum version | Store review, and a trade-off between users and support cost                                            |
| Holdout scenarios                  | Agents writing them would be grading their own work                                                     |
| Incidents across services          | No single repository factory sees the whole picture                                                     |

The realistic target for a multi-repository product is **dark repository
factories, joined by contracts, with people on the boundaries**.

### Consequence for the testbed

The testbed in [A dark-factory testbed repository](#a-dark-factory-testbed-repository)
should be **several repositories**, or it will not test the hard part. For
example: an API repository, a web repository, a mobile repository, a contracts
repository, and a scenarios repository that agents cannot write to.

- **Reuse from MyOrganiser:** the sub-agent fleet and orchestrator as each repository's factory; `to-prd` and `to-issues` as the starting point for the initiative orchestrator; the `openapi:check` drift-gate idea applied across repositories; the outcome protocol as the status each repository reports on its ticket.
- **New:** cross-repository ticket dependencies, consumer contract tests, the integration environment, and a minimum-version rule for mobile.
- **Measure separately:** integration failures that every repository's own CI missed. That number shows whether the contract layer works.

## Evaluating a factory

### Why merged-PR counts mislead

A count of merged PRs measures activity, not value. The sources read give five
reasons:

1. **Passing is not mergeable.** METR had maintainers of scikit-learn, Sphinx and pytest review 296 agent PRs that passed SWE-bench's automated grader. About half would not have been merged, roughly 24 percentage points below the grader's score. The agents could not iterate on review feedback, which METR flags as a limit of the study.
2. **Merged is not durable.** A study of about 110,000 open-source PRs reports that agent-authored code is rewritten or deleted faster than human code, and that larger agent changes churn more.
3. **Throughput rises while stability falls.** DORA's 2025 research, as reported in secondary coverage, links AI adoption to higher delivery throughput and also to more delivery instability. DORA added _rework rate_, the share of deployments that are unplanned bug-fix work, to its metrics in 2024.
4. **People misjudge their own speed.** In METR's early-2025 randomised trial, 16 experienced open-source developers took about 19% longer with AI. They had predicted a 24% speed-up, and afterwards still believed they had been about 20% faster. A separate trial at Google reports about 21% faster on a complex task, so the evidence conflicts. What it does show is that self-reported productivity is not evidence.
5. **The cost moves to review.** Agent volume becomes reviewer load. One analysis reports that only 55.7% of merged agent PRs in significant repositories had a human reviewer at all.

PR counts are also easy to inflate by splitting work. Published figures are
self-reported. Cursor's CEO has said that over a third of Cursor's merged PRs
come from autonomous agents. No source found supports a "1,000 PRs a month"
figure. These are adoption numbers, not evaluations.

### A scorecard

No source offers a settled framework. The scorecard below combines DORA's
throughput and instability split, Vercel's outcome taxonomy, and the
vendor-proposed agent metrics (Warp, Swarmia).

| Dimension     | Question                                    | Example measures                                                                                                                             |
| ------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Outcome       | Did the work matter, and does it stay done? | Issues resolved and not reopened; lead time from issue to production; share of the backlog closed by the factory (Vercel's measure)          |
| Durability    | Does the code survive?                      | Change failure rate; rework rate; churn of agent-authored lines within 14 and 30 days of merge; revert rate; defects traced back to a change |
| Autonomy      | How much happens without a person?          | Run outcomes (success, flawed, blocked, manual); clean first-pass rate; human intervention rate; changes merged without a human rewrite      |
| Human cost    | What does it cost people?                   | Human minutes per merged change (review, decisions, QA residue); decisions asked per run; review depth                                       |
| Machine cost  | What does it cost to run?                   | Tokens and money per **resolved issue** (not per PR), including runs that were thrown away                                                   |
| Oracle trust  | Can the checks be believed?                 | Reviewer escaped-defect and false-positive rates; mutation score of the tests; test-weakening incidents caught; holdout-scenario pass rate   |
| Comprehension | Is the codebase still understood?           | Periodic "explain this module" checks; architecture-boundary violations; documentation drift; post-merge sample audits                       |

Five rules apply to every measure:

1. **Pair throughput with stability.** A rise in throughput only counts if change failure, rework and churn hold. Warp's example: a low cost per PR with a high rollback rate is not a gain.
2. **Normalise by resolved work, not by PRs.** One issue split into five PRs is still one issue.
3. **Segment by work class.** Measure each gate tier and complexity level separately. Autonomy that works for `gate:mechanical` says nothing about `gate:full`.
4. **Compare to a baseline.** Measure people doing the same work class, over the same window, with the same definitions.
5. **Attribute.** Record whether each change came from an agent run, a person, or both. Without that, none of the measures above can be split.

For several repositories, add two measures: integration failures that every
repository's own CI missed, and contract changes that broke a consumer.

### What MyOrganiser can already measure

| Signal                                        | Source                                                                                                                               | Scorecard dimension                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Clean versus `ready-for-human` slice outcomes | `OUTSTANDING:` protocol ([ADR 0111](../adr/0111-a-prd-slice-closes-only-on-a-clean-outcome.md))                                      | Autonomy                                          |
| Reviewer misses                               | [`escaped-defect-rate.md`](../review/escaped-defect-rate.md), `yarn review:escaped:measure`                                          | Oracle trust                                      |
| Reviewer noise                                | [`effective-false-positive-rate.md`](../review/effective-false-positive-rate.md), `yarn review:noise:measure`                        | Oracle trust, human cost                          |
| Reviewer regression                           | [`golden-replay-results.md`](../review/golden-replay-results.md)                                                                     | Oracle trust                                      |
| What introduced a fix's defect                | `Introduced in #<PR>` lines enforced by `yarn fix:attribution:check`                                                                 | Durability: change failure per PR, agent or human |
| Agent QA results and "Left for a person"      | `<!-- qa-report -->` PR comments ([ADR 0142](../adr/0142-a-standalone-runs-qa-is-run-by-agents-and-reported-on-its-pull-request.md)) | Autonomy, human cost                              |
| CI duration                                   | `yarn ci:duration:measure`                                                                                                           | Machine cost                                      |

The reviewer already has the shape a factory metric needs: a kept-current
ledger, a defined measure backed by an ADR, and a command that produces it.
The fix-attribution lines are the most valuable unused signal. Every fix names
the PR that introduced the defect, so change failure per PR, split by agent or
human, can be computed from history.

Not yet measured:

- token and money cost per run;
- human minutes per change;
- churn and reverts of agent-authored code;
- a per-run outcome ledger that records success, flawed, blocked or manual against gate tier and complexity.

### Evaluating the testbed

1. **Set a baseline first.** Run the scorecard for several weeks with people, or with the light factory, on the same work classes.
2. **Change one thing at a time.** Make one work class dark and keep the others as they are.
3. **Use a fixed window.** Hold each step for a set period, such as four weeks, before reading the numbers.
4. **Promote or stop by rule.** Promote a work class only if durability and oracle trust hold against the baseline while human cost falls. Stop if escaped defects or rework rise beyond the kill criteria agreed beforehand.

Volume figures are reported alongside these measures, never instead of them.
