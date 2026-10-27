/**
 * The escaped-defect measurement (issue #721, PRD #713): **of the Pull
 * Requests the reviewer passed, what fraction a later fix names as root
 * cause.**
 *
 * Golden recall (`golden.ts`) runs the archaeology in the other direction —
 * a curated incident is traced back to the Pull Request that introduced it,
 * and the reviewer is replayed against that range. That is a regression
 * signal and explicitly not a trust measure: the cases are hand-picked, the
 * reviewer has seen them, and nothing about the score says whether a human
 * can rely on a passing review today. This module turns the archaeology
 * around and reads the repository's own fix history instead.
 *
 * Three distinctions carry the whole measurement, and collapsing any of them
 * would produce a number that flatters the reviewer:
 *
 *   1. **Passed is not the same as seen.** A Pull Request merged before the
 *      reviewer existed, or one whose review produced no verdict, is not an
 *      escaped defect — nothing passed it. Those are counted in their own
 *      buckets and never in the numerator.
 *   2. **Blocked is not escaped.** If the reviewer asked for changes and the
 *      work merged anyway, the reviewer did its job and a human overrode it.
 *      That is worth knowing and is not a miss.
 *   3. **Unattributable is counted, not dropped.** A fix that names no root
 *      cause tells us nothing about the reviewer, but silently discarding it
 *      would leave a denominator nobody can audit. Every fix in the window
 *      lands in exactly one class.
 *
 * Everything here is pure. `measure-escaped-defects.ts` reads git, calls
 * `gh`, and exits.
 */

import { NO_VERDICT_HEADING, SUMMARY_MARKER } from './publish.ts';
import { VERDICT_VALUES, verdictHeading } from './schema.ts';

/**
 * What a reviewer summary comment says happened, as far as trust is
 * concerned.
 *
 * `passed` deliberately covers both non-blocking verdicts: `Agent Verdict`
 * fails only on `request-changes` (ADR 0073), so a `comment` verdict is a
 * Pull Request the reviewer let through, and a defect that survives it is
 * exactly as escaped as one that survives an `approve`.
 */
export const REVIEW_OUTCOMES = [
  'passed',
  'blocked',
  'no-verdict',
  'unreviewed',
  'unrecognised',
] as const;

/**
 * Pinned fan-out over the verdict enum (AGENTS.md; ADR 0053). A verdict
 * added to the contract without a decision about what it means for trust
 * fails here at module load rather than being read as a pass.
 */
export const VERDICT_OUTCOMES =
  /** @type {Record<typeof VERDICT_VALUES[number], typeof REVIEW_OUTCOMES[number]>} */ ({
    'request-changes': 'blocked',
    comment: 'passed',
    approve: 'passed',
  });
for (const verdict of VERDICT_VALUES) {
  if (!(verdict in VERDICT_OUTCOMES))
    throw new Error(`VERDICT_OUTCOMES is missing "${verdict}"`);
}

/**
 * The heading the publisher writes, reversed. Built from the same helper the
 * renderer calls, so the parser cannot drift from the text it parses: a
 * reworded heading breaks the round-trip test rather than silently reporting
 * every review as unrecognised.
 */
const HEADING_TO_VERDICT = new Map(
  VERDICT_VALUES.map((verdict) => [verdictHeading(verdict), verdict]),
);

/**
 * What one Pull Request's comments say about its review.
 *
 * Input is every issue comment on the Pull Request, oldest first — the shape
 * `gh` returns. Only comments carrying the publisher's summary marker are
 * read; the last of them is the current review, because the publisher posts
 * a new summary per run and marks the previous one outdated rather than
 * deleting it.
 *
 * An unknown heading is `unrecognised`, never `passed`. The publisher's
 * format is the only thing that says a review happened at all, and guessing
 * on an unfamiliar one would add fabricated passes to the denominator.
 *
 * @param {Array<{ body?: string }>} comments
 * @returns {{ outcome: typeof REVIEW_OUTCOMES[number], verdict: string | null }}
 */
