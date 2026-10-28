# Out-of-Scope Knowledge Base

The `.out-of-scope/` directory keeps durable records of rejected enhancement concepts.

It serves two purposes:

1. Institutional memory for why a concept was rejected.
2. Deduplication when similar requests appear later.

## Directory structure

```text
.out-of-scope/
├── dark-mode.md
├── plugin-system.md
└── graphql-api.md
```

Use one file per concept, not one file per issue.

## File format

Write each file as a concise design note, not a database row.

```md
# Dark Mode

This project does not support dark mode or user-facing theming.

## Why this is out of scope

Explain architectural and product reasons with durable rationale.

## Prior requests

- #42 - Add dark mode support
- #87 - Night theme for accessibility
```

## Naming files

Use short kebab-case concept names such as `dark-mode.md`.

## Writing reasons

Prefer durable rationale:

- product scope and philosophy
- architecture constraints and tradeoffs
- strategic decisions already made

Avoid temporary rationale like "we are too busy right now".

## When to check `.out-of-scope/`

During triage context gathering:

1. Read `.out-of-scope/*.md`.
2. Match by concept similarity, not keyword overlap.
3. Surface matches to maintainer for confirmation.

Maintainer may confirm match, reconsider previous decision, or treat it as a distinct request.

## When to write `.out-of-scope/`

Only for rejected enhancements (`wontfix`).

Do not write here when closing as already implemented.

Flow:

1. Maintainer rejects enhancement as out of scope.
2. Find matching concept file.
3. Append new issue/PR link to existing file, or create a new file.
4. Comment with reasoning and link to concept file.
5. Close with `wontfix`.

## Reversals

If maintainers later reverse a prior rejection, update or remove the concept file and continue normal triage for the new request.
