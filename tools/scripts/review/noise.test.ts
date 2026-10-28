/**
 * The effective-false-positive measurement (issue #729): what a finding did
 * between two pushes, and what that does to its rule's rate.
 *
 * The three cases the issue names — acted on, ignored, excluded by the
 * marker — are the first three tests. The rest defend the classes that keep
 * the denominator auditable: a finding with no next push, a push with no
 * report, and a pair spanning a schema bump are each set aside by name
 * rather than counted as either action or inaction.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLASS_ROLES,
  NOISE_BUDGET,
  OBSERVATION_CLASSES,
  OPT_OUT_MARKER,
  RULE_STATUSES,
  UNNAMED_RULE,
  acknowledgementsIn,
  observeBranch,
  parseAcknowledgements,
  rateOf,
  renderNoiseMeasurement,
  statusOf,
  summarizeNoise,
} from './noise.ts';
import type {
  ObservedFinding,
  Observation,
  Push,
  PushCommit,
} from './noise.ts';
import { REPORT_SCHEMA_VERSION, normalizeReport } from './schema.ts';

const sha = (c: string) => c.repeat(40);

const finding = (
  id: string,
  ruleId = 'standard-other',
  extra: Partial<ObservedFinding> = {},
): ObservedFinding => ({
  id,
  ruleId,
  axis: 'standards',
  severity: 'should-fix',
  location: { file: 'libs/a/src/a.ts', startLine: 1, headSha: sha('a') },
  ...extra,
});

const push = (
  headSha: string,
  findings: ObservedFinding[] | null,
  {
    commits,
    schemaVersion,
  }: { commits?: PushCommit[]; schemaVersion?: number } = {},
): Push => ({
  headSha,
  createdAt: '2026-09-08T10:00:00Z',
  report:
    findings === null
      ? null
      : {
          schemaVersion: schemaVersion ?? REPORT_SCHEMA_VERSION,
          head: headSha,
          findings,
        },
  ...(commits ? { commits } : {}),
});

const classesOf = (rows: Observation[]) => rows.map((r) => r.class);

// ---------------------------------------------------------------------------
// The three cases the issue names
// ---------------------------------------------------------------------------

test('a finding gone on the next push is acted on', () => {
  const rows = observeBranch({
    branch: 'feat/a',
    pushes: [push(sha('a'), [finding('0123456789ab')]), push(sha('b'), [])],
  });
  assert.deepEqual(classesOf(rows), ['acted-on']);
  assert.deepEqual(rateOf(rows), { observations: 1, ignored: 0, rate: 0 });
});

test('a finding still there on the next push is ignored', () => {
  const rows = observeBranch({
    branch: 'feat/a',
    pushes: [
      push(sha('a'), [finding('0123456789ab')]),
      push(sha('b'), [finding('0123456789ab')]),
    ],
  });
  // The same finding on the newest push is `pending`: it has had no chance to
  // be acted on yet, and counting it twice would double every stubborn
  // finding's weight.
  assert.deepEqual(classesOf(rows), ['ignored', 'pending']);
  assert.deepEqual(rateOf(rows), { observations: 1, ignored: 1, rate: 1 });
});

// The marker's whole job: the finding is still there, and the author said so.
// It leaves the numerator, and it leaves the denominator with it — counting
// it as a positive action would let one line of commit message manufacture
// evidence that a rule is useful.
test('an acknowledged finding leaves the numerator and the denominator', () => {
  const rows = observeBranch({
    branch: 'feat/a',
    pushes: [
      push(sha('a'), [finding('0123456789ab')]),
      push(sha('b'), [finding('0123456789ab')], {
        commits: [
          {
            sha: sha('c'),
            message:
              'fix(a): something else\n\nReview-ack: 0123456789ab — real, deferred to the follow-up\n',
          },
        ],
      }),
    ],
  });
  assert.deepEqual(classesOf(rows), ['acknowledged', 'pending']);
  assert.equal(rows[0].acknowledgedBy!.sha, sha('c'));
  assert.deepEqual(rateOf(rows), {
    observations: 0,
    ignored: 0,
    rate: null,
  });
  assert.equal(CLASS_ROLES.acknowledged, 'set-aside');
});

// ---------------------------------------------------------------------------
// The marker itself
// ---------------------------------------------------------------------------

test('the marker is line-anchored, case-insensitive, and takes several ids', () => {
  const found = parseAcknowledgements(
    [
      'fix(a): b',
      '',
      '  review-ack: 0123456789ab, ffffffffffff  ',
      'Closes #729',
    ].join('\n'),
  );
  assert.deepEqual([...found.keys()], ['0123456789ab', 'ffffffffffff']);
  assert.match(found.get('0123456789ab')!.quote, /review-ack:/i);
});

// Prose about the marker is not the marker. `Closes #N` is anchored the same
// way for the same reason: a sentence discussing an acknowledgement would
// otherwise silently remove a finding from the measurement.
test('the marker mid-sentence is prose, not an acknowledgement', () => {
  assert.equal(
    parseAcknowledgements(
      'We considered whether to Review-ack: 0123456789ab and decided not to.',
    ).size,
    0,
  );
});

// A rule id would excuse findings the author never read, including ones
// raised after the acknowledgement was written, and would zero a rule's rate
// in one line. Only the 12-hex finding id the report prints is accepted.
test('the marker names finding ids and nothing else', () => {
  assert.equal(parseAcknowledgements('Review-ack: standard-other').size, 0);
  assert.equal(parseAcknowledgements('Review-ack: #729').size, 0);
  assert.equal(parseAcknowledgements('Review-ack: all').size, 0);
});

test('the first commit to acknowledge an id owns it', () => {
  const found = acknowledgementsIn([
    { sha: sha('1'), message: 'Review-ack: 0123456789ab — first' },
    { sha: sha('2'), message: 'Review-ack: 0123456789ab — second' },
  ]);
  assert.equal(found.get('0123456789ab')!.sha, sha('1'));
  assert.equal(acknowledgementsIn().size, 0);
});

// An acknowledgement never moves an observation *into* the numerator: a
// finding that went away was acted on, whatever the commit also said.
test('an acknowledgement on a finding that went away is still acted on', () => {
  const rows = observeBranch({
    pushes: [
      push(sha('a'), [finding('0123456789ab')]),
      push(sha('b'), [], {
        commits: [{ sha: sha('c'), message: 'Review-ack: 0123456789ab' }],
      }),
    ],
  });
  assert.deepEqual(classesOf(rows), ['acted-on']);
});

// An acknowledgement written once holds while the finding it names survives.
// Requiring it on every push would be the per-finding labelling ritual the
// measurement exists to avoid — and the author who typed it once has already
// said the inaction is not silent.
test('an acknowledgement holds for later pushes without being repeated', () => {
  const rows = observeBranch({
    pushes: [
      push(sha('a'), [finding('0123456789ab')]),
      push(sha('b'), [finding('0123456789ab')], {
        commits: [{ sha: sha('c'), message: 'Review-ack: 0123456789ab' }],
      }),
      push(sha('d'), [finding('0123456789ab')], {
        commits: [{ sha: sha('e'), message: 'chore(a): unrelated' }],
      }),
    ],
  });
  assert.deepEqual(classesOf(rows), [
    'acknowledged',
    'acknowledged',
    'pending',
  ]);
  assert.equal(rateOf(rows).observations, 0);
});

// Forward only. A marker written on the third push says nothing about what
// happened between the first and the second, and back-dating it would let an
// acknowledgement erase inaction that had already been observed.
test('an acknowledgement does not reach back to earlier pushes', () => {
  const rows = observeBranch({
    pushes: [
      push(sha('a'), [finding('0123456789ab')]),
      push(sha('b'), [finding('0123456789ab')]),
      push(sha('d'), [finding('0123456789ab')], {
        commits: [{ sha: sha('e'), message: 'Review-ack: 0123456789ab' }],
      }),
    ],
  });
  assert.deepEqual(classesOf(rows), ['ignored', 'acknowledged', 'pending']);
  assert.deepEqual(rateOf(rows), { observations: 1, ignored: 1, rate: 1 });
});

// ---------------------------------------------------------------------------
// The classes that say nothing, and are counted anyway
// ---------------------------------------------------------------------------

test('a finding on the newest push is pending, not ignored', () => {
  const rows = observeBranch({
    pushes: [push(sha('a'), [finding('0123456789ab')])],
  });
  assert.deepEqual(classesOf(rows), ['pending']);
  assert.equal(rows[0].nextPush, null);
  assert.equal(rateOf(rows).rate, null);
});

test('a push with no report makes the findings before it unreadable', () => {
  const rows = observeBranch({
    pushes: [push(sha('a'), [finding('0123456789ab')]), push(sha('b'), null)],
  });
  assert.deepEqual(classesOf(rows), ['unreadable']);
  assert.equal(rateOf(rows).observations, 0);
});

// Identities are only comparable within a schema version — a report written
// before `ruleId` entered the tuple carries ids this run can never mint — so
// a pair spanning a bump is not a diff. Reading one as a diff is exactly the
// mass auto-resolve issue #718 cost.
test('a pair spanning a report schema version is incomparable', () => {
  for (const [older, newer] of [
    [REPORT_SCHEMA_VERSION - 1, REPORT_SCHEMA_VERSION],
    [REPORT_SCHEMA_VERSION, REPORT_SCHEMA_VERSION - 1],
  ]) {
    const rows = observeBranch({
      pushes: [
        push(sha('a'), [finding('0123456789ab')], { schemaVersion: older }),
        push(sha('b'), [finding('0123456789ab')], { schemaVersion: newer }),
      ],
    });
    assert.deepEqual(classesOf(rows), ['incomparable', 'pending']);
    assert.deepEqual(rows[0].schemaVersions, [older, newer]);
  }
});

// A pre-`ruleId` report's findings still become rows, and a row has to say
// which rule it belongs to. Grouping them under a missing key published a
// per-rule line named `undefined` — a JavaScript primitive in a document
// people read.
test('a finding with no rule id is grouped under a name, not under undefined', () => {
  const legacy = (id: string) => {
    const f = finding(id);
    delete f.ruleId;
    return f;
  };
  const summary = summarizeNoise({
    branches: [
      {
        branch: 'feat/old',
        pushes: [
          push(sha('a'), [legacy('0123456789ab')], { schemaVersion: 2 }),
          push(sha('b'), [], { schemaVersion: 2 }),
        ],
      },
    ],
  });
  assert.deepEqual(
    summary.rules.map((r) => r.ruleId),
    [UNNAMED_RULE],
  );
  const markdown = renderNoiseMeasurement(summary);
  assert.doesNotMatch(markdown, /undefined/);
  assert.match(markdown, new RegExp(`\\| \`\\${'('}no rule id\\)\` \\|`));
});

// The unit is an observation, not a finding: a finding nobody removes costs
// attention on every push it survives, and the rate says so.
test('a finding that survives three pushes is two ignored observations', () => {
  const rows = observeBranch({
    pushes: [
      push(sha('a'), [finding('0123456789ab')]),
      push(sha('b'), [finding('0123456789ab')]),
      push(sha('c'), [finding('0123456789ab')]),
    ],
  });
  assert.deepEqual(classesOf(rows), ['ignored', 'ignored', 'pending']);
  assert.deepEqual(rateOf(rows), { observations: 2, ignored: 2, rate: 1 });
});

// Issue #940. The measurement compares ids, so it is exactly as good as the
// identity behind them. This runs the real validator across three pushes of
// one branch — the #928 sequence — rather than hand-written ids: one rule,
// one file, a defect fixed and an unrelated one raised, then that one left
// alone. Under `axis + ruleId + file` the first two shared an id, so the fix
// read as inaction and the acknowledgement written for the first defect
// covered the second, which its author had never seen.
test('a defect fixed and another raised under the same rule and file is acted on, and its acknowledgement does not travel', () => {
  const report = (
    head: string,
    startLine: number,
    endLine: number,
    previous?: unknown,
  ) =>
    normalizeReport(
      {
        schemaVersion: REPORT_SCHEMA_VERSION,
        base: sha('0'),
        head,
        tier: null,
        spec: { kind: 'none', foundBy: 'none' },
        standardsSources: ['AGENTS.md'],
        executed: [],
        suppressed: { redundant: 0 },
        model: 'm',
        durationMs: 1,
        findings: [
          {
            axis: 'standards',
            severity: 'nit',
            summary: 's',
            ruleId: 'standard-missing-focused-test',
            source: 'AGENTS.md',
            rule: 'r',
            evidence: { kind: 'inferred', reasoning: 'r' },
            location: {
              file: 'tools/scripts/review/escaped-defects.ts',
              startLine,
              endLine,
              headSha: head,
            },
          },
        ],
      },
      { previous },
    );
  const first = report(sha('a'), 188, 193, null);
  const second = report(sha('b'), 240, 246, first);
  const third = report(sha('c'), 241, 246, second);
  const rows = observeBranch({
    pushes: [
      { headSha: sha('a'), report: first },
      {
        headSha: sha('b'),
        report: second,
        commits: [
          {
            sha: sha('b'),
            message: `fix: x\n\n${OPT_OUT_MARKER}: ${first.findings[0].id} — declined`,
          },
        ],
      },
      { headSha: sha('c'), report: third },
    ],
  });
  assert.deepEqual(classesOf(rows), ['acted-on', 'ignored', 'pending']);
});

test('every class has a role and the roles are the three that exist', () => {
  for (const c of OBSERVATION_CLASSES)
    assert.ok(['noise', 'signal', 'set-aside'].includes(CLASS_ROLES[c]), c);
});

// ---------------------------------------------------------------------------
// The rate, per rule, against the budget
// ---------------------------------------------------------------------------

/**
 * One two-push branch per observation of `ruleId`: `ignored` of them raise a
 * finding that is still there on the second push, `acted` of them raise one
 * that is gone. A branch apiece, so no pair of the fixture accidentally
 * observes a neighbour's finding.
 */