export const parseReviewOutcome = (comments = []) => {
  const summaries = (comments ?? []).filter((c) =>
    String(c?.body ?? '').includes(SUMMARY_MARKER),
  );
  if (summaries.length === 0) return { outcome: 'unreviewed', verdict: null };
  const body = String(summaries.at(-1).body ?? '');
  for (const [heading, verdict] of HEADING_TO_VERDICT) {
    if (body.includes(heading))
      return { outcome: VERDICT_OUTCOMES[verdict], verdict };
  }
  if (body.includes(NO_VERDICT_HEADING))
    return { outcome: 'no-verdict', verdict: null };
  return { outcome: 'unrecognised', verdict: null };
};

/**
 * A reference a fix names as the origin of the defect: a Pull Request, or a
 * commit that the resolver maps to one.
 */
const refPattern = String.raw`(?:(?:pull request|PR)\s*)?#(?<number>\d+)|(?<sha>\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b)`;

const marker = (id, lead, why) => ({
  id,
  why,
  re: new RegExp(String.raw`${lead}\s+(?:${refPattern})`, 'gi'),
});

/**
 * The vocabulary a fix uses to name what introduced the defect, in priority
 * order for ties. Each entry is a phrase a maintainer actually writes; the
 * list is deliberately short, because a marker that fires on ordinary prose
 * corrupts the numerator, while a fix whose phrasing is not listed merely
 * lands in `unattributed` where it is counted and visible.
 *
 * Closing keywords are absent on purpose. `Closes #721` names the issue the
 * fix resolves, not the change that caused it, and reading one as the other
 * would attribute every fix to its own ticket.
 */
export const ROOT_CAUSE_MARKERS = [
  marker(
    'root-cause',
    String.raw`root[\s-]?cause(?:\s+(?:is|was))?[:\s-]+`,
    'The explicit phrasing. When a maintainer writes it, nothing else in the text outranks it.',
  ),
  marker(
    'introduced-in',
    String.raw`introduced\s+(?:in|by)`,
    'The archaeology sentence the golden set is built from, written the other way round.',
  ),
  marker(
    'caused-by',
    String.raw`caused\s+by`,
    'States the causal claim directly.',
  ),
  marker(
    'regression-from',
    String.raw`regress(?:ion|ed)\s+(?:from|in|by)`,
    'A regression names the change it regressed from; that change is the root cause.',
  ),
  marker(
    'broke-in',
    String.raw`bro(?:ke|ken)\s+(?:in|by)`,
    'The same claim in the vernacular.',
  ),
  marker(
    'dates-to',
    String.raw`(?:ha[sd]\s+(?:had\s+)?(?:it|this|the\s+\w+)\s+since|dates?\s+(?:back\s+)?to)`,
    'Weakest of the five and ranked last. "ChangePassphraseCard has had it since #590" is real attribution from this repository\'s history. A bare "since #N" is deliberately NOT in it: the first run over sixty days of history matched exactly one, and that one was a neutral note about where some files had lived, so the only evidence the repository offers about the loose form is that it is wrong.',
  ),
];

const refOf = (groups) =>
  groups.number
    ? { kind: 'pull-request', number: Number(groups.number) }
    : { kind: 'commit', sha: groups.sha };

export const sameRef = (a, b) =>
  Boolean(a) &&
  Boolean(b) &&
  a.kind === b.kind &&
  (a.kind === 'pull-request'
    ? a.number === b.number
    : a.sha.startsWith(b.sha) || b.sha.startsWith(a.sha));

