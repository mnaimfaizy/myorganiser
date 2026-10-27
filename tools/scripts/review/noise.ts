/**
 * The effective-false-positive rate (issue #729, PRD #713): **per rule, the
 * share of findings that were raised and were still there on the next push.**
 *
 * The sibling measurement (`escaped-defects.ts`) asks what the reviewer
 * missed. This one asks what it costs. They are the two halves of trust and
 * neither substitutes for the other: a reviewer that finds everything and is
 * ignored is as unusable as one that finds nothing.
 *
 * Three decisions carry it, and the first is the counter-intuitive one:
 *
 *   1. **Inaction is the signal; correctness is not the question.** A finding
 *      nobody acted on counts against its rule whether or not the finding was
 *      right. "Was it correct?" cannot be answered without a human labelling
 *      every comment, and a finding nobody acts on costs attention either
 *      way. The term is Google's — an issue is an *effective* false positive
 *      "if developers did not take some positive action after seeing the
 *      issue" (Software Engineering at Google, ch. 20) — and so is the budget
 *      below.
 *   2. **The unit is an observation, not a finding.** A finding still present
 *      across three pushes is two ignored observations, because it cost
 *      attention on each of them. The measurement is about what a finding
 *      *does between pushes*, which is why the review runs on every push at
 *      all: debouncing the reviewer would remove the measurement.
 *   3. **Every observation lands in exactly one class, including the ones
 *      that say nothing.** A push whose report is missing, a pair spanning a
 *      schema bump, a finding on the newest push with nothing to compare it
 *      against — each is set aside by name and counted, so the denominator is
 *      auditable rather than whatever survived a filter.
 *
 * The rate is meaningless before finding identity is stable, and it was not
 * stable until recently: free-form `rule` prose put 38 of 38 consecutive
 * reports at zero persisting findings (issue #718), and the `source` that
 * replaced it collapsed twelve Fowler smells into one identity (issue #724).
 * And an identity that was stable was still coarser than a finding: of the 36
 * ids that survived a push in the 2026-10-05 window, 15 labelled a different
 * defect under the same rule in the same file — 14 read here as a finding
 * nobody acted on, one as acknowledged (issue #940). An id is now carried forward only onto a
 * finding of the same axis, rule, and file whose lines overlap the earlier
 * one's, which the validator decides and this module only reads. Every
 * identity compared here is at report schema {@link REPORT_SCHEMA_VERSION}; a
 * pair that spans anything older is `incomparable`, never an observation.
 *
 * Everything here is pure. `measure-noise.ts` reads git, calls `gh`, and
 * exits.
 */

import { isComparableReport, reportSchemaVersionOf } from './schema.ts';

/** One acknowledgement, as a commit message carries it. */
export interface Acknowledgement {
  sha: string | null;
  quote: string;
}

/** A commit of the push that answered a review. */
export interface PushCommit {
  sha?: string;
  message?: string;
}

/** One push of a branch: its head, the report that ran on it, its commits. */
export interface Push {
  headSha: string;
  report: ReportRead | null;
  commits?: PushCommit[];
  /** When the review ran. Carried through from the gather, never read here. */
  createdAt?: string;
}

/** A stored report, read back from an artifact and of any vintage. */
export interface ReportRead {
  findings?: ObservedFinding[];
  [field: string]: unknown;
}

/** What this measurement reads of a finding. */
export interface ObservedFinding {
  id: string;
  ruleId?: string;
  axis?: string;
  severity?: string;
  /**
   * Only the file is read. The rest of a stored finding's location comes
   * along with it, and declaring it keeps a caller from having to strip a
   * report down to what this reads.
   */
  location?:
    | { file?: string; startLine?: number; endLine?: number; headSha?: string }
    | undefined;
}

/** One observation: what one finding did between two pushes. */
export interface Observation {
  branch?: string | null;
  findingId: string;
  ruleId: string;
  axis?: string;
  severity?: string;
  file: string | null;
  raisedAt: string;
  class: ObservationClass;
  nextPush: string | null;
  acknowledgedBy?: Acknowledgement | null;
  schemaVersions?: (unknown | null)[];
}

