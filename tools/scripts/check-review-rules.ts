#!/usr/bin/env node
// Asserts that the bounded rule catalogue (tools/config/review-rules.json)
// still agrees with everything it is drawn from (issue #724).
//
//   node tools/scripts/check-review-rules.ts [--print]
//
// A finding's identity hashes its rule id, and the validator rejects an id the
// catalogue does not carry. That makes three kinds of drift expensive:
//
//   1. The catalogue says a word the finding contract does not — an axis, or a
//      severity cap or floor, that matches nothing. A cap or floor nobody can
//      compare against passes everything, which is the silent no-op shape
//      this repo keeps finding; so does a floor above its rule's cap, which
//      no finding can satisfy (ADR 0131). The same applies to a `cites` path
//      that no longer exists: a standards rule is only as good as the
//      document behind it.
//   2. The obligation family stops mirroring tools/config/review-obligations.json.
//      An obligation whose answer exposes a defect is written up as an ordinary
//      finding, and it has nothing to write it up as if the id is missing.
//   3. A brief stops offering the catalogue the reviewer selects from. Each
//      sub-agent reads one brief file and sees no other vocabulary (issue
//      #1031: a main agent that pasted the catalogue dispatched 22 of 37 ids).
//      So the brief for an axis offers exactly the ids the catalogue allows on
//      that axis. An id the catalogue has and the brief lacks cannot be
//      chosen. An id the brief has and the catalogue lacks, or allows only on
//      the other axis, produces a report the validator rejects whole — the
//      worst outcome available, because a rejected report is no report.
//   4. The two briefs stop carrying the same shared block. The finding
//      contract and the command rules are repeated in both files so that each
//      sub-agent makes one read; repeated text that nothing compares drifts.
//      A brief with no shared block is a finding too: two briefs that both
//      lost their markers would otherwise compare equal.
//
//   5. The skill stops printing the dispatch template the transcript reader
//      expects. `review/briefs.mjs` holds the template, and
//      `review/transcript-facts.mjs` reports a dispatch that differs from it
//      as steered. A template reworded in the skill alone would make every
//      correct dispatch read as steered, so each line of it, and the retry
//      line, must appear in SKILL.md verbatim.
//
// Direction, per source. Catalogue ↔ finding contract: catalogue words are
// checked against the contract, not the reverse — the contract's enums are
// the validator's own and need no second witness. Catalogue ↔ obligations and
// catalogue ↔ each brief: both ways. SKILL.md ← catalogue: one way. The skill
// no longer has to offer any id, so only an id it names that the catalogue
// lacks is a finding. briefs.mjs → SKILL.md for the template: one way, since
// the skill may say more around the template than the lines themselves. The
// shared block: compared for identity, and for
// carrying no rule id, which would offer one axis the other's vocabulary.
//
// Exit 0 = in sync. Exit 1 = drift. Exit 2 = the check could not run.
import { existsSync, readFileSync } from 'node:fs';

import {
  familyOf,
  loadRuleCatalogue,
  RULES_DISPLAY_PATH,
} from './review/rules.mjs';
import { BRIEFS, DISPATCH_TEMPLATES, RETRY_LINE } from './review/briefs.mjs';
import { isMain } from './review/cli.mjs';
import {
  FINDING_AXES,
  FINDING_SEVERITIES,
  SMELL_BASELINE_SOURCE,
} from './review/schema.mjs';

export const OBLIGATIONS = 'tools/config/review-obligations.json';
export const SKILL = '.agents/skills/code-review/SKILL.md';

// Re-exported: the brief paths live with the dispatch template in
// review/briefs.mjs, which the transcript reader shares.
export { BRIEFS };

export const SHARED_BLOCK_START = '<!-- shared-block:start -->';
export const SHARED_BLOCK_END = '<!-- shared-block:end -->';

/**
 * The text between a brief's shared-block markers, or `null` when it has
 * none. `null` is deliberately not the empty string: an absent block must
 * never compare equal to another absent block.
 */
export const sharedBlockOf = (text: string): string | null => {
  const start = text.indexOf(SHARED_BLOCK_START);
  const end = text.indexOf(SHARED_BLOCK_END);
  if (start === -1 || end === -1 || end < start) return null;
  return text.slice(start + SHARED_BLOCK_START.length, end);
};

/** The prefix an obligation's rule id carries, so the two lists line up. */
export const OBLIGATION_RULE_PREFIX = 'obligation-';

/**
 * An id-shaped code span. Backticks are required: the skill's prose never
 * writes a bare id, and matching bare words would make a sentence *about*
 * rules look like a rule.
 */
const ID_IN_PROSE = /`([a-z][a-z0-9-]*)`/g;

