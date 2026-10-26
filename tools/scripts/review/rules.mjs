/**
 * The rule catalogue: the bounded vocabulary a `/code-review` finding names as
 * the rule it applies (issue #724).
 *
 * A finding's identity has to be stable across runs and has to discriminate.
 * Free-form `rule` prose was stable at neither — the model reworded it every
 * run, so 38 of 38 consecutive reports persisted nothing (issue #718) — and
 * dropping it left `axis + source + file`, where one source (`smell-baseline`)
 * covered twelve separate rules and two distinct defects in one file collided.
 * A closed list the reviewer *selects* from is stable like an enum and
 * discriminates like prose, which is what this file is.
 *
 * Five families, each bounded by something that already exists:
 *
 *   smell          the twelve Fowler smells the Standards brief lists in full
 *                  (`Refactoring`, ch. 3). Capped at should-fix, because a
 *                  smell is a judgement call (ADR 0071 item 1).
 *   obligation     one per entry of `tools/config/review-obligations.json`,
 *                  the machine form of the Review Checklist. Ids are that
 *                  catalogue's ids with an `obligation-` prefix, and the gate
 *                  asserts the two lists stay equal.
 *   reach-through  the two checks the Standards brief runs against the whole
 *                  tree rather than the diff.
 *   standard       one per documented repo standard the reviewer applies.
 *                  Every entry `cites` the document that holds the rule, and
 *                  the gate asserts that document exists.
 *   spec           the three defect kinds the Spec brief asks for: a
 *                  requirement missing, behaviour nobody asked for, a
 *                  requirement implemented wrong.
 *
 * `standard-other` is the one fallback, and it is deliberate. A reviewer that
 * cannot name its finding has to be able to file it anyway: the record here is
 * that a report nobody writes costs more than a coarse one — golden replay run
 * 45 spent 26 of 81 turns on refused commands and produced no report at all
 * (docs/research/2026-09-10-the-answer-sheet-is-inert.md). A fallback finding
 * keeps the pre-#724 identity behaviour (coarse tuple, disambiguated within a
 * report by line order) and is a standing request for a catalogue entry.
 *
 * Everything here is pure except `loadRuleCatalogue`, which reads the file.
 * Cross-file agreement — obligation ids, cited documents, the ids each
 * axis's brief file offers its sub-agent — is asserted by
 * `tools/scripts/check-review-rules.ts`, not here.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const RULE_CATALOGUE_SCHEMA_VERSION = 1;

/** Repo-relative, for messages and for documents that name the file. */
export const RULES_DISPLAY_PATH = 'tools/config/review-rules.json';

/**
 * Resolved from this module, not from the working directory. The validator
 * runs from the repo root in CI and from wherever a person happens to stand
 * interactively; a cwd-relative path would make the finding contract depend
 * on which directory the reviewer was in.
 */
export const RULES_PATH = fileURLToPath(
  new URL('../../config/review-rules.json', import.meta.url),
);

export const RULE_FAMILIES = /** @type {const} */ ([
  'smell',
  'obligation',
  'reach-through',
  'standard',
  'spec',
]);

/** The prefix every id in a family carries, so an id names its own family. */
export const familyOf = (id) =>
  RULE_FAMILIES.find((family) => id.startsWith(`${family}-`));

const ID = /^[a-z0-9][a-z0-9-]*$/;

export class RuleCatalogueError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RuleCatalogueError';
  }
}

/**
 * Shape only. Axis and severity words are compared against the finding
 * contract's enums by the gate — this module stays a leaf so that
 * `schema.mjs` can depend on it without a cycle.
 */