/** What a push's findings are classified as. */
export type ObservationClass = (typeof OBSERVATION_CLASSES)[number];

/** What `rowOf` is told about one observation beside the finding itself. */
type ObservationExtra = Pick<Observation, 'class' | 'nextPush'> &
  Partial<Pick<Observation, 'acknowledgedBy' | 'schemaVersions'>>;

/** The whole measurement, as `summarizeNoise` returns it. */
export type NoiseSummary = ReturnType<typeof summarizeNoise>;

/** What the budget says about one rule's rate. */
export type RuleStatus = (typeof RULE_STATUSES)[number];

/** A rate over a set of observations. */
export interface NoiseRate {
  observations: number;
  ignored: number;
  rate: number | null;
}

/** The budget a published rate is read against. */
export type NoiseBudget = typeof NOISE_BUDGET;

/** One branch's pushes, oldest first. */
export interface BranchPushes {
  branch?: string | null;
  pushes: Push[];
}

/**
 * The budget the published rate is read against.
 *
 * It is written down here, once, because a threshold nobody wrote down is a
 * threshold every reader invents for themselves. Nothing in this slice acts
 * on it: no rule is disabled, by this module or by anything that calls it.
 */
export const NOISE_BUDGET = {
  /** Effective false positives per rule, as a fraction of its observations. */
  rate: 0.1,
  /** Below this many observations a rule's rate is reported and not judged. */
  minObservations: 10,
  source:
    'Winters, Manshreck & Wright, "Software Engineering at Google" (O\'Reilly, 2020), ch. 20 "Static Analysis" — the criteria a Tricorder analyzer must meet to be on by default, one of which is "Produce less than 10% effective false positives"; the ecosystem it describes is Sadowski et al., "Tricorder: Building a Program Analysis Ecosystem", ICSE 2015.',
  reasoning: [
    'Ten percent is not this repository\'s number and is not derived from its data. It is the only noise threshold in the published literature that arrives with a mechanism attached rather than as an opinion, and it is stated against the same definition used here: an issue is an effective false positive "if developers did not take some positive action after seeing the issue". Borrowing the definition and inventing a different number would be worse than borrowing both.',
    'The two numerators are not identical, and the difference is unmeasured. Google\'s is narrower — a "Not useful" click means somebody read the finding — and this one is broader, because a finding still present on the next push counts even if nobody looked at it. It is also narrower in one respect: an acknowledged finding is set aside here and has no counterpart there. Which way the bias runs is not known, which is exactly why the budget is a marker to read the rate against and not a gate.',
    'The ten-observation floor is arithmetic, not taste. Below ten observations a single ignored finding is already more than ten percent, so a rule with nine observations cannot be within budget for any reason except how few findings it happened to raise. Under the floor the rate is published and not judged.',
    'The number is reviewable once a month of data exists — which is also when the automatic disable becomes possible. Both are deliberately out of this slice.',
  ],
};

/**
 * The commit-message marker that takes one finding out of the numerator.
 *
 * Optional and never required: the measurement works with nobody ever typing
 * it, which is the point of reading inaction instead of asking for a label.
 * It exists for the case the author has read a finding, agrees it is real,
 * and is deliberately not acting on it now — that inaction is not silent, and
 * counting it as noise would punish a rule for working.
 *
 *   Review-ack: 4f2a91c0b8de — real, deferred to #730
 *
 * The marker names **finding ids**, which the report prints under every
 * finding. A rule id is deliberately not accepted: the id is the one token a
 * reader can only have got from the finding itself, so acknowledging one
 * means having read it, while `Review-ack: standard-other` would excuse
 * findings the author never saw — including ones raised after the
 * acknowledgement was written — and would zero a rule's rate in a single
 * line.
 */
export const OPT_OUT_MARKER = 'Review-ack';

