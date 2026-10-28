# Grounding a design brief in source

Reached from `SKILL.md` step 3a, when the subject has a source of truth that could prove the brief
wrong.

A grounded brief is worth more than a template because it names things a reader can check: not "a
high iteration count" but `310,000`, not "a size limit" but `10 MB, scoped to envelope parsing`.
Producing those names is the work. This file is that procedure.

## 1. Find the real source, not the description of it

Start from the user's subject and locate the files that _implement_ it. Documentation is a lead,
never a citation. `docs/` describes intent at the time of writing; the brief must describe current
behaviour.

Where a doc and the source disagree, **the source wins and the disagreement is a finding**. Report
it to the user — a stale doc that contradicts the code is usually more valuable to them than the
diagram they asked for.

If locating the implementation would take three or more consecutive search calls, delegate to the
`CodeExplorer` sub-agent (`.github/agents/explore.agent.md`) with a Goal sentence.

## 2. Read the implementation

Read the files. Not the exports list, not the type signatures alone — the bodies, in the order
they execute.

Collect as you go:

- **Constants** — iteration counts, byte lengths, caps, limits, timeouts, retry counts, version
  numbers.
- **Identifiers a reader will type or grep** — storage keys, table and column names, endpoint
  paths, scopes, header names, label vocabularies.
- **Enumerations** — error codes, status values, event names, type unions. Take the _whole_ list;
  a brief that names four of nine error codes invites a diagram that looks complete and is not.
- **Ordering** — the actual sequence of phases, guards, and commits. Order is what a diagram is
  usually _for_, and it is the thing most often assumed rather than read.
- **The invariant nobody wrote down** — the thing that breaks badly if it drifts. Cross-platform
  format compatibility, a shared constant duplicated across two implementations, an ordering that
  looks arbitrary and is not.

Record `file:line` for every item as you collect it. Retrofitting citations later is how wrong
ones get written.

## 3. Run the collision check — mandatory

**For every constant name you intend to cite, search the repo for all definitions of that name.**

```bash
# For each collected constant, list every definition and its value
rg -n "CONSTANT_NAME" --glob '!node_modules'
```

Then, for each name, write down every distinct value found and the scope it applies to.

This step exists because it has already failed once. `VAULT_EXPORT_MAX_BYTES` was defined three
times — `10 * 1024 * 1024` in `libs/vault-core`, and `1024 * 1024` in both `libs/web/vault` and the
backend vault service — with a fourth, separate 10 MB cap on the audit endpoint. A brief written
from the first definition alone stated "10 MB hard limit" as a flat fact, and the Designer
faithfully rendered it onto a page presented as a security reference.

Those constants have since been renamed by scope (`VAULT_ENVELOPE_PARSE_MAX_BYTES`,
`VAULT_LEGACY_BUNDLE_MAX_BYTES`, `VAULT_EXPORT_PAYLOAD_MAX_BYTES`), so this particular trap is
closed. The procedure remains, because the next one will not be.

Rules that follow from that:

- A name with two values is **never** reported as one number. Report both, each with its scope.
- If you cannot determine which cap governs the path being drawn, trace the call chain until you
  can. "Probably the stricter one" is not a finding.
- Duplicate constants with different values are themselves worth surfacing to the user as a
  possible defect, separately from the brief.

## 4. Verify enumerations are complete

For each list you plan to cite, find its canonical definition and compare counts. A union type, a
`const` array, or an enum is the source; a switch statement or a doc table is a copy that may have
drifted.

Where the canonical list and a sibling definition disagree, report it. These divergences are
common and are exactly the kind of thing a diagram either exposes or entrenches.

## 5. Write the facts into the brief

Convert findings into brief content:

- **A constant becomes a claim with a scope.** Not "a 10 MB cap" but "10 MB, enforced on envelope
  text before parsing; the backend applies its own 1 MB cap to export payloads."
- **An ordering becomes a numbered sequence** with the guarantee it provides — for example that
  nothing is written until a final atomic commit, so a failure leaves existing state untouched.
- **An invariant becomes a hero or a named panel**, with the consequence of it breaking stated in
  user terms: not "the compatibility test fails" but "a user's mobile app can no longer open the
  vault their browser wrote."
- **An enumeration becomes the complete list**, or an explicit subset labelled as one.

## 6. Specify the manifest

Require the artifact to embed a single JSON block containing the constants it asserts, so a check
script can diff it against the exported source constants and fail when the picture drifts.

Requirements:

- **Scope-qualified key names.** `envelopeParseBytes` and `backendExportBytes`, never `maxBytes`.
  The ambiguity that a shared name creates in code creates the same ambiguity in the manifest.
- **Only values that exist as exported constants in source.** A manifest entry that cannot be
  imported and compared is decoration.
- **A stable id** naming the artifact, e.g. `id="vault-lifecycle-manifest"`.

Existing precedent to follow: `tools/scripts/check-agent-map.ts` asserts an embedded manifest
against `tools/config/agent-model-policy.json`, and `docs/agents/orchestration-map.html` carries
the corresponding block.

## Grounding Completion Criteria

- [ ] The implementation was read directly; no claim rests only on documentation.
- [ ] Every number, identifier, and error code has a `file:line`.
- [ ] Every constant name was searched repo-wide, and every distinct value is recorded with scope.
- [ ] Every cited enumeration was compared against its canonical definition.
- [ ] Execution order was read, not assumed.
- [ ] Contradictions — doc vs source, or constant vs constant — have been surfaced to the user.
- [ ] The manifest requirement uses scope-qualified names drawn from exported constants.
