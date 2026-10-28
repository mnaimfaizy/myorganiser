import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SUMMARY_MARKER,
  findingIdsIn,
  findingMarker,
  inlineComments,
  planPublication,
  planRelabel,
  summariesToOutdate,
  targetTierLabel,
  threadsToResolve,
} from './publish.ts';
import type { PublishableReport } from './publish.ts';
import type { NormalizedFinding, ReviewTierLabel, Verdict } from './schema.ts';
import { REPORT_SCHEMA_VERSION } from './schema.ts';

const finding = (over: Partial<NormalizedFinding> = {}): NormalizedFinding => ({
  id: 'abc123def456',
  axis: 'standards',
  severity: 'blocking',
  summary: 'a thing',
  ruleId: 'standard-enum-fanout-not-pinned',
  source: 'AGENTS.md',
  rule: 'the rule',
  evidence: {
    kind: 'cited',
    sourceKind: 'standard',
    quote: 'q',
    untrusted: false,
  },
  location: {
    file: 'libs/a.ts',
    startLine: 3,
    endLine: 5,
    headSha: 'a'.repeat(40),
  },
  ...over,
});

const normalized = (
  findings: NormalizedFinding[],
  verdict: Verdict = 'request-changes',
  effectiveTier: ReviewTierLabel | null = 'review:agent',
): PublishableReport => ({ verdict, effectiveTier, findings });

const ctx = {
  tier: 'review:agent' as ReviewTierLabel,
  headSha: 'a'.repeat(40),
  runUrl: 'https://example.test/run/1',
  currentLabels: ['tooling', 'review:agent'],
};

test('a blocking verdict targets human; otherwise the effective tier; no tier stays null', () => {
  assert.equal(
    targetTierLabel({
      tier: 'review:auto',
      effectiveTier: 'review:auto',
      verdict: 'request-changes',
    }),
    'review:human',
  );
  assert.equal(
    targetTierLabel({
      tier: 'review:agent',
      effectiveTier: 'review:human',
      verdict: 'comment',
    }),
    'review:human',
  );
  assert.equal(
    targetTierLabel({
      tier: 'review:agent',
      effectiveTier: 'review:agent',
      verdict: 'approve',
    }),
    'review:agent',
  );
  assert.equal(
    targetTierLabel({ tier: null, effectiveTier: null, verdict: 'approve' }),
    null,
  );
  // A verdict outside the contract's enum is the point of this one.
  assert.throws(
    () => targetTierLabel({ verdict: 'lgtm' as Verdict }),
    /unknown verdict/,
  );
});

test('relabel adds the target and removes the other review labels, or does nothing', () => {
  assert.deepEqual(planRelabel(['tooling', 'review:agent'], 'review:human'), {
    add: ['review:human'],
    remove: ['review:agent'],
  });
  assert.equal(planRelabel(['tooling', 'review:human'], 'review:human'), null);
  assert.equal(planRelabel(['tooling'], null), null);
  assert.deepEqual(planRelabel([], 'review:auto'), {
    add: ['review:auto'],
    remove: [],
  });
  assert.throws(() => planRelabel([], 'review:ship'), /unknown tier label/);
});

test('inline comments: blocking with a location only, and not while a thread is open', () => {
  const out = inlineComments({
    findings: [
      finding(),
      finding({ id: 'ffffffffffff', severity: 'should-fix' }),
      finding({ id: 'eeeeeeeeeeee', location: undefined }),
      finding({
        id: 'dddddddddddd',
        location: { file: 'x.ts', startLine: 9, headSha: 'a'.repeat(40) },
      }),
    ],
    openThreadBodies: [`hello ${findingMarker('dddddddddddd')} world`],
  });
  assert.deepEqual(
    out.map((c) => [c.id, c.path, c.line, c.startLine]),
    [['abc123def456', 'libs/a.ts', 5, 3]],
  );
  assert.ok(out[0].body.startsWith(findingMarker('abc123def456')));
  assert.match(out[0].body, /\*\*Blocking · Standards\*\*/);
  // The bounded id is on the inline comment, not just the summary: it is what
  // a maintainer replying to the thread needs in order to say which rule they
  // are declining, and it is the field that decides whether the next run
  // recognises this thread as the same finding (issue #724).
  assert.match(
    out[0].body,
    /Rule: `standard-enum-fanout-not-pinned` — the rule \(AGENTS\.md\)/,
  );
  assert.match(out[0].body, /Evidence: cited standard: `q`/);
});

test('a finding that was resolved and comes back gets a fresh inline comment', () => {
  // Only open threads suppress a repost; a resolved thread is history.
  const out = inlineComments({ findings: [finding()], openThreadBodies: [] });
  assert.equal(out.length, 1);
});

