# Upstream Brief adapter

The adapter is host facts only. The skill body does not name a host. A consuming repo may add `upstream-brief.config.yml` (also `.yaml` or `.json`) at the repository root. Missing file or missing keys use the defaults below.

## Lookup order

1. Repo-root `upstream-brief.config.yml` / `.yaml` / `.json`
2. Defaults in this file

## Keys

| Key                      | Required | Default                               | Meaning                                                                                                                                                                                                                                                         |
| ------------------------ | -------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version_record.path`    | no       | `package.json` if present, else unset | A file this repo maintains that records versions for humans (a tech-stack table, for example). The Baseline resolver only **compares** it against each Ecosystem's installed version and names a drift note on disagreement — never a source (ADR 0084 item 1). |
| `ecosystems`             | no       | none declared                         | A list of Ecosystem declarations. See below.                                                                                                                                                                                                                    |
| `declined_opportunities` | no       | none                                  | Upstream Opportunities a human said no to, remembered between runs. See below.                                                                                                                                                                                  |
| `instruction_globs`      | no       | See defaults                          | Repo-owned files that teach agents how to write code.                                                                                                                                                                                                           |
| `brief_dir`              | no       | `docs/research`                       | Directory for the Upstream Brief and the structured report committed beside it. Create it if missing.                                                                                                                                                           |
| `source_globs`           | no       | unset                                 | Optional application-code globs to _sample_ for mismatch evidence.                                                                                                                                                                                              |
| `script_globs`           | no       | unset                                 | Optional hygiene/test-script globs to _sample_.                                                                                                                                                                                                                 |
| `issue`                  | no       | unset                                 | When omitted, print a proposed issue and do not file.                                                                                                                                                                                                           |

### `ecosystems` entries

Each entry declares one Ecosystem (ADR 0084 item 2):

| Key              | Required | Meaning                                                                                                        |
| ---------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `lead`           | yes      | The lead package name. Its installed version is the Ecosystem's Baseline.                                      |
| `members.add`    | no       | Companion package names the lead's scope convention misses (an unscoped package such as `eslint-config-next`). |
| `members.remove` | no       | Companion package names to drop from the discovered set.                                                       |

Members are otherwise discovered by the lead's npm scope prefix: `nx` names companions
installed under `@nx/*`; a lead already scoped (`@remix-run/react`) names companions under its
own scope (`@remix-run/*`). The Baseline resolver — `.agents/skills/upstream-brief/baseline.mjs`
(dependency-free) plus `resolve-baseline.mjs` (its CLI) — ships inside the skill, like the report
validator. An Ecosystem whose lead is not installed fails closed with a reason and does not stop
the rest from resolving.

```yaml
ecosystems:
  - lead: nx
  - lead: next
    members:
      add: [eslint-config-next]
      remove: []
```

### `declined_opportunities` entries

An Upstream Opportunity a human declined, remembered so the next run does not propose it again
(ADR 0084 item 12). Suppression, resurfacing, and validation are [the ledger](LEDGER.md)'s.

| Key              | Required | Meaning                                                                           |
| ---------------- | -------- | --------------------------------------------------------------------------------- |
| `ecosystem`      | yes      | The lead package name of the Ecosystem it was proposed for. Part of its identity. |
| `url`            | yes      | The upstream page the Opportunity cited. Part of its identity.                    |
| `site`           | yes      | The local site path it named. Part of its identity.                               |
| `reason`         | yes      | One line: why not.                                                                |
| `baseline_range` | yes      | The Baseline range it was declined at — `22.x`, `16.2.6`, or `>=22.0.0 <23.0.0`.  |
| `quote`          | yes      | The upstream statement at the time, so a page that changes its mind is noticed.   |

```yaml
declined_opportunities:
  - ecosystem: nx
    url: https://nx.dev/concepts/inferred-tasks
    site: tools/scripts/check-component-hygiene.ts
    reason: the migration is tracked for next quarter, not this one
    baseline_range: '>=22.0.0 <23.0.0'
    quote: Inferred tasks keep project configuration in step with the tools actually installed.
```

A value runs to the end of its line, so a URL keeps its colons and a `#` is part of the value
rather than a comment. An entry is **suppressed** while the Baseline stays inside
`baseline_range` and the upstream quote is unchanged, and **resurfaces** when either moves — a
decline is about one suggestion at one version, not about the Ecosystem forever. `quote` is required
for that second axis to exist at all: without it nothing could ever lift the suppression except a
version bump.

An entry whose `ecosystem` is no longer declared, or whose `site` is no longer in the tree,
**fails** — it silences nothing and records a decision about something that is not there. In this
repository that failure is `yarn upstream:briefs:check`.

### `issue` map

| Key               | Meaning                                                      |
| ----------------- | ------------------------------------------------------------ |
| `tracker`         | `github`, `gitlab`, or `none`                                |
| `repository`      | Host `owner/name` when the tracker needs it                  |
| `labels.research` | Label for “this came from an Upstream Brief”                 |
| `labels.hitl`     | Label meaning a human must decide before an agent implements |

Two labels, and no third. A `labels.quality` role was mapped until ADR 0084 item 13 removed it:
in this repository it resolved to `qa`, which [ADR 0049](../../../docs/adr/0049-qa-and-grilling-are-orchestration-labels.md)
reserves for a QA Plan Issue, so a brief's issue arrived claiming to be something it was not. Do
not map a dependencies role either, and do not add `ready-for-agent`.

## Default `instruction_globs`

```yaml
instruction_globs:
  - AGENTS.md
  - CLAUDE.md
  - GEMINI.md
  - .github/copilot-instructions.md
  - .agents/skills/**/*.md
  - .claude/commands/*.md
```

Always exclude, even when a glob would match:

```text
node_modules/**
.yarn/**
vendor/**
.git/**
**/generated/**
```

Third-party skill install trees are not repo-owned. Do not add them to `instruction_globs`. If a hop shows an installed third-party skill contradicting upstream, record **follow-on**: update or pin that skill.

## Example

```yaml
version_record:
  path: package.json
ecosystems:
  - lead: nx
brief_dir: docs/research
# source_globs and script_globs omitted — instructions only
# issue omitted — print the proposal, do not file
# declined_opportunities omitted — nothing has been declined yet
```
