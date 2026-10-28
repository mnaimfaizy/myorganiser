/**
 * The golden set (ADR 0071, Consequences): incidents the repo already paid
 * for, written as the findings a reviewer should have raised, so a change to
 * the skill, the schema, the validator, the renderer, or the workflow can be
 * replayed against them before it reaches a Pull Request.
 *
 * A case names a real commit range from this repository's history and the
 * findings expected in a report about that range. An expected finding is
 * axis, source, rule, and file, where source and rule are patterns and file
 * is a set: the reviewer phrases a rule in the source's words, and the same
 * defect is fairly located at more than one of the files involved. `rule` is
 * a matching pattern only — it left the identity tuple in issue #718 because
 * the reviewer rewords it every run. Matching stays on those patterns: a case
 * is a historical measurement, and tightening it to one exact id would score
 * a reviewer that named the defect defensibly differently as a miss.
 *
 * The strict-tuple annotation is the part that must track the tuple, because
 * it claims the reviewer named the finding exactly: the same axis, rule id,
 * and file — the fields two findings must share to be one. An expectation
 * says whether it is literal enough to be a tuple by pinning `ruleId` to one
 * catalogue id (issue #724); an expectation that pins none is simply never
 * strict. The line a finding starts at is in a minted id since issue #940 and
 * is no part of this: no expectation can know it. Recall is matched over
 * expected.
 *
 * A case may instead be clean-diff (issue #933): a known-good merged Pull
 * Request that measures false alarms rather than recall. It carries
 * `expectsNoBlocking: true` and a `why` explaining what makes it a clean
 * choice — no later fix names it as root cause and its own review raised no
 * Blocking finding — in place of `expected` and `minRecall`, which the set
 * measures recall from and which a clean case has none of: there is nothing
 * to recall when nothing should have been found. `scoreCase` reports it as
 * `clean-pass` or `clean-fail`, never as a recall number, because averaging a
 * pass/fail measurement into a recall fraction would hide which kind failed.
 *
 * Everything here is pure; `score-golden-case.ts` reads files and exits.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { errorMessage } from '../lib/error-message.ts';
import type { CaseTier, ReplayMatrixEntry, ReplaySet } from './golden-tiers.ts';
import {
  CASE_TIERS,
  GOLDEN_SET_PATH,
  SCHEDULED_FRONTIER_REPETITIONS,
  SCHEDULE_EVENT,
  replayMatrix,
} from './golden-tiers.ts';
import type { StandingRecord } from './golden-standing.ts';
import { RULES_DISPLAY_PATH, ruleById } from './rules.ts';
import type { FindingAxis, FindingSeverity } from './schema.ts';
import { FINDING_AXES, FINDING_SEVERITIES } from './schema.ts';

/** Where a case came from (ADR 0130 item 1). */
export type CaseOrigin = (typeof ORIGINS)[number];

/**
 * One expected finding: the axis, the patterns the reviewer's own wording is
 * matched against, and the files at which the defect is fairly located.
 */
export interface ExpectedFinding {
  id: string;
  axis: FindingAxis | FindingAxis[];
  source: string;
  rule: string;
  ruleId?: string;
  files: string[];
  minSeverity?: FindingSeverity;
  why: string;
}

/** What every case carries, clean or pattern. */
interface GoldenCaseBase {
  id: string;
  title: string;
  incident: string;
  tier: CaseTier;
  tierEvidence?: string;
  base: string;
  head: string;
  origin: CaseOrigin;
  tag?: string;
  /**
   * `foundBy` is the reviewer's own envelope field, carried through from the
   * set so a replay hands the Spec axis the same shape production does. The
   * assertions below read `kind` and `ref` and nothing else.
   */
  spec:
    | { kind: 'none'; foundBy?: string }
    | { kind: 'issue'; ref: string; foundBy?: string };
  specSnapshot?: string;
  /** The pinned snapshot's title and body, read by `caseForReplay`. */
  specText?: { title: string; body: string };
}

/**
 * A clean-diff case (issue #933): it measures false alarms, so it carries no
 * expectation and no `minRecall` — there is nothing to recall when nothing
 * should have been found — and says instead why this merged pull request was
 * a clean choice.
 */
export interface CleanGoldenCase extends GoldenCaseBase {
  expectsNoBlocking: true;
  why: string;
}

/** A pattern case: the findings a reviewer should have raised, and the floor. */
export interface PatternGoldenCase extends GoldenCaseBase {
  expectsNoBlocking?: false;
  expected: ExpectedFinding[];
  minRecall: number;
}

export type GoldenCase = CleanGoldenCase | PatternGoldenCase;

/**
 * A case that left `cases` for a reserved bucket: `retired` with a `reason`
 * it cannot be won, `parked` with the `reentryCondition` that returns it.
 */
export interface ReservedEntry {
  id: string;
  title: string;
  incident: string;
  base?: string;
  head?: string;
  reason?: string;
  reentryCondition?: string;
}

export interface GoldenSet {
  schemaVersion: number;
  cases: GoldenCase[];
  parked?: ReservedEntry[];
  retired?: ReservedEntry[];
}

/**
 * A case, an expectation, or a reserved entry as it arrives from the file:
 * every field still unchecked. The assertions below are what turn one into
 * the validated shape above.
 */
