import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ATTRIBUTION_SOURCES,
  FIX_CLASSES,
  REVIEW_OUTCOMES,
  ROOT_CAUSE_MARKERS,
  VERDICT_OUTCOMES,
  attributeFix,
  classifyFix,
  parseReviewOutcome,
  parseRootCause,
  renderMeasurement,
  summarize,
} from './escaped-defects.ts';
import {
  NO_VERDICT_HEADING,
  SUMMARY_MARKER,
  rejectedBody,
  summaryBody,
} from './publish.ts';
import type {
  FixAttribution,
  FixSubject,
  RootCausePullRequest,
  RootCauseRef,
} from './escaped-defects.ts';
import type { Verdict } from './schema.ts';
import { VERDICT_VALUES, verdictHeading } from './schema.ts';

/**
 * The Pull Request number a reference names, when it names one. A reference
 * is a Pull Request or a commit, and only the first carries a number.
 */
const refNumber = (ref?: RootCauseRef | null) =>
  ref?.kind === 'pull-request' ? ref.number : undefined;

// ---------------------------------------------------------------------------
// The attribution parser
// ---------------------------------------------------------------------------

test('each marker in the vocabulary names a Pull Request', () => {
  const cases: Record<string, string> = {
    'root-cause': 'Root cause: #590.',
    'introduced-in': 'The behaviour was introduced in #590.',
    'caused-by': 'Caused by PR #590.',
    'regression-from': 'A regression from #590.',
    'broke-in': 'This broke in #590 and nobody noticed.',
    'dates-to': 'ChangePassphraseCard has had it since #590.',
  };
  const notAttribution: Record<string, string> = {
    // Measured on this repository's own history: the only bare "since #N" in
    // sixty days was a note about where some files used to live.
    'dates-to': 'The answer files have lived beside the report since #590.',
  };
  for (const marker of ROOT_CAUSE_MARKERS) {
    const text = cases[marker.id];
    assert.ok(text, `no fixture for marker ${marker.id}`);
    const found = parseRootCause(text);
    assert.equal(found?.marker, marker.id, `marker ${marker.id} did not match`);
    assert.deepEqual(found!.ref, { kind: 'pull-request', number: 590 });
    const neutral = notAttribution[marker.id];
    if (neutral)
      assert.equal(
        parseRootCause(neutral),
        null,
        `marker ${marker.id} matched a neutral reference`,
      );
  }
});

// A marker a sentence denies is the opposite of attribution. The first
// measurement with `gh` (2026-09-28) counted #902 as escaping from #745 on
// "**Not a regression from #745:** The same hole existed before that PR".
test('a negated marker is not attribution', () => {
  const denied: Record<string, string> = {
    'root-cause': 'The root cause is not #590.',
    'introduced-in': 'This was not introduced in #590.',
    'caused-by': "It wasn't caused by #590.",
    'regression-from': '**Not a regression from #590:** the hole predates it.',
    'broke-in': 'It never broke in #590.',
    'dates-to': 'It has not had it since #590.',
  };
  for (const marker of ROOT_CAUSE_MARKERS) {
    const text = denied[marker.id];
    assert.ok(text, `no negated fixture for marker ${marker.id}`);
    assert.equal(
      parseRootCause(text),
      null,
      `negated marker ${marker.id} was read as attribution`,
    );
  }
});

// Denying one origin and naming another is the common shape of the sentence;
// the negation must not reach past its own clause.
test('a negation does not suppress a later, affirmed marker', () => {
  const found = parseRootCause(
    'Not a regression from #745. The hole was introduced in #590.',
  );
  assert.equal(found?.marker, 'introduced-in');
  assert.deepEqual(found!.ref, { kind: 'pull-request', number: 590 });
  assert.equal(
    refNumber(
      parseRootCause('The test did not run in CI; it was introduced in #590.')
        ?.ref,
    ),
    590,
  );
});

// The code review of #928 ran these against the first version, which knew a
// short list of negations and only the curly forms of two of them.
test('any n’t contraction, with either apostrophe, is a negation', () => {
  for (const neg of [
    "isn't",
    "wasn't",
    "aren't",
    "weren't",
    "doesn't",
    "didn't",
    "hasn't",
    "hadn't",
    "won't",
    "don't",
    "can't",
  ])
    for (const word of [neg, neg.replace("'", '’')])
      assert.equal(
        parseRootCause(`It ${word} caused by #590.`),
        null,
        `"${word}" was not read as a negation`,
      );
  assert.equal(
    parseRootCause("This doesn't look like it was introduced by #590."),
    null,
  );
  assert.equal(parseRootCause("It hasn't been caused by #590."), null);
});