/** Line-anchored, like `Closes #N`: prose mentioning the marker is not one. */
const OPT_OUT_LINE = String.raw`^[ \t]*review-ack:[ \t]*(.*)$`;

/** A finding id as the validator mints it: 12 hex characters (schema.ts). */
const FINDING_ID = String.raw`\b[0-9a-f]{12}\b`;

/**
 * Every finding id one commit message acknowledges, with the line it was
 * acknowledged on.
 *
 * @param message a full commit message, subject and body
 */
export const parseAcknowledgements = (
  message: unknown,
): Map<string, { quote: string }> => {
  const found = new Map<string, { quote: string }>();
  for (const line of String(message ?? '').matchAll(
    new RegExp(OPT_OUT_LINE, 'gim'),
  )) {
    const quote = line[0].trim();
    for (const id of line[1].matchAll(new RegExp(FINDING_ID, 'g')))
      if (!found.has(id[0])) found.set(id[0], { quote });
  }
  return found;
};

/**
 * The acknowledgements carried by the commits of one push, first commit
 * wins. The commits read are the ones between the two heads — the push that
 * answered the review — so an acknowledgement applies to the finding it was
 * written in response to and not to every later run.
 *
 */
export const acknowledgementsIn = (
  commits: readonly PushCommit[] | null | undefined = [],
): Map<string, Acknowledgement> => {
  const found = new Map<string, Acknowledgement>();
  for (const commit of commits ?? []) {
    for (const [id, { quote }] of parseAcknowledgements(commit?.message)) {
      if (found.has(id)) continue;
      found.set(id, { sha: commit?.sha ?? null, quote });
    }
  }
  return found;
};

/**
 * What one finding did between the push that raised it and the next one.
 *
 *   `acted-on`      gone from the next push's report
 *   `ignored`       still there, and nothing acknowledged it
 *   `acknowledged`  still there, and a commit in the push named its id
 *   `pending`       raised on the newest push; there is no next one yet
 *   `unreadable`    the next push produced no report to compare against
 *   `incomparable`  one of the two reports is of another schema version
 */
export const OBSERVATION_CLASSES = [
  'acted-on',
  'ignored',
  'acknowledged',
  'pending',
  'unreadable',
  'incomparable',
] as const;

/**
 * What each class does to the fraction. Pinned fan-out over the class list
 * (AGENTS.md; ADR 0053) and asserted at module load, so a class added without
 * a decision about where it lands fails here rather than silently counting as
 * one of the others.
 *
 *   `noise`      numerator and denominator
 *   `signal`     denominator only
 *   `set-aside`  neither, and reported by name
 *
 * `acknowledged` is set aside rather than counted as a positive action. Both
 * choices keep it out of the numerator, which is all the marker promises;
 * counting it in the denominator would let a marker *improve* a rule's rate,
 * and a marker that can manufacture evidence for a rule is worth more to a
 * noisy rule than to a good one.
 */
export const CLASS_ROLES: Record<
  ObservationClass,
  'noise' | 'signal' | 'set-aside'
> = {
  'acted-on': 'signal',
  ignored: 'noise',
  acknowledged: 'set-aside',
  pending: 'set-aside',
  unreadable: 'set-aside',
  incomparable: 'set-aside',
};
for (const c of OBSERVATION_CLASSES)
  if (!(c in CLASS_ROLES)) throw new Error(`CLASS_ROLES is missing "${c}"`);

export const CLASS_NOTES: Record<ObservationClass, string> = {
  'acted-on': 'gone from the report on the next push',
  ignored: 'still there on the next push, and nothing acknowledged it',
  acknowledged: `still there, and a commit in the push named its id with \`${OPT_OUT_MARKER}\``,
  pending: 'raised on the newest push; there is no next push yet',
  unreadable: 'the next push produced no report to compare against',
  incomparable:
    'one of the two reports is of another report schema version, so the ids mean different things',
};
for (const c of OBSERVATION_CLASSES)
  if (!(c in CLASS_NOTES)) throw new Error(`CLASS_NOTES is missing "${c}"`);