type Candidate<T> = { [K in keyof T]?: unknown };
// Written out rather than mapped over `GoldenCase`: the two halves of that
// union disagree about `expectsNoBlocking`, so intersecting them to collect
// their keys collapses to `never` and every field read would then typecheck
// against nothing at all.
type GoldenCaseCandidate = {
  id?: unknown;
  title?: unknown;
  incident?: unknown;
  tier?: unknown;
  tierEvidence?: unknown;
  base?: unknown;
  head?: unknown;
  origin?: unknown;
  tag?: unknown;
  spec?: { kind?: unknown; ref?: unknown };
  specSnapshot?: unknown;
  expectsNoBlocking?: unknown;
  why?: unknown;
  expected?: unknown;
  minRecall?: unknown;
};
type ExpectedCandidate = Candidate<ExpectedFinding>;
type ReservedCandidate = Candidate<ReservedEntry>;

/** A normalized report, as a score reads it. */
export interface ScoredFinding {
  id: string;
  axis: string;
  source: string;
  rule: string;
  ruleId?: string;
  severity: string;
  location?: { file?: string } | null;
}
export interface ScoredReport {
  findings?: ScoredFinding[];
}

/** A clean case's result: a pass or a fail, never a recall number. */
export interface CleanScore {
  case: string;
  clean: true;
  blocking: string[];
  pass: boolean;
  outcome: 'clean-pass' | 'clean-fail';
}

/** A pattern case's result: recall over its expectations. */
export interface PatternScore {
  case: string;
  clean?: undefined;
  expected: number;
  matched: { expected: string; finding: string; strict: boolean }[];
  missed: string[];
  unexpected: number;
  recall: number;
  minRecall: number;
  pass: boolean;
}

export type CaseScore = CleanScore | PatternScore;

// The tier vocabulary and the set's location are declared once, in the
// dependency-free module the no-install replay job runs. This file may import
// that one; the reverse is not true, because this file reaches `zod` through
// schema.ts and the replay's `cases` job installs nothing. A tier added to
// only one of two hand-typed lists would let the filter accept a case the
// validator rejects — the same disagreement the single filter removed.
export const REVIEW_GOLDEN_SET_PATH = join(...GOLDEN_SET_PATH.split('/'));
export const GOLDEN_SET_SCHEMA_VERSION = 4;

/**
 * A case's tier decides how often it is replayed (ADR 0072).
 *
 * `frontier` is a case the reviewer misses. It is the reason to run the
 * replay at all, so it runs weekly when a reviewer input moved (ADR 0109).
 * `guard` is a case the reviewer catches reliably; it carries no new
 * information per run and exists only to catch a brief or contract edit
 * silently undoing something that works, so it runs monthly.
 *
 * The `tier` a case declares here is where it starts. Once the results
 * record holds ten scored runs of it, its catch rate over the last ten
 * decides where it stands (ADR 0116, golden-standing.ts), and the tier
 * filter follows the record. A case declared `guard` still cites, in
 * `tierEvidence`, the runs that put it there.
 */
export const GOLDEN_CASE_TIERS = CASE_TIERS;

const SHA = /^[0-9a-f]{40}$/;
const ID = /^[a-z0-9][a-z0-9-]*$/;

export class GoldenSetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoldenSetError';
  }
}

export const loadGoldenSet = (path: string = REVIEW_GOLDEN_SET_PATH) =>
  assertGoldenSet(JSON.parse(readFileSync(path, 'utf8')), path);

const compile = (pattern: string, where?: string) => {
  try {
    return new RegExp(pattern, 'i');
  } catch (err) {
    throw new GoldenSetError(
      `${where}: bad pattern ${pattern}: ${errorMessage(err)}`,
    );
  }
};

const ORIGINS = ['attributed', 'seeded'] as const;
const SEEDED_TAG = /^golden\/seeded-\d+-[a-z0-9][a-z0-9-]*$/;
const ISSUE_REF = /^#\d+$/;

/**
 * An attributed case is a real range in which an incident merged; its head is
 * reachable from main. A Seeded Case plants one defect on top of a real commit,
 * and a `golden/seeded-*` tag keeps that commit alive (ADR 0130 item 1).
 */
const assertCaseOrigin = (
  c: GoldenCaseCandidate,
  where: string,
  fail: (msg: string) => never,
) => {
  if (!(ORIGINS as readonly unknown[]).includes(c.origin))
    fail(`${where}: origin must be attributed or seeded`);
  if (
    c.origin === 'seeded' &&
    (typeof c.tag !== 'string' || !SEEDED_TAG.test(c.tag))
  )
    fail(
      `${where}: a seeded case must name its tag as golden/seeded-<issue>-<slug>`,
    );
  if (c.origin === 'attributed' && c.tag !== undefined)
    fail(
      `${where}: an attributed case's head is reachable from main and carries no tag`,
    );
};

/**
 * A case that measures the Spec axis reads the spec as the original review saw
 * it, from a committed snapshot, never a live fetch: a later edit can hand the
 * reviewer the answer (ADR 0130 item 5).
 */
const assertCaseSpec = (
  c: GoldenCaseCandidate,
  where: string,
  fail: (msg: string) => never,
  exists: (path: string) => boolean,
) => {
  const kind = c.spec?.kind;
  if (kind !== 'none' && kind !== 'issue')
    fail(`${where}: spec.kind must be none or issue`);
  if (kind === 'none') {
    if (c.specSnapshot !== undefined)
      fail(`${where}: a case with no spec carries no specSnapshot`);
    return;
  }
  if (typeof c.spec?.ref !== 'string' || !ISSUE_REF.test(c.spec.ref))
    fail(`${where}: spec.ref must be an issue reference like #123`);
  if (typeof c.specSnapshot !== 'string' || !c.specSnapshot)
    fail(`${where}: a case with an issue spec must pin specSnapshot`);
  if (!exists(c.specSnapshot))
    fail(`${where}: specSnapshot ${c.specSnapshot} does not exist`);
};