/**
 * The ids a document offers the reviewer, from `text` verbatim: every
 * id-shaped code span in it. `smell-baseline` is excluded by name — it is the
 * `source` string a smell finding carries, not a rule id, and it is shaped
 * like one.
 */
export const idsOfferedBy = (text: string): Set<string> =>
  new Set(
    [...text.matchAll(ID_IN_PROSE)]
      .map((m) => m[1])
      .filter((word) => word !== SMELL_BASELINE_SOURCE),
  );

/** One entry of the rule catalogue, as `tools/config/review-rules.json` writes it. */
export interface CatalogueRule {
  id: string;
  family: string;
  title: string;
  axes: string[];
  cites?: string;
  maxSeverity?: string;
  minSeverity?: string;
  fallback?: boolean;
}

/** The rule catalogue as its loader returns it. */
export interface RuleCatalogue {
  schemaVersion?: number;
  rules: CatalogueRule[];
}

/** The three documents the comparison reads, plus the path predicate. */
export interface RuleCatalogueSources {
  catalogue: RuleCatalogue;
  obligations: { id: string }[];
  skill: string;
  briefs: Record<string, string>;
  exists?: (path: string) => boolean;
}

// The two vocabularies, widened once. A rule's axes and severity fields are
// whatever the JSON carries, and deciding that one of them is not an axis or a
// severity is the point of the comparison below.
const AXES: readonly string[] = FINDING_AXES;
const SEVERITIES: readonly string[] = FINDING_SEVERITIES;

/**
 * Every disagreement, as one line each — empty when the catalogue is in step.
 * Pure: the caller supplies the three documents and the predicate that decides
 * whether a cited path exists, so a test can exercise the comparison without a
 * tree to break.
 */
export const compareRuleCatalogue = ({
  catalogue,
  obligations,
  skill,
  briefs,
  exists = existsSync,
}: RuleCatalogueSources): string[] => {
  const findings: string[] = [];
  const ids = catalogue.rules.map((r) => r.id);

  // 1. The finding contract's own vocabulary.
  for (const rule of catalogue.rules) {
    for (const axis of rule.axes) {
      if (!AXES.includes(axis))
        findings.push(`${rule.id}: axis "${axis}" is not a finding axis`);
    }
    if (rule.maxSeverity && !SEVERITIES.includes(rule.maxSeverity))
      findings.push(
        `${rule.id}: maxSeverity "${rule.maxSeverity}" is not a severity, so the cap can never fire`,
      );
    if (rule.minSeverity && !SEVERITIES.includes(rule.minSeverity))
      findings.push(
        `${rule.id}: minSeverity "${rule.minSeverity}" is not a severity, so the floor can never fire`,
      );
    else if (
      rule.minSeverity &&
      rule.maxSeverity &&
      SEVERITIES.includes(rule.maxSeverity) &&
      // FINDING_SEVERITIES runs most severe first.
      SEVERITIES.indexOf(rule.minSeverity) <
        SEVERITIES.indexOf(rule.maxSeverity)
    )
      findings.push(
        `${rule.id}: minSeverity "${rule.minSeverity}" is above maxSeverity "${rule.maxSeverity}", so no finding can satisfy both`,
      );
    if (rule.cites && !exists(rule.cites))
      findings.push(`${rule.id}: cites ${rule.cites}, which does not exist`);
  }

  // 2. The obligation family, in both directions.
  const unclaimed = new Set(
    ids.filter((id) => id.startsWith(OBLIGATION_RULE_PREFIX)),
  );
  for (const o of obligations) {
    const want = `${OBLIGATION_RULE_PREFIX}${o.id}`;
    if (!unclaimed.delete(want))
      findings.push(
        `${OBLIGATIONS} has obligation "${o.id}" with no "${want}" rule in ${RULES_DISPLAY_PATH}`,
      );
  }
  for (const orphan of unclaimed)
    findings.push(
      `${RULES_DISPLAY_PATH} has "${orphan}", which is no longer an obligation in ${OBLIGATIONS}`,
    );

  // 3. The brief each sub-agent actually reads, in both directions.
  const known = new Set(ids);
  const axesOf = new Map(catalogue.rules.map((r) => [r.id, r.axes]));
  const blocks: { path: string; block: string }[] = [];
  for (const [axis, path] of Object.entries(BRIEFS)) {
    const text = briefs[axis] ?? '';
    const offered = idsOfferedBy(text);
    for (const rule of catalogue.rules) {
      if (rule.axes.includes(axis) && !offered.has(rule.id))
        findings.push(
          `${rule.id}: in ${RULES_DISPLAY_PATH} but not offered by ${path}, so the ${axis} reviewer can never choose it`,
        );
    }
    for (const word of offered) {
      // Only words shaped like a catalogue id are judged. Anything else is
      // ordinary prose in backticks — a field name, a path, a command.
      // `familyOf` is that shape test, and reaching it rather than
      // re-spelling the families here is what stops a sixth family from
      // being silently unjudged (AGENTS.md, fan-out over a domain enum).
      if (!familyOf(word)) continue;
      if (!known.has(word))
        findings.push(
          `${path} offers "${word}", which is not in ${RULES_DISPLAY_PATH} — a report naming it is rejected whole`,
        );
      else if (!axesOf.get(word)?.includes(axis))
        findings.push(
          `${path} offers "${word}", which the catalogue does not allow on the ${axis} axis — a report naming it there is rejected whole`,
        );
    }

    // 4. The shared block.
    const block = sharedBlockOf(text);
    if (block === null) {
      findings.push(
        `${path} has no shared block (${SHARED_BLOCK_START} … ${SHARED_BLOCK_END}), so its sub-agent has no finding contract`,
      );
      continue;
    }
    blocks.push({ path, block });
  }
  const [first, ...rest] = blocks;
  for (const other of rest) {
    if (other.block !== first.block)
      findings.push(
        `the shared block differs between ${first.path} and ${other.path}; the finding contract and command rules must be the same text in both`,
      );
  }
  if (first) {
    for (const word of idsOfferedBy(first.block)) {
      if (familyOf(word))
        findings.push(
          `the shared block offers "${word}"; a rule id belongs in one axis's catalogue, not in text both axes read`,
        );
    }
  }

  // 5. The dispatch template, as the transcript reader will compare it.
  const templateLines = new Set([
    ...Object.values(DISPATCH_TEMPLATES).flat(),
    RETRY_LINE,
  ]);
  for (const line of templateLines) {
    if (!skill.includes(line))
      findings.push(
        `${SKILL} does not print the dispatch template line "${line}"; the transcript reader would report a dispatch that follows the skill as steered`,
      );
  }

  // The skill is the main agent's process. It offers no vocabulary any more,
  // but a main agent can still copy an id out of it into a report.
  for (const word of idsOfferedBy(skill)) {
    if (familyOf(word) && !known.has(word))
      findings.push(
        `${SKILL} offers "${word}", which is not in ${RULES_DISPLAY_PATH} — a report naming it is rejected whole`,
      );
  }

  return findings;
};