/**
 * A negation that denies the marker right after it: "Not a regression from
 * #745", "was not introduced in #590", "doesn't look like it was introduced
 * by". `not`, `never`, `no`, or any n't contraction, with either apostrophe —
 * a curly one is folded to straight before matching. It must end the text
 * before the marker, with at most four words between it and the marker, and
 * those words may not cross punctuation, a comma included — so a negation in
 * an earlier clause ("did not run in CI, it was introduced in #590") never
 * reaches it. Emphasis markers are allowed around the words, because the
 * sentence that bought this rule was written in bold.
 *
 * `no` is a negation only when it denies: "no doubt", "no denying", "no
 * question", "no less" and "no more" affirm what follows. A blank line ends
 * the reach, as a new paragraph; a single line break does not, because commit
 * bodies wrap mid-sentence.
 */
const DENIED_BEFORE =
  /\b(?:not|never|no(?![\s*_]+(?:doubt|denying|question|less|more)\b)|\w+n't)(?:[\s*_]+\w+){0,4}[\s*_]*$/i;
const NEGATION_REACH = 60;

const isDenied = (text, index) => {
  const before = text
    .slice(Math.max(0, index - NEGATION_REACH), index)
    .replace(/’/g, "'");
  const paragraph = before.split(/\n[ \t]*\n/).pop();
  return DENIED_BEFORE.test(paragraph);
};

const QUOTE_RADIUS = 60;

const quoteAround = (text, index, length) =>
  text
    .slice(Math.max(0, index - QUOTE_RADIUS), index + length + QUOTE_RADIUS)
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The root cause one piece of text names, or `null`.
 *
 * The earliest match in the text wins, with the marker order above breaking
 * ties at the same position. Every other distinct reference found is carried
 * in `others`: a fix that names two origins is still attributed to one, and
 * the row shows the disagreement instead of hiding it.
 *
 * @param {string} text
 * @returns {{ ref: object, marker: string, quote: string, others: object[] } | null}
 */
export const parseRootCause = (text) => {
  const source = String(text ?? '');
  const hits = [];
  ROOT_CAUSE_MARKERS.forEach((m, rank) => {
    // Each marker carries a `g` flag, so its lastIndex must not leak between
    // calls; matchAll on a fresh copy is the cheapest way to stay pure.
    for (const match of source.matchAll(new RegExp(m.re.source, 'gi'))) {
      if (isDenied(source, match.index)) continue;
      hits.push({
        index: match.index,
        rank,
        marker: m.id,
        ref: refOf(match.groups ?? {}),
        quote: quoteAround(source, match.index, match[0].length),
      });
    }
  });
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.index - b.index || a.rank - b.rank);
  const [first, ...rest] = hits;
  const others = [];
  for (const hit of rest) {
    if (sameRef(hit.ref, first.ref)) continue;
    if (others.some((o) => sameRef(o.ref, hit.ref))) continue;
    others.push({ ref: hit.ref, marker: hit.marker, quote: hit.quote });
  }
  return { ref: first.ref, marker: first.marker, quote: first.quote, others };
};

/**
 * The line a fix writes when it looked for the change that introduced the
 * defect and could not name one (ADR 0100): `Introduced in unknown: <why>`.
 *
 * It shares its lead with the `introduced-in` marker so that there is one
 * convention to remember, and it is anchored to the start of a line so the
 * phrase inside a sentence ("the date it was introduced in unknown ways") is
 * not read as a declaration. The reason after the colon is required, and the
 * whole declaration sits on one line: a bare "unknown" records that nobody
 * wrote a reason, which is the silence this class exists to tell apart. A declaration is not attribution — it resolves
 * to nothing and never reaches the numerator — but it is a recorded outcome,
 * counted in its own class, where silence lands in `unattributed`.
 */
export const ORIGIN_UNKNOWN =
  /^[ \t]*introduced[ \t]+in[ \t]+unknown[ \t]*:[ \t]*\S.*$/im;

/**
 * Where a fix's attribution is read from, in the order that decides which
 * one wins.
 *
 * The issue comes first because it is where the defect is described by
 * whoever found it; the Pull Request body second, as the fix's own account;
 * the commits last, because they describe the change rather than the
 * defect's origin. Order only matters when two sources disagree, and the
 * winning source is named in every row so a disagreement is auditable.
 */