// A comma joins clauses as often as it sets off an aside, so a negation does
// not reach across one: "was not, in fact, introduced by #590" stays
// attribution. Declined deliberately in the review of #928 — a comma splice
// hiding a real origin is worse than an aside that counts one.
test('a negation does not reach across a comma', () => {
  assert.equal(
    refNumber(
      parseRootCause('The test did not run in CI, it was introduced in #590.')
        ?.ref,
    ),
    590,
  );
});

// "no" is a negation only when it denies: "no doubt", "no denying", "no
// question", "no less", "no more" affirm what follows (review of #928).
test('an affirming "no" idiom is not a negation', () => {
  for (const text of [
    'There is no doubt this was caused by #590.',
    "There's no denying this was caused by #590.",
    'It is no question it was introduced in #590.',
    'It was no less clearly introduced by #590 than anything else.',
  ])
    assert.equal(refNumber(parseRootCause(text)?.ref), 590, text);
  assert.equal(parseRootCause('No regression from #590 here.'), null);
});

// A blank line starts a new paragraph, and a negation does not reach into
// it. A single line break does not stop it: commit bodies wrap mid-sentence
// at 72 columns, so "was not\nintroduced in #590" is one clause.
test('a negation stops at a paragraph break but not at a wrapped line', () => {
  assert.equal(
    refNumber(
      parseRootCause(
        'Not a regression from anything\n\nintroduced in #590 is the cause.',
      )?.ref,
    ),
    590,
  );
  assert.equal(parseRootCause('This was not\nintroduced in #590.'), null);
});

// The acceptance criterion this file exists for: a fix that names no root
// cause must be visible, not absent. Returning null is what lands it in
// `unattributed` rather than dropping it from the denominator.
test('a fix that names no root cause parses to null', () => {
  assert.equal(
    parseRootCause('Tidy the jsdom polyfills.\n\nCloses #707'),
    null,
  );
  assert.equal(parseRootCause(''), null);
  assert.equal(parseRootCause(undefined), null);
  assert.equal(parseRootCause(null), null);
});

// Reading a closing keyword as attribution would blame every fix on its own
// ticket and produce a rate made entirely of artefacts.
test('closing keywords are not attribution', () => {
  for (const keyword of ['Closes', 'Fixes', 'Resolves', 'Refs', 'See'])
    assert.equal(
      parseRootCause(`${keyword} #721`),
      null,
      `${keyword} was read as a root cause`,
    );
});

test('a commit reference is a reference too, and a word that looks like hex is not', () => {
  assert.deepEqual(parseRootCause('Introduced in a25dcac5.')?.ref, {
    kind: 'commit',
    sha: 'a25dcac5',
  });
  // "defaced" is seven letters, all of them valid hex digits. A sha needs a
  // digit in it, or English prose starts resolving to commits.
  assert.equal(parseRootCause('Introduced in defaced code.'), null);
});

test('the earliest reference wins and the others are carried, not discarded', () => {
  const found = parseRootCause(
    'Introduced in #590; the same mistake was caused by #601.',
  );
  assert.deepEqual(found!.ref, { kind: 'pull-request', number: 590 });
  assert.equal(found!.marker, 'introduced-in');
  assert.deepEqual(
    found!.others.map((o) => refNumber(o.ref)),
    [601],
  );
});

test('the same Pull Request named twice is one reference', () => {
  const found = parseRootCause('Root cause: #590. It broke in #590.');
  assert.deepEqual(found!.others, []);
});