export function assertGoldenSet(
  set: unknown,
  source = 'golden set',
  { exists = existsSync }: { exists?: (path: string) => boolean } = {},
): GoldenSet {
  function fail(msg: string): never {
    throw new GoldenSetError(`${source}: ${msg}`);
  }
  const candidate = (set ?? {}) as {
    schemaVersion?: unknown;
    cases?: unknown;
    parked?: unknown;
    retired?: unknown;
  };
  if (candidate.schemaVersion !== GOLDEN_SET_SCHEMA_VERSION)
    fail(`unsupported schemaVersion ${candidate.schemaVersion}`);
  if (!Array.isArray(candidate.cases) || candidate.cases.length === 0)
    fail('cases must be a non-empty array');
  const cases = candidate.cases as GoldenCaseCandidate[];
  const ids = new Set<unknown>();
  for (const c of cases) {
    const where = `case ${c.id ?? '(no id)'}`;
    if (typeof c.id !== 'string' || !ID.test(c.id))
      fail(`${where}: id must be a lowercase slug`);
    if (ids.has(c.id)) fail(`duplicate case id ${c.id}`);
    ids.add(c.id);
    if (typeof c.title !== 'string' || !c.title) fail(`${where}: no title`);
    if (typeof c.incident !== 'string' || !c.incident)
      fail(`${where}: incident must cite the ADR or issue it comes from`);
    if (!(GOLDEN_CASE_TIERS as readonly unknown[]).includes(c.tier))
      fail(`${where}: tier must be one of ${GOLDEN_CASE_TIERS.join(', ')}`);
    // A guard runs on a narrower trigger than a frontier case, so the claim
    // that the reviewer catches it reliably has to be auditable from here.
    if (
      c.tier === 'guard' &&
      (typeof c.tierEvidence !== 'string' || !c.tierEvidence)
    )
      fail(`${where}: a guard must cite the runs that promoted it`);
    if (!SHA.test(String(c.base)) || !SHA.test(String(c.head)))
      fail(`${where}: base and head must be full 40-hex SHAs`);
    if (c.base === c.head) fail(`${where}: base equals head`);
    assertCaseOrigin(c, where, fail);
    assertCaseSpec(c, where, fail, exists);
    if (c.expectsNoBlocking === true) {
      // A clean case measures false alarms, not recall: it has nothing to
      // recall, so the two fields recall is computed from are the ones a
      // pattern case requires and a clean case must not carry — carrying
      // both would leave scoreCase to guess which kind of case this is.
      if (c.expected !== undefined)
        fail(
          `${where}: a clean case (expectsNoBlocking: true) must not carry expected — it has no findings to recall`,
        );
      if (c.minRecall !== undefined)
        fail(
          `${where}: a clean case (expectsNoBlocking: true) must not carry minRecall`,
        );
      if (typeof c.why !== 'string' || !c.why)
        fail(
          `${where}: a clean case must say why this merged pull request was chosen — that no later fix names it as root cause and its own review raised no Blocking finding`,
        );
    } else {
      if (c.why !== undefined)
        fail(
          `${where}: why belongs to a clean case (expectsNoBlocking: true); a pattern case's expectations each carry their own why`,
        );
      if (!Array.isArray(c.expected) || c.expected.length === 0)
        fail(`${where}: expected must be a non-empty array`);
      const expectedIds = new Set<unknown>();
      for (const e of c.expected as ExpectedCandidate[]) {
        const w = `${where}, expected ${e.id ?? '(no id)'}`;
        if (typeof e.id !== 'string' || !ID.test(e.id))
          fail(`${w}: id must be a lowercase slug`);
        if (expectedIds.has(e.id)) fail(`${w}: duplicate expected id`);
        expectedIds.add(e.id);
        // One axis, or several when either axis may raise the defect and the
        // one-axis drop decides which copy survives (ADR 0131 item 3).
        const axes: unknown[] = Array.isArray(e.axis) ? e.axis : [e.axis];
        if (
          axes.length === 0 ||
          !axes.every((a) => (FINDING_AXES as readonly unknown[]).includes(a))
        )
          fail(`${w}: axis ${e.axis}`);
        if (typeof e.source !== 'string') fail(`${w}: source pattern missing`);
        compile(e.source, w);
        if (typeof e.rule !== 'string') fail(`${w}: rule pattern missing`);
        compile(e.rule, w);
        // Optional, and a literal rather than a pattern: it is hashed, not
        // matched. An id the catalogue does not carry could never be minted
        // by the validator, so an expectation naming one would annotate
        // `strict` false for ever and read as a reviewer that keeps missing
        // the tuple.
        if (e.ruleId !== undefined) {
          if (typeof e.ruleId !== 'string' || !ruleById(e.ruleId))
            fail(`${w}: ruleId ${e.ruleId} is not in ${RULES_DISPLAY_PATH}`);
        }
        if (!Array.isArray(e.files) || e.files.length === 0)
          fail(`${w}: files must name at least one path`);
        if (
          e.minSeverity &&
          !(FINDING_SEVERITIES as readonly unknown[]).includes(e.minSeverity)
        )
          fail(`${w}: minSeverity ${e.minSeverity}`);
        if (typeof e.why !== 'string' || !e.why)
          fail(`${w}: why must say what went wrong in the incident`);
      }
      if (typeof c.minRecall !== 'number' || c.minRecall < 0 || c.minRecall > 1)
        fail(`${where}: minRecall must be between 0 and 1`);
    }
  }
  // A set with no frontier case measures nothing on an ordinary review-tooling
  // change: guards run only when the brief or the finding contract moves, so an
  // empty frontier means a pull request touching the review scripts or the
  // reviewer action replays nothing at all. ADR 0072 said this in its
  // Consequences and claimed the tests asserted it; nothing did, until here.
  // The rule it constrains is promotion: declaring the last frontier case a
  // guard disables the arm it belongs to. Declare it alongside a replacement,
  // never before one exists. Promotion by the record is held to the same rule
  // in golden-standing.ts (ADR 0116).
  if (cases.length > 0 && !cases.some((c) => c.tier === 'frontier'))
    fail(
      'the set has no frontier case: an empty frontier replays nothing on an ' +
        'ordinary review-tooling change (ADR 0072). Promote the last frontier ' +
        'case only alongside a replacement, never before one exists.',
    );
  // A case leaves `cases` for one of two reserved buckets, and both are kept,
  // not deleted, so the id cannot be silently re-added. Retirement says a case
  // cannot be won: a wired gate already suppresses its defect (ADR 0074), so it
  // carries `reason`. Parking says the opposite — a case is merely hard, still
  // never caught, with no reason to think it unwinnable — so filing it as
  // retired would be a lie in the field that state exists to keep honest, and
  // it carries `reentryCondition` instead: not why the case cannot be won, but
  // the written, checkable fact that returns it to `cases`. The shape the two
  // buckets share is asserted by one helper so a field added to one cannot
  // drift from the other.
  const assertReservedEntry = (
    entry: ReservedCandidate,
    bucket: string,
    narrativeField: 'reason' | 'reentryCondition',
    narrativeMustSay: string,
  ) => {
    const where = `${bucket} ${entry.id ?? '(no id)'}`;
    if (typeof entry.id !== 'string' || !ID.test(entry.id))
      fail(`${where}: id must be a lowercase slug`);
    if (ids.has(entry.id))
      fail(`${entry.id} is already a case, retired, or parked entry`);
    ids.add(entry.id);
    if (typeof entry.title !== 'string' || !entry.title)
      fail(`${where}: no title`);
    if (typeof entry.incident !== 'string' || !entry.incident)
      fail(`${where}: incident must cite the ADR or issue it comes from`);
    if (typeof entry[narrativeField] !== 'string' || !entry[narrativeField])
      fail(`${where}: ${narrativeField} must ${narrativeMustSay}`);
    if (entry.base !== undefined && !SHA.test(String(entry.base)))
      fail(`${where}: base must be a full 40-hex SHA`);
    if (entry.head !== undefined && !SHA.test(String(entry.head)))
      fail(`${where}: head must be a full 40-hex SHA`);
  };
  if (candidate.parked !== undefined) {
    if (!Array.isArray(candidate.parked)) fail('parked must be an array');
    for (const p of candidate.parked as ReservedCandidate[])
      assertReservedEntry(
        p,
        'parked',
        'reentryCondition',
        'say what returns this case to cases',
      );
  }
  if (candidate.retired !== undefined) {
    if (!Array.isArray(candidate.retired)) fail('retired must be an array');
    for (const r of candidate.retired as ReservedCandidate[])
      assertReservedEntry(
        r,
        'retired',
        'reason',
        'say why the case cannot be won',
      );
  }
  return candidate as GoldenSet;
}