export const ATTRIBUTION_SOURCES = [
  'issue',
  'body',
  'commits',
] as const;

/**
 * The root cause a fix names, from the first source that names one.
 *
 * A named reference in any source outranks a declared-unknown origin in any
 * other: the declaration says nobody could find the change, and a source that
 * found it is the better evidence. Only when no source names a reference is
 * an `Introduced in unknown` line read, and it comes back with `ref: null`.
 *
 * @param {Record<string, string|null|undefined>} sources text per source id
 * @returns {{ source: string, ref: object | null, marker: string, quote: string, others: object[] } | null}
 */
export const attributeFix = (sources = {}) => {
  for (const source of ATTRIBUTION_SOURCES) {
    const found = parseRootCause(sources[source]);
    if (found) return { source, ...found };
  }
  for (const source of ATTRIBUTION_SOURCES) {
    const declared = ORIGIN_UNKNOWN.exec(String(sources[source] ?? ''));
    if (declared)
      return {
        source,
        ref: null,
        marker: 'origin-unknown',
        quote: declared[0].trim(),
        others: [],
      };
  }
  return null;
};

/**
 * What one fix says about the reviewer. Every fix in the window gets exactly
 * one of these, which is what makes the denominator auditable.
 *
 *   `escaped`       the reviewer passed the Pull Request that caused it
 *   `blocked`       the reviewer asked for changes and it merged anyway
 *   `no-verdict`    the reviewer ran but produced no usable report
 *   `unreviewed`    the reviewer never saw the Pull Request
 *   `unrecognised`  a summary comment nothing in the contract can read
 *   `unknown`       the review status could not be looked up at all
 *   `unresolved`    a root cause that resolves to no merged Pull Request
 *   `not-earlier`   a root cause that is the fix itself, or merged after it
 *   `origin-unknown` the fix declares it looked and could not name one
 *   `unattributed`  the fix names no root cause
 */
export const FIX_CLASSES = [
  'escaped',
  'blocked',
  'no-verdict',
  'unreviewed',
  'unrecognised',
  'unknown',
  'unresolved',
  'not-earlier',
  'origin-unknown',
  'unattributed',
] as const;

/**
 * Pinned fan-out from a review outcome to a fix class (ADR 0053). The two
 * vocabularies are deliberately separate — a fix carries classes no review
 * outcome can produce (`unattributed`, `unresolved`) — so the mapping is
 * written once here and asserted at load.
 */
const OUTCOME_CLASSES =
  /** @type {Record<typeof REVIEW_OUTCOMES[number], typeof FIX_CLASSES[number]>} */ ({
    passed: 'escaped',
    blocked: 'blocked',
    'no-verdict': 'no-verdict',
    unreviewed: 'unreviewed',
    unrecognised: 'unrecognised',
  });
for (const outcome of REVIEW_OUTCOMES) {
  if (!(outcome in OUTCOME_CLASSES))
    throw new Error(`OUTCOME_CLASSES is missing "${outcome}"`);
}

/**
 * Classifies one fix against the Pull Request it names.
 *
 * @param {{
 *   fix: { number: number, mergedAt?: string },
 *   attribution: object | null,
 *   rootCause: { number: number, mergedAt?: string, outcome?: string } | null,
 * }} input
 */
export const classifyFix = ({ fix, attribution, rootCause }) => {
  if (!attribution) return { ...fix, class: 'unattributed', attribution: null };
  if (!attribution.ref)
    return { ...fix, class: 'origin-unknown', attribution, rootCause: null };
  const row = { ...fix, attribution, rootCause: rootCause ?? null };
  if (!rootCause) return { ...row, class: 'unresolved' };
  // A fix cannot be caused by work that merged after it, and it cannot be
  // caused by itself — a fix citing a commit from its own branch is naming
  // its own work. Both are how a bad reference announces itself instead of
  // adding a phantom escape.
  if (
    rootCause.number === fix.number ||
    (fix.mergedAt &&
      rootCause.mergedAt &&
      new Date(rootCause.mergedAt) > new Date(fix.mergedAt))
  )
    return { ...row, class: 'not-earlier' };
  const outcome = rootCause.outcome;
  if (!outcome || !REVIEW_OUTCOMES.includes(outcome))
    return { ...row, class: 'unknown' };
  return { ...row, class: OUTCOME_CLASSES[outcome] };
};