test('threads resolve when their finding is gone, never when it persists or when a human wrote them', () => {
  const resolve = threadsToResolve({
    findings: [finding({ id: 'aaaaaaaaaaaa' })],
    openThreads: [
      { id: 'T1', body: `${findingMarker('aaaaaaaaaaaa')} still here` },
      { id: 'T2', body: `${findingMarker('bbbbbbbbbbbb')} gone` },
      { id: 'T3', body: 'a human asked a question' },
    ],
  });
  assert.deepEqual(resolve, ['T2']);
});

// The other half of the schema bump (issue #718). The renderer's strip is not
// the only thing that reads an id: the publisher resolves threads by id too,
// and on the run that changes how ids are derived every stored id is absent.
// Left ungated, that run would close every open thread on every Pull Request
// at once — ignored blocking feedback certified as fixed, one last time.
test('a thread from an earlier report schema version is neither reused nor resolved', () => {
  const stale = `<!-- code-review:finding:v${REPORT_SCHEMA_VERSION - 1}:aaaaaaaaaaaa --> raised before the bump`;
  assert.deepEqual(findingIdsIn(stale), []);
  // Not resolved: this run does not recognise the id, so the thread is a
  // human's as far as it is concerned.
  assert.deepEqual(
    threadsToResolve({
      findings: [],
      openThreads: [{ id: 'T1', body: stale }],
    }),
    [],
  );
  // Not reused either: a live blocking finding still gets its own comment at
  // the id this version mints, rather than being suppressed by a thread whose
  // id means something else.
  const out = inlineComments({
    findings: [finding()],
    openThreadBodies: [stale],
  });
  assert.deepEqual(
    out.map((c) => c.id),
    ['abc123def456'],
  );
  assert.ok(out[0].body.startsWith(findingMarker('abc123def456')));
});

test('previous summaries are marked outdated, never deleted, and only once', () => {
  assert.deepEqual(
    summariesToOutdate([
      { nodeId: 'C1', body: `${SUMMARY_MARKER} old` },
      { nodeId: 'C2', body: `${SUMMARY_MARKER} older`, minimized: true },
      { nodeId: 'C3', body: 'a human comment' },
    ]),
    ['C1'],
  );
});

test('a published plan: new summary, outdated predecessors, inline set, resolutions, relabel, check outcome', () => {
  const plan = planPublication({
    ...ctx,
    normalized: normalized([finding()]),
    rendered: '# Code review — request changes\n\nbody\n',
    existingComments: [{ nodeId: 'C1', body: `${SUMMARY_MARKER} previous` }],
    openThreads: [{ id: 'T9', body: `${findingMarker('999999999999')} x` }],
  });
  assert.equal(plan.outcome, 'published');
  assert.ok(plan.summary.startsWith(SUMMARY_MARKER));
  assert.match(plan.summary, /aaaaaaa/);
  assert.match(plan.summary, /# Code review — request changes/);
  assert.deepEqual(plan.outdate, ['C1']);
  assert.equal(plan.inline.length, 1);
  assert.deepEqual(plan.resolve, ['T9']);
  assert.deepEqual(plan.relabel, {
    add: ['review:human'],
    remove: ['review:agent'],
  });
  assert.equal(plan.failCheck, true);
});

test('an approve verdict on an agent tier leaves the label alone and passes the check', () => {
  const plan = planPublication({
    ...ctx,
    normalized: normalized([finding({ severity: 'nit' })], 'approve'),
    rendered: 'ok',
  });
  assert.equal(plan.relabel, null);
  assert.equal(plan.inline.length, 0);
  assert.equal(plan.failCheck, false);
});

test('no spec tightens the label to human even with no blocking finding', () => {
  const plan = planPublication({
    ...ctx,
    normalized: normalized([], 'approve', 'review:human'),
    rendered: 'ok',
  });
  assert.deepEqual(plan.relabel, {
    add: ['review:human'],
    remove: ['review:agent'],
  });
  assert.equal(plan.failCheck, false);
});

test('a rejected report posts the reason, outdates the last summary, resolves nothing, relabels to human, fails the check', () => {
  const plan = planPublication({
    ...ctx,
    rejectedReason: 'findings.0: blocking needs evidence\n',
    existingComments: [{ nodeId: 'C1', body: `${SUMMARY_MARKER} previous` }],
    openThreads: [{ id: 'T1', body: `${findingMarker('aaaaaaaaaaaa')} x` }],
  });
  assert.equal(plan.outcome, 'rejected');
  assert.equal(plan.verdict, null);
  assert.match(plan.summary, /no verdict/);
  assert.match(plan.summary, /blocking needs evidence/);
  assert.deepEqual(plan.outdate, ['C1']);
  assert.deepEqual(plan.resolve, []);
  assert.deepEqual(plan.relabel, {
    add: ['review:human'],
    remove: ['review:agent'],
  });
  assert.equal(plan.failCheck, true);
});

test('a rejected report on an interactive run (no tier) does not relabel', () => {
  const plan = planPublication({
    ...ctx,
    tier: null,
    currentLabels: [],
    rejectedReason: 'x',
  });
  assert.equal(plan.relabel, null);
});