const severityRank = (s: string) =>
  (FINDING_SEVERITIES as readonly string[]).indexOf(s);
/** blocking (0) is the most severe, so "at least should-fix" means rank ≤ 1. */
const atLeast = (severity: string, min?: FindingSeverity) =>
  !min || severityRank(severity) <= severityRank(min);

/**
 * Did the finding name the rule the expectation is about? Two ways, and either
 * is enough.
 *
 * The prose patterns are the historical way and stay, for the reason the module
 * header gives: a case is a historical measurement, and requiring one exact id
 * would score a reviewer that named the defect defensibly differently as a miss.
 *
 * The pinned `ruleId` is the second way, added with the bounded catalogue
 * (issue #724). It is a widening, never a tightening: a reviewer that picked the
 * very id the expectation pins has named the rule exactly, and it would be
 * perverse to score that a miss because its `source` or `rule` wording drifted
 * off a keyword alternation. That drift is not hypothetical — rewording is what
 * took `rule` out of the identity tuple in issue #718 — and leaving recall to
 * rest on it alone is what makes the free-form text decide a measurement it is
 * not supposed to decide (issue #724: the rule text feeds no decision).
 *
 * `strict` stays meaningful because this is not what it reads: matching never
 * requires the id, so an expectation can still be matched loosely and annotated
 * not-strict, which is the distinction the annotation exists to report.
 */
const namesTheRule = (expected: ExpectedFinding, finding: ScoredFinding) =>
  (expected.ruleId !== undefined && finding.ruleId === expected.ruleId) ||
  (compile(expected.source).test(finding.source) &&
    compile(expected.rule).test(finding.rule));

const axesOf = (expected: ExpectedFinding): FindingAxis[] =>
  Array.isArray(expected.axis) ? expected.axis : [expected.axis];

const matches = (expected: ExpectedFinding, finding: ScoredFinding) =>
  (axesOf(expected) as string[]).includes(finding.axis) &&
  namesTheRule(expected, finding) &&
  expected.files.includes(finding.location?.file ?? '') &&
  atLeast(finding.severity, expected.minSeverity);