const countBy = (rows, key) => {
  const counts = {};
  for (const row of rows) counts[row[key]] = (counts[row[key]] ?? 0) + 1;
  return counts;
};

/**
 * The measurement.
 *
 * `passed` is the denominator: the Pull Requests the reviewer passed inside
 * the window, each `{ number, mergedAt }`. The numerator is the distinct
 * Pull Requests among them that a later fix names as root cause.
 *
 * With an empty denominator the rate is `null`, never `0`. Zero would read
 * as "the reviewer passed things and none of them broke", which is the
 * opposite of "the reviewer has passed nothing yet" — and the second is the
 * state this repository is actually in until enough Pull Requests have gone
 * through the pipeline.
 *
 * `unreadable` is the denominator's own honesty ledger: Pull Requests inside
 * the window that the reviewer could have seen and whose outcome nothing
 * could look up. They are not in the denominator, because an unread review
 * is not a pass — but a denominator of 4 means something different when 20
 * more went unread, and a rate that hid that would be the flattering kind.
 *
 * @param {{
 *   window: { since: string, until: string },
 *   fixes: object[],
 *   passed: Array<{ number: number }>,
 *   unreadable?: number,
 *   evidence?: object,
 * }} input
 */
export const summarize = ({
  window,
  fixes = [],
  passed = [],
  unreadable = 0,
  evidence,
}) => {
  const classes = countBy(fixes, 'class');
  for (const c of FIX_CLASSES) classes[c] = classes[c] ?? 0;
  const passedNumbers = new Set(passed.map((p) => p.number));
  const escapedNumbers = new Set(
    fixes
      .filter((f) => f.class === 'escaped')
      .map((f) => f.rootCause?.number)
      .filter((n) => n !== undefined && n !== null),
  );
  // The two sides are gathered independently — the numerator walks fix
  // branches, the denominator walks the Pull Requests the reviewer passed
  // inside the window — so an escape can name a Pull Request the denominator
  // does not contain, because it passed before the window opened. Only the
  // intersection is the rate. Dividing every escape by the window's passes
  // mixes two populations and can exceed 100%: two passes in the window and
  // one escape from before it would have read as 50%, against a denominator
  // neither escape belonged to.
  const escapedInWindow = [...escapedNumbers].filter((n) =>
    passedNumbers.has(n),
  );
  const outsideDenominator = [...escapedNumbers].filter(
    (n) => !passedNumbers.has(n),
  );
  const denominator = passedNumbers.size;
  return {
    window,
    evidence: evidence ?? null,
    sample: {
      fixes: fixes.length,
      attributed: fixes.filter((f) => f.attribution?.ref).length,
      originUnknown: classes['origin-unknown'],
      unattributed: classes.unattributed,
    },
    classes,
    denominator,
    unreadable,
    escaped: escapedInWindow.sort((a, b) => a - b),
    outsideDenominator: outsideDenominator.sort((a, b) => a - b),
    rate: denominator === 0 ? null : escapedInWindow.length / denominator,
    fixes,
  };
};

const percent = (rate) =>
  rate === null ? 'not yet measurable' : `${(100 * rate).toFixed(1)}%`;