export function assertRuleCatalogue(cat, source = RULES_DISPLAY_PATH) {
  const fail = (msg) => {
    throw new RuleCatalogueError(`${source}: ${msg}`);
  };
  if (cat?.schemaVersion !== RULE_CATALOGUE_SCHEMA_VERSION)
    fail(`unsupported schemaVersion ${cat?.schemaVersion}`);
  if (!Array.isArray(cat.rules) || cat.rules.length === 0)
    fail('rules must be a non-empty array');

  const ids = new Set();
  const fallbacks = new Map();
  for (const r of cat.rules) {
    const where = `rule ${r?.id ?? '(no id)'}`;
    if (typeof r?.id !== 'string' || !ID.test(r.id))
      fail(`${where}: id must be a lowercase slug`);
    if (ids.has(r.id)) fail(`duplicate rule id ${r.id}`);
    ids.add(r.id);
    if (!RULE_FAMILIES.includes(r.family))
      fail(`${where}: family must be one of ${RULE_FAMILIES.join(', ')}`);
    // The prefix is load-bearing: each brief file lists its axis's ids in
    // prose and the gate scans that prose for them, which only works if an
    // id announces its family rather than needing the catalogue to tell.
    if (familyOf(r.id) !== r.family)
      fail(`${where}: id must start with "${r.family}-"`);
    if (typeof r.title !== 'string' || !r.title.trim())
      fail(`${where}: title must be a non-empty string`);
    if (!Array.isArray(r.axes) || r.axes.length === 0)
      fail(`${where}: axes must name at least one axis`);
    if (new Set(r.axes).size !== r.axes.length)
      fail(`${where}: duplicate axes`);
    for (const axis of r.axes)
      if (typeof axis !== 'string' || !axis) fail(`${where}: bad axis`);
    if (r.maxSeverity !== undefined && typeof r.maxSeverity !== 'string')
      fail(`${where}: maxSeverity must be a severity word`);
    if (r.minSeverity !== undefined && typeof r.minSeverity !== 'string')
      fail(`${where}: minSeverity must be a severity word`);
    // A smell is inferred by construction, so its cap is not a per-entry
    // choice; leaving it off one of the twelve would quietly let that smell
    // block, which is the asymmetry ADR 0071 item 1 rules out.
    if (r.family === 'smell' && !r.maxSeverity)
      fail(`${where}: a smell caps at should-fix and must say so`);
    // A standards rule that names no document is unmoored: the reviewer cites
    // repo-authored text as its evidence, and this is where that text lives.
    if (r.family === 'standard' && (typeof r.cites !== 'string' || !r.cites))
      fail(`${where}: a standard rule must cite the document that holds it`);
    if (r.cites !== undefined && (typeof r.cites !== 'string' || !r.cites))
      fail(`${where}: cites must be a repo-relative path`);
    if (r.fallback !== undefined) {
      if (r.fallback !== true)
        fail(`${where}: fallback is either true or absent`);
      // Two fallbacks in one family is two ways to say "I could not name it",
      // and the reviewer would pick between them at random — which is the
      // free-form instability this catalogue exists to remove.
      if (fallbacks.has(r.family))
        fail(
          `${where}: ${r.family} already falls back to ${fallbacks.get(r.family)}`,
        );
      fallbacks.set(r.family, r.id);
    }
  }
  return cat;
}

/**
 * The label is `path` rather than the shipped catalogue's display path, and the
 * parse sits inside the try, so a caller reading some other file is told which
 * file broke. Labelling every failure `tools/config/review-rules.json` would
 * report the shipped catalogue as broken when the caller's own fixture is, and
 * a bare `SyntaxError` from a malformed catalogue — the likeliest hand-edit
 * failure — would name neither the file nor `RuleCatalogueError`, which this
 * module's header promises is how it reports failure. Both sibling loaders
 * (`loadGoldenSet`, `loadObligationCatalogue`) already pass their path through.
 */
export const loadRuleCatalogue = (path = RULES_PATH) => {
  const label = path === RULES_PATH ? RULES_DISPLAY_PATH : path;
  try {
    return assertRuleCatalogue(JSON.parse(readFileSync(path, 'utf8')), label);
  } catch (err) {
    if (err instanceof RuleCatalogueError) throw err;
    throw new RuleCatalogueError(`${label}: ${err.message}`);
  }
};

let cached;
/** The catalogue, read once. Every finding validated in a run shares it. */
export const ruleCatalogue = () => (cached ??= loadRuleCatalogue());

/** The entry for an id, or undefined — the validator's only lookup. */
export const ruleById = (id) =>
  ruleCatalogue().rules.find((r) => r.id === id) ?? undefined;

/** Every id, in catalogue order. */
export const ruleIds = () => ruleCatalogue().rules.map((r) => r.id);