/**
 * A clean case (issue #933) passes when the report carries no Blocking
 * finding, whatever else it says — there is no expectation to recall, so the
 * result is a pass/fail, reported as `clean-pass` or `clean-fail` and never
 * folded into a recall number the way a pattern case's match count is.
 *
 * @param goldenCase a clean case (`expectsNoBlocking: true`)
 * @param normalized the validator's output for that range
 */
const scoreCleanCase = (
  goldenCase: GoldenCase,
  normalized: ScoredReport,
): CleanScore => {
  const findings = normalized.findings ?? [];
  const blocking = findings.filter((f) => f.severity === 'blocking');
  const pass = blocking.length === 0;
  return {
    case: goldenCase.id,
    clean: true,
    blocking: blocking.map((f) => f.id),
    pass,
    outcome: pass ? 'clean-pass' : 'clean-fail',
  };
};

/**
 * The two shapes are paired in the signature, because they are paired in
 * fact: a clean case has no recall to report and a pattern case always has
 * one, and a caller that knows which kind it holds should not have to ask
 * the result which it got.
 *
 * @param goldenCase one entry of `cases`
 * @param normalized the validator's output for that range
 */
export function scoreCase(
  goldenCase: CleanGoldenCase,
  normalized: ScoredReport,
): CleanScore;
export function scoreCase(
  goldenCase: PatternGoldenCase,
  normalized: ScoredReport,
): PatternScore;
export function scoreCase(
  goldenCase: GoldenCase,
  normalized: ScoredReport,
): CaseScore;
export function scoreCase(
  goldenCase: GoldenCase,
  normalized: ScoredReport,
): CaseScore {
  if (goldenCase.expectsNoBlocking)
    return scoreCleanCase(goldenCase, normalized);
  const findings = normalized.findings ?? [];
  const used = new Set<string>();
  const matched: PatternScore['matched'] = [];
  const missed: string[] = [];
  for (const expected of goldenCase.expected) {
    const hit = findings.find((f) => !used.has(f.id) && matches(expected, f));
    if (!hit) {
      missed.push(expected.id);
      continue;
    }
    used.add(hit.id);
    // Did the reviewer name the very rule the expectation pins? Only an
    // expectation literal enough to pin a `ruleId` can be strict (issue
    // #724). The file is already equal and the axis one the expectation names
    // — `matches` required both — so the rule id is all that is left of the fields two findings
    // must share to be one (`FINDING_MATCH_FIELDS`). This compared a
    // recomputed id until issue #940 put the start line in a minted id, which
    // no expectation can know.
    const strict =
      expected.ruleId !== undefined && hit.ruleId === expected.ruleId;
    matched.push({ expected: expected.id, finding: hit.id, strict });
  }
  const recall = matched.length / goldenCase.expected.length;
  return {
    case: goldenCase.id,
    expected: goldenCase.expected.length,
    matched,
    missed,
    unexpected: findings.length - matched.length,
    recall,
    minRecall: goldenCase.minRecall,
    pass: recall >= goldenCase.minRecall,
  };
}

const renderCleanScore = (goldenCase: GoldenCase, score: CleanScore) => {
  const lines = [
    `## Golden replay — ${goldenCase.id}: ${score.outcome}`,
    '',
    `${goldenCase.title} (${goldenCase.incident}). Range \`${goldenCase.base.slice(0, 7)}...${goldenCase.head.slice(0, 7)}\`.`,
    '',
    score.pass
      ? 'Clean pass: the reviewer raised no Blocking finding.'
      : `Clean fail: ${score.blocking.length} Blocking finding(s) on a case expected to raise none.`,
    '',
  ];
  for (const id of score.blocking) lines.push(`- **blocking** \`${id}\``);
  return `${lines.join('\n')}\n`;
};

export const renderScore = (goldenCase: GoldenCase, score: CaseScore) => {
  if (score.clean) return renderCleanScore(goldenCase, score);
  // A pattern score belongs to a pattern case: `scoreCase` returns the clean
  // shape for a clean one, so the branch above has already taken it.
  const expectations = goldenCase.expectsNoBlocking ? [] : goldenCase.expected;
  const lines = [
    `## Golden replay — ${goldenCase.id}: ${score.pass ? 'pass' : 'FAIL'}`,
    '',
    `${goldenCase.title} (${goldenCase.incident}). Range \`${goldenCase.base.slice(0, 7)}...${goldenCase.head.slice(0, 7)}\`.`,
    '',
    `Recall ${score.matched.length}/${score.expected} (minimum ${score.minRecall}); ${score.unexpected} other finding(s).`,
    '',
  ];
  for (const m of score.matched)
    lines.push(
      `- matched \`${m.expected}\` by finding \`${m.finding}\`${m.strict ? ' (exact tuple)' : ''}`,
    );
  for (const id of score.missed) {
    const e = expectations.find((x) => x.id === id)!;
    lines.push(`- **missed** \`${id}\`: ${e.why}`);
  }
  return `${lines.join('\n')}\n`;
};

/**
 * The replay's own classification of a failed answer sheet (ADR 0101), read
 * off the workflow text rather than trusted to it.
 *
 * Production fails `Agent Review Ran` on an answer sheet whose quotations do
 * not hold up against the tree at head (ADR 0078). A replay that does not run
 * that check scores the same run as a miss — run 35833576958 did, on a
 * citation read from the pull request's checkout instead of the case head —
 * so the step running it is load-bearing, and deleting it would pass every
 * other check here. Four things are asserted, each one a way the void comes
 * back as a miss: the check runs; it runs before the score, so a failed sheet
 * stops the score from running at all; it reads the report, as production
 * does; and neither step opts out of that ordering — the check by continuing
 * on error, the score by an `if:` that runs it after a failure.
 *
 * Steps are found by their `- name:` lines, and a step's block is everything
 * up to the next line at the same or a shallower indent. That is enough for a
 * workflow this repository writes, and it avoids adding a YAML parser to a
 * checker whose only other input is JSON.
 *
 * A step runs a script either by its package script or by the file that
 * script names. The replay uses the file: its working tree is the case head,
 * whose package.json predates the review scripts, so it runs them from an
 * extracted copy of the pull request's tooling (ADR 0102). Matching only the
 * package script would report a check that runs as one that does not.
 */