/**
 * The rule a finding names when it names none.
 *
 * `ruleId` only exists from the report schema version that put it in the
 * identity tuple (issue #724), and the reports stored before it are the only
 * history this measurement has. Their observations are `incomparable` and
 * count towards nothing, but they are still rows in the ledger — and grouping
 * them under a missing key published a per-rule line named `undefined`, which
 * is a JavaScript primitive leaking into a document people read.
 */
export const UNNAMED_RULE = '(no rule id)';

const rowOf = (
  finding: ObservedFinding,
  push: { headSha: string },
  extra: ObservationExtra,
): Observation => ({
  findingId: finding.id,
  ruleId: finding.ruleId ?? UNNAMED_RULE,
  axis: finding.axis,
  severity: finding.severity,
  file: finding.location?.file ?? null,
  raisedAt: push.headSha,
  ...extra,
});

/**
 * Every finding on `current`, classified against `next`.
 *
 * `next.commits` are the commits the push brought in — the answer to the
 * review that ran on `current` — and are where an acknowledgement is read
 * from. A finding that is gone is `acted-on` even when a commit also
 * acknowledged it: the marker only ever moves an observation out of
 * `ignored`, never into it.
 *
 * `carried` is every acknowledgement the branch has made up to and including
 * this push, which is how an acknowledgement written once keeps holding. The
 * alternative — re-reading only this push's commits — would require the
 * author to re-type the marker on every push the finding survives, and a
 * marker you must repeat is the per-finding labelling ritual this measurement
 * exists to avoid. Passed by `observeBranch`; computed from `next` alone when
 * a caller observes a single pair.
 *
 * @param current the push the findings were raised on
 * @param next the push that answered it
 * @param carried every acknowledgement the branch has made so far
 */
export const observePair = (
  current: Push,
  next: Push,
  carried: Map<string, Acknowledgement> | null = null,
): Observation[] => {
  const report = current.report;
  if (!report) return [];
  const findings = report.findings ?? [];
  if (!next.report)
    return findings.map((f) =>
      rowOf(f, current, { class: 'unreadable', nextPush: next.headSha }),
    );
  // Both sides, not only the newer one: two reports of the same older vintage
  // are comparable with each other, but their ids were minted from another
  // tuple and their findings may carry no `ruleId` at all, which is the unit
  // this measurement is grouped by.
  if (!isComparableReport(report) || !isComparableReport(next.report))
    return findings.map((f) =>
      rowOf(f, current, {
        class: 'incomparable',
        nextPush: next.headSha,
        schemaVersions: [
          reportSchemaVersionOf(report) ?? null,
          reportSchemaVersionOf(next.report) ?? null,
        ],
      }),
    );
  const present = new Set(
    (next.report.findings ?? []).map((f: ObservedFinding) => f.id),
  );
  const acknowledged = carried ?? acknowledgementsIn(next.commits);
  return findings.map((f) => {
    if (!present.has(f.id))
      return rowOf(f, current, { class: 'acted-on', nextPush: next.headSha });
    const ack = acknowledged.get(f.id);
    return rowOf(f, current, {
      class: ack ? 'acknowledged' : 'ignored',
      nextPush: next.headSha,
      acknowledgedBy: ack ?? null,
    });
  });
};

/**
 * Every observation on one branch's pushes, oldest first.
 *
 * The last push's findings are `pending` rather than absent: a finding raised
 * on the newest push has had no chance to be acted on, and dropping it would
 * quietly shrink the ledger by exactly the findings the reviewer raised most
 * recently.
 *
 * Acknowledgements accumulate as the walk goes forward and are never applied
 * backwards: a marker written on the fifth push holds for the fifth push
 * onward and says nothing about what happened between the first and the
 * second.
 *
 */