export const main = (argv = process.argv.slice(2)) => {
  const bail: (msg: string) => never = (msg) => {
    console.error(`review-rules: ${msg}`);
    process.exit(2);
  };

  for (const path of [OBLIGATIONS, SKILL, ...Object.values(BRIEFS)])
    if (!existsSync(path)) bail(`${path} not found`);
  // The table above is keyed by axis by hand; this is what a `satisfies`
  // clause would have said.
  for (const axis of FINDING_AXES)
    if (!BRIEFS[axis]) bail(`finding axis "${axis}" has no brief in BRIEFS`);
  for (const axis of Object.keys(BRIEFS))
    if (!AXES.includes(axis))
      bail(`BRIEFS names "${axis}", which is not a finding axis`);

  let catalogue: RuleCatalogue;
  try {
    catalogue = loadRuleCatalogue();
  } catch (err) {
    bail(err instanceof Error ? err.message : String(err));
  }
  const obligations = JSON.parse(readFileSync(OBLIGATIONS, 'utf8')).obligations;
  const skill = readFileSync(SKILL, 'utf8');

  if (argv.includes('--print')) {
    for (const rule of catalogue.rules) {
      const cap = rule.maxSeverity ? ` ≤${rule.maxSeverity}` : '';
      const floor = rule.minSeverity ? ` ≥${rule.minSeverity}` : '';
      const fallback = rule.fallback ? ' (fallback)' : '';
      console.log(
        `  ${rule.id}  [${rule.axes.join('|')}]${floor}${cap}${fallback} — ${rule.title}`,
      );
    }
  }

  const briefs = Object.fromEntries(
    Object.entries(BRIEFS).map(([axis, path]) => [
      axis,
      readFileSync(path, 'utf8'),
    ]),
  );

  const findings = compareRuleCatalogue({
    catalogue,
    obligations,
    skill,
    briefs,
  });
  if (findings.length) {
    console.error(
      `review-rules: ${findings.length} finding(s) — the rule catalogue is out of step`,
    );
    for (const f of findings) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log(
    `review-rules: OK — ${catalogue.rules.length} rule ids, ${obligations.length} mirrored obligations, each offered by its axis's brief, one shared block`,
  );
};

// Behind an isMain guard because the contract tests import the comparison from
// this file. Run at load, `main` exits the process the moment the catalogue and
// its sources disagree — so the tests would die before the first one ran, and
// precisely while the gate was doing its job.
if (isMain(import.meta.url)) main();