export const REPLAY_OBLIGATION_CHECK = 'review:obligations:check';
export const REPLAY_SCORE = 'review:golden:score';
// The file form must be an invocation, not a mention: the step that extracts
// the tooling names the checker in its `git archive` line, and loading a case
// runs the scorer with `--show`, which scores nothing. The checker may be run
// directly or through run-from-tooling.ts, which the replay uses so it reads
// the workspace's repository from the tooling copy.
const REPLAY_OBLIGATION_CHECK_RUN =
  /\bnode\s+(?:\S*run-from-tooling\.ts"?\s+)?\S*check-review-obligation-answers\.ts\b/;
const REPLAY_SCORE_RUN = /\bnode\s+\S*score-golden-case\.ts\s+--case\b/;

const runs = (body: string, script: string, invocation: RegExp) =>
  body.includes(script) || invocation.test(body);

const workflowSteps = (text: string) => {
  const lines = text.split('\n');
  const steps: { name: string; body: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)- name: (.+)$/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    let end = i + 1;
    while (end < lines.length) {
      const line = lines[end];
      if (line.trim() !== '' && line.search(/\S/) <= indent) break;
      end++;
    }
    steps.push({ name: m[2].trim(), body: lines.slice(i, end).join('\n') });
  }
  return steps;
};

export const replayObligationCheckFindings = (
  workflowText: string,
): string[] => {
  const steps = workflowSteps(workflowText);
  const check = steps.findIndex((s) =>
    runs(s.body, REPLAY_OBLIGATION_CHECK, REPLAY_OBLIGATION_CHECK_RUN),
  );
  const score = steps.findIndex((s) =>
    runs(s.body, REPLAY_SCORE, REPLAY_SCORE_RUN),
  );
  const findings: string[] = [];
  if (check === -1)
    return [
      `no step runs ${REPLAY_OBLIGATION_CHECK}, so an answer sheet production would fail is scored as a result (ADR 0101)`,
    ];
  if (score === -1) return [`no step runs ${REPLAY_SCORE}`];
  const c = steps[check];
  const s = steps[score];
  if (check > score)
    findings.push(
      `"${c.name}" runs after "${s.name}", so a void is scored before it is recognised (ADR 0101)`,
    );
  if (!/--report\s/.test(c.body))
    findings.push(
      `"${c.name}" does not pass --report, so a self-contradiction is read from the sheet's own declaration, not the report (ADR 0078 item 4)`,
    );
  if (/^\s*continue-on-error:\s*true\b/m.test(c.body))
    findings.push(
      `"${c.name}" continues on error, so a failed answer sheet does not stop the score (ADR 0101)`,
    );
  if (/^\s*if:/m.test(s.body))
    findings.push(
      `"${s.name}" carries an if:, which can run it after a failed answer sheet and score a void as a miss (ADR 0101)`,
    );
  return findings;
};

/**
 * The replay's classification of a review that did not run as built (ADR
 * 0123 item 7), read off the workflow text like the answer-sheet check above.
 *
 * Production fails `Agent Review Ran` when the validator records a run
 * failure in the normalized report: no sub-agent read an axis's brief, or a
 * reported finding is not one a sub-agent returned. A replay that scores such
 * a run records a miss or a catch for a reviewer that was not the one this
 * set measures. Three things are asserted: a step reads the failures out of
 * the normalized report; it runs before the score and does not continue on
 * error, so a failed run stops the score; and the step that records the
 * result hands the normalized report to the recorder, which is where the
 * line's CLI version and tightening facts come from.
 *
 */
const REPLAY_RUN_FAILURES_READ = /\.runFacts\.failures\b/;
const REPLAY_RECORD_RUN = /\bnode\s+\S*record-golden-result\.ts\b/;

export const replayRunFactsFindings = (workflowText: string): string[] => {
  const steps = workflowSteps(workflowText);
  const check = steps.findIndex((s) => REPLAY_RUN_FAILURES_READ.test(s.body));
  const score = steps.findIndex((s) =>
    runs(s.body, REPLAY_SCORE, REPLAY_SCORE_RUN),
  );
  const record = steps.find((s) => REPLAY_RECORD_RUN.test(s.body));
  const findings: string[] = [];
  if (check === -1)
    findings.push(
      'no step reads .runFacts.failures from the normalized report, so a review that did not run as built is scored as a result (ADR 0123 item 7)',
    );
  else if (score !== -1) {
    const c = steps[check];
    if (check > score)
      findings.push(
        `"${c.name}" runs after "${steps[score].name}", so a void is scored before it is recognised (ADR 0101)`,
      );
    if (/^\s*continue-on-error:\s*true\b/m.test(c.body))
      findings.push(
        `"${c.name}" continues on error, so a review that did not run as built does not stop the score (ADR 0101)`,
      );
  }
  if (!record) findings.push('no step runs record-golden-result.ts');
  else if (!/--normalized\b/.test(record.body))
    findings.push(
      `"${record.name}" does not pass --normalized, so no result line carries the CLI version or the tightening facts (ADR 0123 item 7)`,
    );
  return findings;
};