export const observeBranch = ({
  branch = null,
  pushes = [],
}: BranchPushes): Observation[] => {
  const rows: Observation[] = [];
  const acknowledged = new Map<string, Acknowledgement>();
  for (let i = 0; i < pushes.length; i += 1) {
    const current = pushes[i];
    const next = pushes[i + 1];
    if (!next) {
      for (const f of current.report?.findings ?? [])
        rows.push(rowOf(f, current, { class: 'pending', nextPush: null }));
      continue;
    }
    // The earliest acknowledgement of an id owns it, so a later commit
    // repeating the marker does not re-date the one the report shows.
    for (const [findingId, ack] of acknowledgementsIn(next.commits))
      if (!acknowledged.has(findingId)) acknowledged.set(findingId, ack);
    rows.push(...observePair(current, next, acknowledged));
  }
  return rows.map((row) => ({ branch, ...row }));
};

const countBy = (
  rows: readonly Observation[],
  key: 'class',
): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row[key]] = (counts[row[key]] ?? 0) + 1;
  return counts;
};

/** Observations that count, and of those the ones that count as noise. */
export const rateOf = (rows: readonly Observation[]): NoiseRate => {
  const counted = rows.filter((r) => CLASS_ROLES[r.class] !== 'set-aside');
  const noise = counted.filter((r) => CLASS_ROLES[r.class] === 'noise');
  return {
    observations: counted.length,
    ignored: noise.length,
    rate: counted.length === 0 ? null : noise.length / counted.length,
  };
};

/**
 * What the budget says about one rule's rate.
 *
 *   `over-budget`            above the budget, with enough observations to say so
 *   `within-budget`          at or below it, with enough observations to say so
 *   `insufficient-evidence`  fewer observations than the floor; reported, not judged
 */
export const RULE_STATUSES = [
  'over-budget',
  'within-budget',
  'insufficient-evidence',
] as const;

export const statusOf = (
  { observations, rate }: Omit<NoiseRate, 'ignored'>,
  budget: NoiseBudget = NOISE_BUDGET,
): RuleStatus => {
  if (observations < budget.minObservations) return 'insufficient-evidence';
  return (rate ?? 0) > budget.rate ? 'over-budget' : 'within-budget';
};

/**
 * The measurement.
 *
 */
export const summarizeNoise = ({
  window = {},
  branches = [],
  evidence = null,
  budget = NOISE_BUDGET,
}: {
  window?: { since?: string; until?: string };
  branches?: readonly BranchPushes[];
  evidence?: unknown;
  budget?: NoiseBudget;
}) => {
  const rows = branches.flatMap((b) => observeBranch(b));
  const classes = countBy(rows, 'class');
  for (const c of OBSERVATION_CLASSES) classes[c] = classes[c] ?? 0;

  const byRule = new Map<string, Observation[]>();
  for (const row of rows) {
    if (!byRule.has(row.ruleId)) byRule.set(row.ruleId, []);
    byRule.get(row.ruleId)!.push(row);
  }
  const rules = [...byRule.entries()]
    .map(([ruleId, ruleRows]) => {
      const counts = rateOf(ruleRows);
      return {
        ruleId,
        ...counts,
        acted: ruleRows.filter((r) => r.class === 'acted-on').length,
        acknowledged: ruleRows.filter((r) => r.class === 'acknowledged').length,
        setAside: ruleRows.filter((r) => CLASS_ROLES[r.class] === 'set-aside')
          .length,
        status: statusOf(counts, budget),
      };
    })
    // Worst first, and a tie broken by evidence: the rule a reader should
    // look at first is the noisiest one that has been observed the most.
    .sort(
      (a, b) =>
        (b.rate ?? -1) - (a.rate ?? -1) || b.observations - a.observations,
    );

  const overall = rateOf(rows);
  return {
    window,
    evidence,
    budget,
    sample: {
      branches: branches.length,
      pushes: branches.reduce((n, b) => n + (b.pushes?.length ?? 0), 0),
      findings: rows.length,
    },
    classes,
    ...overall,
    overBudget: rules
      .filter((r) => r.status === 'over-budget')
      .map((r) => r.ruleId),
    rules,
    acknowledgements: rows
      .filter((r) => r.class === 'acknowledged')
      .map((r) => ({
        findingId: r.findingId,
        ruleId: r.ruleId,
        branch: r.branch,
        commit: r.acknowledgedBy?.sha ?? null,
        quote: r.acknowledgedBy?.quote ?? '',
      })),
    rows,
  };
};