const id = (n: number) => String(n).padStart(12, '0');
const branchesWith = ({
  ruleId,
  ignored,
  acted,
}: {
  ruleId: string;
  ignored: number;
  acted: number;
}) => [
  ...Array.from({ length: ignored }, (_, i) => ({
    branch: `feat/${ruleId}-ignored-${i}`,
    pushes: [
      push(sha('a'), [finding(id(i), ruleId)]),
      push(sha('b'), [finding(id(i), ruleId)]),
    ],
  })),
  ...Array.from({ length: acted }, (_, i) => ({
    branch: `feat/${ruleId}-acted-${i}`,
    pushes: [
      push(sha('c'), [finding(id(100 + i), ruleId)]),
      push(sha('d'), []),
    ],
  })),
];

test('the rate is per rule, and the budget judges only above the floor', () => {
  const summary = summarizeNoise({
    window: { since: '2026-09-01', until: '2026-09-30' },
    branches: [
      // 2 ignored of 12 observed: over the 10% budget, with enough evidence.
      ...branchesWith({
        ruleId: 'smell-duplicated-code',
        ignored: 2,
        acted: 10,
      }),
      // 1 ignored of 3: a worse rate on too little evidence to judge.
      ...branchesWith({ ruleId: 'standard-other', ignored: 1, acted: 2 }),
    ],
  });
  const byId = Object.fromEntries(summary.rules.map((r) => [r.ruleId, r]));
  assert.equal(byId['smell-duplicated-code'].observations, 12);
  assert.ok(byId['smell-duplicated-code'].rate! > NOISE_BUDGET.rate);
  assert.equal(byId['smell-duplicated-code'].status, 'over-budget');
  assert.deepEqual(summary.overBudget, ['smell-duplicated-code']);
  assert.equal(byId['standard-other'].status, 'insufficient-evidence');
  assert.equal(summary.observations, 15);
  assert.equal(summary.ignored, 3);
});