test('the quote carries enough text for a human to audit the match', () => {
  const found = parseRootCause(
    'The vault page has had this since #590, and no spec covered it.',
  );
  assert.equal(found!.marker, 'dates-to');
  assert.match(found!.quote, /vault page has had this since #590/);
});

test('sources are consulted in a fixed order, and the winner says which it was', () => {
  assert.deepEqual(ATTRIBUTION_SOURCES, ['issue', 'body', 'commits']);
  const found = attributeFix({
    issue: 'Root cause: #100.',
    body: 'Introduced in #200.',
    commits: 'Broke in #300.',
  });
  assert.equal(found!.source, 'issue');
  assert.equal(refNumber(found!.ref), 100);

  const fallback = attributeFix({
    issue: null,
    body: null,
    commits: 'Broke in #300.',
  });
  assert.equal(fallback!.source, 'commits');
  assert.equal(refNumber(fallback!.ref), 300);

  assert.equal(attributeFix({ commits: 'Closes #721' }), null);
  assert.equal(attributeFix({}), null);
});

// ADR 0100: a fix that looked and found nothing says so, and that is a
// recorded outcome rather than silence.
test('an Introduced in unknown line is a declaration with no reference', () => {
  const found = attributeFix({
    commits:
      'fix(vault): keep the blob\n\nIntroduced in unknown: predates the pull request history.\n',
  });
  assert.equal(found!.marker, 'origin-unknown');
  assert.equal(found!.ref, null);
  assert.equal(found!.source, 'commits');
  assert.match(found!.quote, /^Introduced in unknown: predates/);
});

test('a named reference in any source outranks a declared-unknown origin', () => {
  const found = attributeFix({
    issue: 'Introduced in unknown: could not find it.',
    commits: 'Introduced in #415',
  });
  assert.equal(found!.marker, 'introduced-in');
  assert.equal(refNumber(found!.ref), 415);
});

test('the declaration is read only at the start of a line', () => {
  assert.equal(
    attributeFix({ commits: 'It was introduced in unknown ways.' }),
    null,
  );
});

test('the declaration needs its reason, on the same line', () => {
  assert.equal(attributeFix({ commits: 'Introduced in unknown' }), null);
  assert.equal(attributeFix({ commits: 'Introduced in unknown:   ' }), null);
  assert.equal(attributeFix({ commits: 'Introduced in\nunknown: x' }), null);
});

// ---------------------------------------------------------------------------
// Reading a verdict back out of a published review
// ---------------------------------------------------------------------------

const summaryFor = (verdict: Verdict) =>
  summaryBody({
    rendered: `${verdictHeading(verdict)}\n\n- range: \`aaaaaaa...bbbbbbb\`\n`,
    headSha: 'b'.repeat(40),
    runUrl: 'https://example.invalid/run/1',
  });

test('every verdict the contract can compute is read back from a real summary', () => {
  for (const verdict of VERDICT_VALUES) {
    const read = parseReviewOutcome([{ body: summaryFor(verdict) }]);
    assert.equal(read.verdict, verdict);
    assert.equal(read.outcome, VERDICT_OUTCOMES[verdict]);
  }
});

// `Agent Verdict` fails only on request-changes (ADR 0073), so a `comment`
// verdict is a Pull Request the reviewer let through.
test('comment is a pass and request-changes is not', () => {
  assert.equal(VERDICT_OUTCOMES.comment, 'passed');
  assert.equal(VERDICT_OUTCOMES.approve, 'passed');
  assert.equal(VERDICT_OUTCOMES['request-changes'], 'blocked');
});

test('a rejected report is no-verdict, which is not a pass', () => {
  const body = rejectedBody({
    reason: 'report did not meet the finding contract',
    headSha: 'c'.repeat(40),
    runUrl: 'https://example.invalid/run/2',
  });
  assert.deepEqual(parseReviewOutcome([{ body }]), {
    outcome: 'no-verdict',
    verdict: null,
  });
});

test('a Pull Request with no summary comment was never reviewed', () => {
  assert.deepEqual(
    parseReviewOutcome([{ body: 'LGTM' }, { body: 'thanks!' }]),
    { outcome: 'unreviewed', verdict: null },
  );
  assert.equal(parseReviewOutcome([]).outcome, 'unreviewed');
  assert.equal(parseReviewOutcome().outcome, 'unreviewed');
});

test('the latest summary decides, not the first', () => {
  const read = parseReviewOutcome([
    { body: summaryFor('request-changes') },
    { body: summaryFor('approve') },
  ]);
  assert.equal(read.verdict, 'approve');
});

// A heading nothing recognises must not be guessed at. Guessing adds
// fabricated passes to the denominator, which is the one number that must
// not be flattered.
test('an unreadable summary is unrecognised, never passed', () => {
  const read = parseReviewOutcome([
    { body: `${SUMMARY_MARKER}\n\n# Code review — Looks fine to me\n` },
  ]);
  assert.deepEqual(read, { outcome: 'unrecognised', verdict: null });
});

test('the parser reads the publisher, not a second copy of its wording', () => {
  assert.ok(summaryFor('approve').includes(verdictHeading('approve')));
  assert.ok(
    rejectedBody({
      reason: 'x',
      headSha: 'd'.repeat(40),
      runUrl: 'u',
    }).includes(NO_VERDICT_HEADING),
  );
});

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const fix: FixSubject = { number: 800, mergedAt: '2026-09-10T00:00:00Z' };
const attribution: FixAttribution = {
  source: 'body',
  ref: { kind: 'pull-request', number: 700 },
  marker: 'introduced-in',
  quote: 'introduced in #700',
  others: [],
};
const rootCause = (
  outcome: string | null | undefined,
  verdict: string | null = outcome === 'passed' ? 'approve' : null,
): RootCausePullRequest => ({
  number: 700,
  mergedAt: '2026-09-01T00:00:00Z',
  outcome,
  verdict,
});

test('an outcome maps to exactly one class, and every outcome has one', () => {
  const classes = REVIEW_OUTCOMES.map(
    (outcome) =>
      classifyFix({ fix, attribution, rootCause: rootCause(outcome) }).class,
  );
  assert.deepEqual(classes, [
    'escaped',
    'blocked',
    'no-verdict',
    'unreviewed',
    'unrecognised',
  ]);
  for (const c of classes) assert.ok(FIX_CLASSES.includes(c));
});

test('a fix with no attribution is counted as unattributed', () => {
  const row = classifyFix({ fix, attribution: null, rootCause: null });
  assert.equal(row.class, 'unattributed');
  assert.equal(row.number, 800);
});

test('a declared-unknown origin has its own class and no root cause', () => {
  const row = classifyFix({
    fix,
    attribution: attributeFix({ commits: 'Introduced in unknown: gone.' }),
    rootCause: null,
  });
  assert.equal(row.class, 'origin-unknown');
  assert.equal(row.rootCause, null);
  assert.ok(FIX_CLASSES.includes(row.class));
});

test('an attribution that resolves to nothing is unresolved, not dropped', () => {
  assert.equal(
    classifyFix({ fix, attribution, rootCause: null }).class,
    'unresolved',
  );
});

test('a root cause that merged after its fix is a data error, not an escape', () => {
  const later = { ...rootCause('passed'), mergedAt: '2026-09-11T00:00:00Z' };
  assert.equal(
    classifyFix({ fix, attribution, rootCause: later }).class,
    'not-earlier',
  );
});

// A fix citing a commit from its own branch names its own work. The first run
// over real history produced exactly this, through a commit reference that
// resolved back to the fix's own Pull Request.
test('a fix cannot be its own root cause', () => {
  const itself = { ...rootCause('passed'), number: fix.number };
  assert.equal(
    classifyFix({ fix, attribution, rootCause: itself }).class,
    'not-earlier',
  );
});

test('a review status nobody could look up is unknown, not passed', () => {
  assert.equal(
    classifyFix({ fix, attribution, rootCause: rootCause(undefined) }).class,
    'unknown',
  );
  assert.equal(
    classifyFix({ fix, attribution, rootCause: rootCause('nonsense') }).class,
    'unknown',
  );
});

// ---------------------------------------------------------------------------
// The rate
// ---------------------------------------------------------------------------

const window = { since: '2026-07-13', until: '2026-09-11' };

test('the rate is escaped Pull Requests over Pull Requests the reviewer passed', () => {
  const summary = summarize({
    window,
    fixes: [
      classifyFix({ fix, attribution, rootCause: rootCause('passed') }),
      classifyFix({
        fix: { number: 801, mergedAt: '2026-09-10T00:00:00Z' },
        attribution: null,
        rootCause: null,
      }),
    ],
    passed: [
      { number: 700 },
      { number: 701 },
      { number: 702 },
      { number: 703 },
    ],
  });
  assert.equal(summary.denominator, 4);
  assert.deepEqual(summary.escaped, [700]);
  assert.equal(summary.rate, 0.25);
  assert.equal(summary.sample.fixes, 2);
  assert.equal(summary.sample.attributed, 1);
  assert.equal(summary.sample.unattributed, 1);
});

test('a declared-unknown fix is neither attributed nor unattributed, and renders', () => {
  const summary = summarize({
    window,
    fixes: [
      classifyFix({
        fix,
        attribution: attributeFix({ commits: 'Introduced in unknown: gone.' }),
        rootCause: null,
      }),
    ],
    passed: [],
  });
  assert.equal(summary.sample.attributed, 0);
  assert.equal(summary.sample.originUnknown, 1);
  assert.equal(summary.sample.unattributed, 0);
  assert.equal(summary.classes['origin-unknown'], 1);
  const markdown = renderMeasurement(summary);
  assert.match(markdown, /declaring it unknown: \*\*1\*\*/);
  assert.doesNotMatch(markdown, /## Attributed fixes/);
});

test('two fixes naming one Pull Request are one escaped defect', () => {
  const summary = summarize({
    window,
    fixes: [
      classifyFix({ fix, attribution, rootCause: rootCause('passed') }),
      classifyFix({
        fix: { number: 802, mergedAt: '2026-09-10T00:00:00Z' },
        attribution,
        rootCause: rootCause('passed'),
      }),
    ],
    passed: [{ number: 700 }, { number: 701 }],
  });
  assert.deepEqual(summary.escaped, [700]);
  assert.equal(summary.rate, 0.5);
});

// 0/0 is the state this repository is in until enough Pull Requests have been
// through the pipeline, and "0%" would read as the opposite of it.
test('an empty denominator is not measurable, and is not zero', () => {
  const summary = summarize({
    window,
    fixes: [
      classifyFix({ fix, attribution, rootCause: rootCause('unreviewed') }),
    ],
    passed: [],
  });
  assert.equal(summary.rate, null);
  assert.equal(summary.denominator, 0);
  assert.equal(summary.classes.unreviewed, 1);
  assert.equal(summary.classes.escaped, 0);
  assert.match(renderMeasurement(summary), /not yet measurable/);
});

// A denominator of four means something else when twenty more went unread.
test('Pull Requests whose review could not be read are reported beside the denominator', () => {
  const summary = summarize({
    window,
    fixes: [],
    passed: [{ number: 700 }],
    unreadable: 24,
  });
  assert.equal(summary.denominator, 1);
  assert.equal(summary.unreadable, 24);
  assert.match(
    renderMeasurement(summary),
    /Review status unreadable for \*\*24\*\* more Pull Requests/,
  );
  // Silence when there is nothing to disclose.
  assert.doesNotMatch(
    renderMeasurement(summarize({ window, fixes: [], passed: [] })),
    /unreadable/,
  );
});

test('every class is reported, including the ones nothing landed in', () => {
  const summary = summarize({ window, fixes: [], passed: [] });
  for (const c of FIX_CLASSES) assert.equal(summary.classes[c], 0);
  const markdown = renderMeasurement(summary);
  for (const c of FIX_CLASSES) assert.match(markdown, new RegExp(`\`${c}\``));
});

// The rate is "of the Pull Requests the reviewer passed **in the window**".
// An escape naming a Pull Request that passed before the window opened is a
// numerator from one population over a denominator from another — it read as
// 50% here, and enough of them would read as more than 100%.
test('an escape outside the denominator window is reported and kept out of the rate', () => {
  const summary = summarize({
    window,
    fixes: [classifyFix({ fix, attribution, rootCause: rootCause('passed') })],
    passed: [{ number: 999 }, { number: 998 }],
  });
  assert.deepEqual(summary.outsideDenominator, [700]);
  assert.deepEqual(summary.escaped, []);
  assert.equal(summary.rate, 0);
  assert.match(renderMeasurement(summary), /outside the denominator window/);
  assert.match(
    renderMeasurement(summary),
    /named as root cause by a later fix: \*\*0\*\*/,
  );
});

test('the rendered measurement states its sample size and its period', () => {
  const markdown = renderMeasurement(
    summarize({
      window,
      fixes: [
        classifyFix({ fix, attribution, rootCause: rootCause('passed') }),
      ],
      passed: [{ number: 700 }, { number: 701 }],
      evidence: { 'commit messages (git)': 'read' },
    }),
  );
  assert.match(markdown, /2026-07-13 to 2026-09-11/);
  assert.match(markdown, /fixes merged in the window: \*\*1\*\*/);
  assert.match(markdown, /escaped-defect rate: 50\.0%/);
  assert.match(markdown, /introduced in #700/);
  assert.match(markdown, /commit messages \(git\): read/);
  // Which verdict the root cause carried, not only that it passed: `approve`
  // and `comment` are both passes and the reader is judging the miss.
  assert.match(markdown, /\| `approve` \|/);
  // The marker that matched, with the reason it counts as attribution, so a
  // weak match can be rejected by whoever reads the row.
  assert.match(markdown, /The archaeology sentence/);
});