const percent = (rate: number | null): string =>
  rate === null ? 'not yet measurable' : `${(100 * rate).toFixed(1)}%`;

const cell = (text: unknown): string => String(text).replace(/\|/g, '\\|');

/** The measurement as Markdown, for pasting into the running record. */
export const renderNoiseMeasurement = (summary: NoiseSummary): string => {
  const { window: w, sample, classes, budget } = summary;
  const span =
    w?.since && w?.until
      ? ` (${w.since} to ${w.until})`
      : w?.since
        ? ` (since ${w.since})`
        : '';
  const lines = [
    `# Effective-false-positive measurement${span}`,
    '',
    `- branches: **${sample.branches}**, reviewed pushes: **${sample.pushes}**`,
    `- findings observed: **${sample.findings}**; counted: **${summary.observations}**; set aside: **${sample.findings - summary.observations}**`,
    `- raised and still there on the next push: **${summary.ignored}**`,
    `- **effective-false-positive rate: ${percent(summary.rate)}** against a budget of ${percent(budget.rate)} per rule`,
    '',
  ];
  if (summary.rate === null)
    lines.push(
      'Nothing is counted yet, so the rate is not measurable. It is reported as unmeasurable rather than as 0%, which would claim findings were raised and acted on.',
      '',
    );
  lines.push(
    'No rule is disabled by this measurement, automatically or otherwise. The disable is a follow-up and needs a month of data first; this slice measures only.',
    '',
    '## Per rule',
    '',
    '| Rule | Observations | Ignored | Acted on | Acknowledged | Set aside | Rate | Against budget |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  );
  if (summary.rules.length === 0)
    lines.push('| _no findings observed_ | 0 | 0 | 0 | 0 | 0 | — | — |');
  for (const r of summary.rules)
    lines.push(
      `| \`${cell(r.ruleId)}\` | ${r.observations} | ${r.ignored} | ${r.acted} | ${r.acknowledged} | ${r.setAside} | ${percent(r.rate)} | \`${r.status}\` |`,
    );
  lines.push(
    '',
    '## Every finding observed',
    '',
    '| Class | Findings | Counts as | Means |',
    '| --- | ---: | --- | --- |',
    ...OBSERVATION_CLASSES.map(
      (c) =>
        `| \`${c}\` | ${classes[c]} | ${CLASS_ROLES[c]} | ${cell(CLASS_NOTES[c])} |`,
    ),
    '',
  );
  if (summary.acknowledgements.length > 0)
    lines.push(
      `## Acknowledged with \`${OPT_OUT_MARKER}\``,
      '',
      'Out of the numerator and out of the denominator, and listed here: an acknowledgement is the one input to this measurement a human can write by hand.',
      '',
      '| Finding | Rule | Commit | Line |',
      '| --- | --- | --- | --- |',
      ...summary.acknowledgements.map(
        (a) =>
          `| \`${a.findingId}\` | \`${cell(a.ruleId)}\` | ${a.commit ? `\`${a.commit.slice(0, 7)}\`` : '—'} | ${cell(a.quote)} |`,
      ),
      '',
    );
  lines.push(
    '## The budget',
    '',
    `**${percent(budget.rate)} effective false positives per rule**, judged only once a rule has **${budget.minObservations}** observations.`,
    '',
    `Source: ${cell(budget.source)}`,
    '',
    ...budget.reasoning.map((r) => `- ${r}`),
    '',
  );
  if (summary.evidence)
    lines.push(
      '## Evidence read',
      '',
      ...Object.entries(summary.evidence as Record<string, unknown>).map(
        ([source, state]) => `- ${source}: ${state}`,
      ),
      '',
    );
  return lines.join('\n');
};