const CLASS_NOTES = {
  escaped: 'the reviewer passed the Pull Request that caused it',
  blocked: 'the reviewer asked for changes; it merged anyway',
  'no-verdict': 'the reviewer ran and produced no usable report',
  unreviewed: 'the reviewer never saw the Pull Request',
  unrecognised: 'a summary comment the contract cannot read',
  unknown: 'the review status could not be looked up',
  unresolved: 'names a root cause that resolves to no merged Pull Request',
  'not-earlier':
    'names a root cause that is the fix itself, or merged after it',
  'origin-unknown':
    'declares it looked for the change that introduced it and found none',
  unattributed: 'names no root cause',
};
for (const c of FIX_CLASSES) {
  if (!(c in CLASS_NOTES)) throw new Error(`CLASS_NOTES is missing "${c}"`);
}

/** The measurement as Markdown, for pasting into the running record. */
export const renderMeasurement = (summary) => {
  const { window: w, sample, classes } = summary;
  const lines = [
    `# Escaped-defect measurement (${w.since} to ${w.until})`,
    '',
    `- fixes merged in the window: **${sample.fixes}**`,
    `- of those, naming a root cause: **${sample.attributed}**; declaring it unknown: **${sample.originUnknown}**; naming none: **${sample.unattributed}**`,
    `- Pull Requests the reviewer passed in the window: **${summary.denominator}**`,
    `- of those, named as root cause by a later fix: **${summary.escaped.length}**`,
    `- **escaped-defect rate: ${percent(summary.rate)}**`,
    '',
  ];
  if (summary.unreadable > 0)
    lines.push(
      `Review status unreadable for **${summary.unreadable}** more Pull Requests in the window. They are not counted as passes, and the denominator is that much smaller than the period suggests.`,
      '',
    );
  if (summary.rate === null)
    lines.push(
      'The denominator is empty, so the rate is not measurable yet. It is reported as unmeasurable rather than as 0%, which would claim the reviewer passed work and none of it broke.',
      '',
    );
  if (summary.outsideDenominator.length > 0)
    lines.push(
      `Escapes naming a Pull Request outside the denominator window: ${summary.outsideDenominator.map((n) => `#${n}`).join(', ')}.`,
      '',
    );
  lines.push('## Every fix in the window', '', '| Class | Fixes | Means |');
  lines.push('| --- | ---: | --- |');
  for (const c of FIX_CLASSES)
    lines.push(`| \`${c}\` | ${classes[c]} | ${CLASS_NOTES[c]} |`);
  lines.push('');
  const attributed = summary.fixes.filter((f) => f.attribution?.ref);
  if (attributed.length > 0) {
    lines.push(
      '## Attributed fixes',
      '',
      // The verdict is its own column rather than folded into the class. A
      // root cause the reviewer approved and one it only commented on are
      // both `escaped`, and which of the two it was is the fact a reader
      // needs to judge the miss.
      '| Fix | Class | Root cause | Verdict | Named by | Quote |',
      '| --- | --- | --- | --- | --- | --- |',
      ...attributed.map((f) => {
        const ref = f.attribution.ref;
        const named =
          ref.kind === 'pull-request' ? `#${ref.number}` : `\`${ref.sha}\``;
        const resolved = f.rootCause ? `#${f.rootCause.number}` : named;
        const verdict = f.rootCause?.verdict
          ? `\`${f.rootCause.verdict}\``
          : '—';
        return `| #${f.number} | \`${f.class}\` | ${resolved} | ${verdict} | ${f.attribution.source}, \`${f.attribution.marker}\` | ${f.attribution.quote.replace(/\|/g, '\\|')} |`;
      }),
      '',
      '### The vocabulary that matched',
      '',
      '| Marker | Why it is attribution |',
      '| --- | --- |',
      ...ROOT_CAUSE_MARKERS.filter((m) =>
        attributed.some((f) => f.attribution.marker === m.id),
      ).map((m) => `| \`${m.id}\` | ${m.why.replace(/\|/g, '\\|')} |`),
      '',
    );
  }
  if (summary.evidence)
    lines.push(
      '## Evidence read',
      '',
      ...Object.entries(summary.evidence).map(
        ([source, state]) => `- ${source}: ${state}`,
      ),
      '',
    );
  return lines.join('\n');
};