// Below ten observations a single ignored finding is already over ten
// percent, so the floor is arithmetic rather than taste.
test('the floor is the point where one ignored finding is not automatically over budget', () => {
  assert.equal(NOISE_BUDGET.rate, 0.1);
  assert.equal(NOISE_BUDGET.minObservations, 10);
  assert.equal(
    statusOf({ observations: NOISE_BUDGET.minObservations, rate: 0.1 }),
    'within-budget',
  );
  assert.equal(
    statusOf({ observations: NOISE_BUDGET.minObservations - 1, rate: 1 / 9 }),
    'insufficient-evidence',
  );
  assert.equal(statusOf({ observations: 20, rate: 0.15 }), 'over-budget');
  // Whatever it answers is one of the three words the record explains.
  for (const observations of [0, 5, 10, 50])
    for (const rate of [null, 0, 0.1, 0.5, 1])
      assert.ok(
        RULE_STATUSES.includes(statusOf({ observations, rate })),
        `${observations}/${rate}`,
      );
});

// Zero would read as "findings were raised and every one was acted on", which
// is the opposite of "nothing has been observed yet".
test('an empty ledger is not measurable, never 0%', () => {
  const summary = summarizeNoise({ branches: [] });
  assert.equal(summary.rate, null);
  assert.deepEqual(summary.rules, []);
  assert.match(renderNoiseMeasurement(summary), /not yet measurable/);
});

