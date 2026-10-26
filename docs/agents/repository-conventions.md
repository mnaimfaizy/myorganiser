# Repository Conventions

Process rules moved out of the root [Agent Guide](../../AGENTS.md#do) so it stays short. Read the matching section before adding a file under `docs/`, committing a design, writing an ADR, or adding a `check-*.{mjs,ts}`. Each rule's source is the ADR it links.

## Notes have homes

Notes have homes, and there is no catch-all directory ([ADR 0041](../adr/0041-internal-notes-have-homes.md)). Planning and history belong in GitHub issues. Durable decisions belong in `docs/adr/`. User- and dev-facing feature behaviour belongs in `docs/features/`. Cited investigation belongs in `docs/research/`, date-prefixed (`YYYY-MM-DD-slug.md`) and frozen at that date — if it must stay current it is not research. Short-lived working files belong in `tmp/` (gitignored) and are never committed. `yarn docs:notes:check` enforces the directory names and the date prefix; Husky and CI run it.

## An approved design is committed

An approved design is committed under `docs/design/<design>/` before anything is built to it ([ADR 0110](../adr/0110-an-approved-design-is-committed-to-the-repo.md)): the design tool's export, byte for byte, with a README naming its source link, version, and every artboard. The committed copy is the design of record. A PRD, issue, or Pull Request that builds to a design links **both** the committed folder (a slice names the artboards it covers by path) **and** the tool link; the link alone reaches nobody who cannot sign in to it, which is every agent in the sandbox. A later change is re-exported and committed on its own.

## ADR numbering and status

ADRs in `docs/adr/` are numbered sequentially from `0001`. Scan for the highest existing number before adding one, then name the file `NNNN-lowercase-hyphen-slug.md`. A number is a claim until it merges and a fact afterwards ([ADR 0042](../adr/0042-adr-numbers-are-claims-until-merged.md)): if another pull request merges your number first, renumber yours; never renumber a merged ADR — supersede it. Gaps are legal. `yarn adr:numbering:check` asserts unique numbers and filename shape; Husky and CI run it. **Status follows the same line as the number**: an ADR is authored `accepted` and never `proposed`, exactly as it is authored with the number it claims rather than with a placeholder ([ADR 0097](../adr/0097-an-adr-is-authored-accepted.md)). `yarn adr:status:check` asserts that no ADR's status slot reads `proposed`, in either the `## Status` section form or the frontmatter form; Husky and CI run it. The previous rule — `proposed` while the pull request is open, flipped on merge — was itself written after four ADRs sat `proposed` on `main`, and five more did the same thing under it. A status flipped in a follow-up step is a status nobody flips, so ADR 0097 removes the step rather than restating the rule.

## An artifact asserts what it claims

An artifact states no claim it does not assert ([ADR 0085](../adr/0085-an-artifact-states-no-claim-it-does-not-assert.md)). A `check-*.{mjs,ts}` header **declares which direction(s) it asserts, and why any omitted direction is omitted** — and a contract suite proves the checker actually fails on the drift that header claims to catch. Neither half stands alone: the header is the specification, the test is what makes it true. Writing the direction down does not make it so, and a header nothing asserts rots like any other unasserted claim — `check-readme.mjs` declared "drift runs both ways" over code that ran one, in exactly the fixed form the convention asks for. The same rule on the page side: a House Explainer Page asserts the facts it states, or states less (see the `design-brief` Skill).