/** The label that asks for a replay on a Pull Request (ADR 0109). */
export const REPLAY_REQUEST_LABEL = 'golden-replay';

// A top-level YAML block: from `key:` to the next line that starts in column 0.
const topLevelBlock = (text: string, key: string) => {
  const m = new RegExp(
    String.raw`^${key}:[^\n]*\n((?:[ \t#][^\n]*\n|\n)*)`,
    'm',
  ).exec(text);
  return m ? m[1] : null;
};

// A key two spaces in, inside the on: block, to the next key at that depth.
// A comment line at any indentation belongs to the block it sits in, as YAML
// reads it, so a comment between two keys cannot hide the second from it.
const triggerBlock = (onBlock: string, key: string) => {
  const m = new RegExp(
    String.raw`^  ${key}:[^\n]*\n((?:(?: {3,}|[ \t]*#)[^\n]*\n|\n)*)`,
    'm',
  ).exec(onBlock);
  return m ? m[1] : null;
};

/**
 * Whether the replay runs when ADR 0109 says it does and at no other time: on
 * a weekly schedule that asks which reviewer inputs moved, on the
 * `golden-replay` Request Label, and by dispatch — never on a push to a Pull
 * Request. Text-based like replayObligationCheckFindings; the workflow is
 * this repository's own and its shape is known.
 *
 * @param workflowText
 * @returns one line per violation; empty when sound
 */
export const replayTriggerFindings = (workflowText: string): string[] => {
  const on = topLevelBlock(workflowText, 'on');
  if (on === null) return ['no top-level on: block'];
  const findings: string[] = [];
  const pr = triggerBlock(on, 'pull_request');
  if (pr !== null) {
    if (/^\s*paths(-ignore)?:/m.test(pr))
      findings.push(
        'pull_request carries a paths filter, so every push to a Pull Request touching a reviewer input buys a replay (ADR 0109)',
      );
    const types = /^\s*types:\s*\[([^\]]*)\]/m.exec(pr);
    const listed = types ? types[1].split(',').map((t) => t.trim()) : [];
    if (listed.length !== 1 || listed[0] !== 'labeled')
      findings.push(
        'pull_request must list only types: [labeled]; any other type replays on pushes rather than on request (ADR 0109)',
      );
    if (
      !workflowText.includes(
        `github.event.label.name == '${REPLAY_REQUEST_LABEL}'`,
      )
    )
      findings.push(
        `nothing skips a label other than ${REPLAY_REQUEST_LABEL}, so any other label on the Pull Request buys a replay`,
      );
    const concurrency = topLevelBlock(workflowText, 'concurrency') ?? '';
    if (
      !concurrency.includes(
        `github.event.label.name != '${REPLAY_REQUEST_LABEL}'`,
      )
    )
      findings.push(
        `the concurrency group does not steer other labels out, so adding any label cancels a replay in flight`,
      );
  }
  if (triggerBlock(on, 'schedule') === null)
    findings.push(
      'no schedule trigger, so nothing measures the reviewer unless somebody asks (ADR 0109)',
    );
  if (triggerBlock(on, 'workflow_dispatch') === null)
    findings.push(
      'no workflow_dispatch trigger, so a tier cannot be replayed on demand (ADR 0072 item 4)',
    );
  if (!/golden-tiers\.ts --scheduled\b/.test(workflowText))
    findings.push(
      'the schedule never runs golden-tiers.ts --scheduled, so it replays an untouched reviewer every week (ADR 0109)',
    );
  return findings;
};

/**
 * Whether the scheduled replay repeats each frontier case the number of
 * times ADR 0116 decides, and a label or a dispatch stays one repetition
 * (ADR 0072 item 8). Two halves, because the count is computed in one place
 * and spent in another: the matrix golden-tiers.ts prints for this set, and
 * the workflow that has to ask for that matrix, hand it the event, and keep
 * each repetition's result apart.
 *
 * @param workflowText
 * @param set
 * @param records the results record
 * @returns one line per violation; empty when sound
 */
export const replayRepetitionFindings = (
  workflowText: string,
  set: ReplaySet,
  records: StandingRecord[] = [],
): string[] => {
  const findings: string[] = [];
  const count = (matrix: ReplayMatrixEntry[], id: string) =>
    matrix.filter((m) => m.case === id).length;
  const scheduled = replayMatrix(set, undefined, {
    records,
    event: SCHEDULE_EVENT,
  });
  const frontier = new Set(
    replayMatrix(set, 'frontier', { records }).map((m) => m.case),
  );
  for (const c of set.cases) {
    const want = frontier.has(c.id) ? SCHEDULED_FRONTIER_REPETITIONS : 1;
    const got = count(scheduled, c.id);
    if (got !== want)
      findings.push(
        `${c.id}: the scheduled replay runs it ${got} time(s), not ${want} (ADR 0116)`,
      );
  }
  for (const event of ['pull_request', 'workflow_dispatch']) {
    const matrix = replayMatrix(set, undefined, { records, event });
    for (const c of set.cases)
      if (count(matrix, c.id) !== 1)
        findings.push(
          `${c.id}: a ${event} replay runs it ${count(matrix, c.id)} time(s); a label or a dispatch is one repetition (ADR 0072 item 8)`,
        );
  }

  if (
    !/golden-tiers\.ts --matrix\b[^\n]*--event "\$EVENT"/.test(workflowText) ||
    !/^\s*EVENT: \$\{\{ github\.event_name \}\}/m.test(workflowText)
  )
    findings.push(
      'the matrix is not built by golden-tiers.ts --matrix --event "$EVENT" from github.event_name, so the schedule cannot repeat a frontier case (ADR 0116)',
    );
  if (
    !/^\s*include: \$\{\{ fromJSON\(needs\.cases\.outputs\.matrix\) \}\}/m.test(
      workflowText,
    )
  )
    findings.push(
      'the replay job does not take its matrix entries from the cases job, so a repetition never becomes a reviewer session',
    );
  const artifacts: [string, RegExp][] = [
    ['result artifact', /^\s*name: golden-\$\{\{ matrix\.case \}\}(.*)$/m],
    [
      'transcript artifact',
      /^\s*transcript-artifact: golden-transcript-\$\{\{ matrix\.case \}\}(.*)$/m,
    ],
  ];
  for (const [what, pattern] of artifacts) {
    const m = pattern.exec(workflowText);
    if (!m || !m[1].includes('matrix.repetition'))
      findings.push(
        `the ${what} is not named for its repetition, so a case's repeated runs collide and all but one result is lost`,
      );
  }
  return findings;
};