test('the rendered measurement carries the budget, its source, and the deferral', () => {
  const summary = summarizeNoise({
    window: { since: '2026-09-01', until: '2026-09-30' },
    branches: [
      ...branchesWith({
        ruleId: 'smell-duplicated-code',
        ignored: 2,
        acted: 10,
      }),
      {
        branch: 'feat/ack',
        pushes: [
          push(sha('a'), [finding('0123456789ab')]),
          push(sha('b'), [finding('0123456789ab')], {
            commits: [{ sha: sha('c'), message: 'Review-ack: 0123456789ab' }],
          }),
        ],
      },
    ],
    evidence: { 'review runs (gh)': 'read' },
  });
  const markdown = renderNoiseMeasurement(summary);
  assert.match(markdown, /Software Engineering at Google/);
  assert.match(markdown, /10\.0% effective false positives per rule/);
  assert.match(markdown, /No rule is disabled by this measurement/);
  assert.match(markdown, new RegExp(`Acknowledged with .${OPT_OUT_MARKER}.`));
  assert.match(markdown, /\| `over-budget` \|/);
  assert.match(markdown, /review runs \(gh\): read/);
  // Every class is in the ledger, including the ones counting nothing.
  for (const c of OBSERVATION_CLASSES)
    assert.match(markdown, new RegExp(`\\| \`${c}\` \\|`));
});