/**
 * The commit-range findings for a set's cases, given a `git(args) => boolean`
 * that reports a command's success. Both ends must be in the clone and the base
 * an ancestor of the head, or the replay reviews nothing. An attributed head
 * must be reachable from `mainRef`. A seeded head is held to its own
 * `golden/seeded-*` tag instead, and a tag missing from the clone is a finding,
 * because the commit it keeps alive is reachable from nothing else (ADR 0130).
 */
export const caseRangeFindings = (
  cases: GoldenCase[],
  { git, mainRef }: { git: (args: string[]) => boolean; mainRef: string },
): string[] => {
  const findings: string[] = [];
  const has = (sha: string) => git(['cat-file', '-e', `${sha}^{commit}`]);
  for (const c of cases) {
    const ends: [string, string][] = [
      ['base', c.base],
      ['head', c.head],
    ];
    for (const [end, sha] of ends) {
      if (!has(sha))
        findings.push(
          `${c.id}: ${end} ${sha.slice(0, 7)} is not in this clone`,
        );
    }
    if (c.origin === 'seeded') {
      const tagRef = `refs/tags/${c.tag}`;
      if (!git(['rev-parse', '--verify', '--quiet', tagRef]))
        findings.push(
          `${c.id}: tag ${c.tag} is not in this clone; a golden tag is load-bearing, and deleting it breaks its case`,
        );
      else if (
        has(c.head) &&
        !git(['merge-base', '--is-ancestor', c.head, tagRef])
      )
        findings.push(
          `${c.id}: head ${c.head.slice(0, 7)} is not reachable from ${tagRef}`,
        );
    } else if (
      has(c.head) &&
      !git(['merge-base', '--is-ancestor', c.head, mainRef])
    )
      findings.push(
        `${c.id}: head ${c.head.slice(0, 7)} is not reachable from ${mainRef}; a squash merge needs the squash commit and its parent`,
      );
    if (
      has(c.base) &&
      has(c.head) &&
      !git(['merge-base', '--is-ancestor', c.base, c.head])
    )
      findings.push(`${c.id}: base is not an ancestor of head`);
  }
  return findings;
};

const SPEC_FILE = 'tmp/code-review/spec.json';

/**
 * Whether the replay hands a Spec-axis case the spec its original review saw
 * (ADR 0130 item 5). The step that writes `tmp/code-review/spec.json` must read
 * the case's `specText`, which `--show` resolves from its snapshot: written from `.spec`
 * alone, the Spec axis gets a reference with no text, which is how every replay
 * before issue #1140 ran. And the checkout that job starts from must keep full
 * history, or a seeded case's golden tag may not be in the clone.
 */
export const replaySpecSnapshotFindings = (workflowText: string): string[] => {
  const steps = workflowSteps(workflowText);
  const load = steps.findIndex((s) => s.body.includes(SPEC_FILE));
  if (load === -1)
    return [`no step writes ${SPEC_FILE}, so no case reaches the Spec axis`];
  const findings: string[] = [];
  const { name, body } = steps[load];
  if (!body.includes('specText'))
    findings.push(
      `"${name}" writes ${SPEC_FILE} without the case's specText, the pinned snapshot's title and body, so a Spec-axis case replays with no spec text (ADR 0130)`,
    );
  const checkout = steps
    .slice(0, load)
    .findLast((s) => /uses:\s*actions\/checkout@/.test(s.body));
  if (checkout && !/^\s*fetch-depth:\s*0\s*$/m.test(checkout.body))
    findings.push(
      `"${checkout.name}" checks out without fetch-depth: 0, so a seeded case's golden tag may be missing from the clone (ADR 0130)`,
    );
  return findings;
};

/**
 * A case as the replay needs it: the case, plus `specText` — the title and
 * body of its pinned snapshot — when its spec is an issue. This is the one
 * place a snapshot is read, so `--show` and the replay's spec.json cannot
 * disagree about what the reviewer was handed (ADR 0130 item 5).
 *
 * @param goldenCase one entry of `cases`
 */
export const caseForReplay = (
  goldenCase: GoldenCase,
  {
    read = (path: string) => readFileSync(path, 'utf8'),
  }: { read?: (path: string) => string } = {},
): GoldenCase => {
  if (!goldenCase.specSnapshot) return goldenCase;
  const { title, body } = JSON.parse(read(goldenCase.specSnapshot)) as {
    title: string;
    body: string;
  };
  return { ...goldenCase, specText: { title, body } };
};
