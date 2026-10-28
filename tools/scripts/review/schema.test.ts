import assert from 'node:assert/strict';
import test from 'node:test';
import type { ZodError } from 'zod';

import type { SpecSource } from './schema.ts';
import {
  REPORT_SCHEMA_VERSION,
  computeEffectiveTier,
  computeVerdict,
  FindingInputSchema,
  findingId,
  formatIssues,
  normalizeReport,
} from './schema.ts';
import { evidenceText } from './evidence.ts';
import { renderReport } from './render-review-report.ts';

const HEAD = 'abcdef1234567890abcdef1234567890abcdef12';
const BASE = '1234567890abcdef1234567890abcdef12345678';

/** A report, a finding, or a location as a fixture bends one: fields loose. */
type Overrides = Record<string, unknown>;

const envelope = (overrides: Overrides = {}) => ({
  schemaVersion: REPORT_SCHEMA_VERSION,
  base: BASE,
  head: HEAD,
  tier: 'review:agent',
  spec: { kind: 'issue', ref: '#123', foundBy: 'branch' },
  standardsSources: ['AGENTS.md'],
  executed: [],
  suppressed: { redundant: 0 },
  model: 'claude-fable-5-1',
  durationMs: 1200,
  findings: [],
  ...overrides,
});

const cited = (overrides: Overrides = {}) => ({
  axis: 'standards',
  severity: 'blocking',
  summary: 'Hand-enumerates VaultBlobType members',
  ruleId: 'standard-enum-fanout-not-pinned',
  source: 'AGENTS.md',
  rule: 'Code fanning out over a domain enum reaches one satisfies Record table',
  evidence: {
    kind: 'cited',
    sourceKind: 'standard',
    quote: 'it does not re-enumerate the members in an object literal',
    untrusted: false,
  },
  location: {
    file: 'libs/web-vault/src/sync.ts',
    startLine: 42,
    headSha: HEAD,
  },
  ...overrides,
});

const inferred = (overrides: Overrides = {}) => ({
  axis: 'standards',
  severity: 'should-fix',
  summary: 'Possible Feature Envy',
  ruleId: 'smell-feature-envy',
  source: 'smell-baseline',
  rule: 'Feature Envy',
  evidence: {
    kind: 'inferred',
    reasoning: 'reaches into three fields of another object',
  },
  ...overrides,
});

const rejects = (raw: unknown, fragment: RegExp) => {
  assert.throws(
    () => normalizeReport(raw),
    (err) => {
      // `normalizeReport` rejects by throwing the schema's own error, which
      // is what `formatIssues` reads.
      const lines = formatIssues(err as ZodError).join('\n');
      assert.match(lines, fragment);
      return true;
    },
  );
};

test('a valid report is normalized with ids, verdict, and effective tier', () => {
  const report = normalizeReport(envelope({ findings: [cited(), inferred()] }));
  assert.equal(report.verdict, 'request-changes');
  assert.equal(report.effectiveTier, 'review:agent');
  assert.equal(report.findings.length, 2);
  for (const f of report.findings) assert.match(f.id, /^[0-9a-f]{12}$/);
});

// ADR 0111. #912's review quoted ADR 0108 decision 1 as should-fix, and the
// implementer replaced the requirement with its own two-minute window.
const adrSpecFinding = (overrides = {}) =>
  cited({
    axis: 'spec',
    severity: 'should-fix',
    summary:
      'Enabling Biometric Unlock does not ask for the passphrase again first.',
    ruleId: 'spec-requirement-missing',
    source:
      'docs/adr/0108-a-mobile-device-may-hold-the-master-key-behind-a-biometric-gate.md',
    rule: 'ADR 0108 decision 1: an unattended unlocked session must not be enough.',
    evidence: {
      kind: 'cited',
      sourceKind: 'spec',
      quote:
        'Turning it on later, from Account, asks for the passphrase again before the biometric check',
      untrusted: true,
    },
    ...overrides,
  });

test('a Spec finding against an accepted ADR decision below blocking is rejected', () => {
  rejects(
    envelope({ findings: [adrSpecFinding()] }),
    /findings\.0\.severity: a Spec finding against an accepted ADR decision .* is blocking/,
  );
});

test('a Spec finding against an accepted ADR decision is accepted as blocking', () => {
  const report = normalizeReport(
    envelope({ findings: [adrSpecFinding({ severity: 'blocking' })] }),
  );
  assert.equal(report.findings[0].severity, 'blocking');
  assert.equal(report.verdict, 'request-changes');
});

test('the ADR floor applies to the Spec axis and to evidenced findings only', () => {
  // A Standards finding citing an ADR stays a judgement call.
  normalizeReport(
    envelope({
      findings: [
        cited({
          severity: 'should-fix',
          source:
            'docs/adr/0053-a-fan-out-over-a-domain-enum-is-pinned-at-its-call-site.md',
        }),
      ],
    }),
  );
  // A Spec finding whose source is not a repo ADR is unaffected.
  normalizeReport(
    envelope({ findings: [adrSpecFinding({ source: 'issue #912' })] }),
  );
});

// An executed Spec finding with no diff location cannot be blocking (below), so a
// floor on it would leave no severity the validator accepts, and one such finding
// would reject the whole report.
test('the ADR floor does not apply to a finding that cannot be blocking', () => {
  const executed = {
    kind: 'executed',
    command: 'git grep -n "requireFreshPassphrase" -- libs/mobile',
    exitCode: 1,
    outputExcerpt: '',
    cwd: '/repo',
  };
  const unanchored = adrSpecFinding({
    evidence: executed,
    location: undefined,
  });
  const report = normalizeReport(envelope({ findings: [unanchored] }));
  assert.equal(report.findings[0].severity, 'should-fix');
  rejects(
    envelope({ findings: [{ ...unanchored, severity: 'blocking' }] }),
    /blocking requires a diff location or a quoted spec line/,
  );
  // With a location it may block, so the floor holds again.
  rejects(
    envelope({
      findings: [
        adrSpecFinding({
          evidence: executed,
          location: { file: 'libs/mobile/a.ts', startLine: 1, headSha: HEAD },
        }),
      ],
    }),
    /a Spec finding against an accepted ADR decision .* is blocking/,
  );
});

test('blocking on inferred evidence is rejected', () => {
  rejects(
    envelope({ findings: [inferred({ severity: 'blocking' })] }),
    /findings\.0\.severity: blocking requires executed or cited evidence/,
  );
});

test('blocking without a location or a quoted spec line is rejected', () => {
  rejects(
    envelope({ findings: [cited({ location: undefined })] }),
    /findings\.0\.location: blocking requires a diff location or a quoted spec line/,
  );
});

test('a blocking spec omission may anchor to the quoted spec line alone', () => {
  const report = normalizeReport(
    envelope({
      findings: [
        {
          axis: 'spec',
          severity: 'blocking',
          summary: 'Acceptance criterion 3 is not implemented',
          ruleId: 'spec-requirement-missing',
          source: '#123',
          rule: 'AC3: export includes the Tasks blob',
          evidence: {
            kind: 'cited',
            sourceKind: 'spec',
            quote: 'AC3: the hardened export includes the Tasks blob',
            untrusted: true,
          },
        },
      ],
    }),
  );
  assert.equal(report.verdict, 'request-changes');
});

test('a quoted spec line must be marked untrusted', () => {
  rejects(
    envelope({
      findings: [
        cited({
          axis: 'spec',
          ruleId: 'spec-requirement-missing',
          evidence: {
            kind: 'cited',
            sourceKind: 'spec',
            quote: 'AC3',
            untrusted: false,
          },
        }),
      ],
    }),
    /findings\.0\.evidence\.untrusted: a quoted spec line/,
  );
});

test('a hand-written verdict or finding id is rejected', () => {
  rejects(envelope({ verdict: 'approve' }), /verdict/);
  rejects(
    envelope({ findings: [{ id: 'deadbeef0000', ...cited() }] }),
    /findings\.0: Unrecognized key: "id"/,
  );
});

test('wouldBlock is only allowed on should-fix', () => {
  rejects(
    envelope({ findings: [cited({ wouldBlock: true })] }),
    /findings\.0\.wouldBlock: wouldBlock is only meaningful on a should-fix finding/,
  );
  const ok = normalizeReport(
    envelope({ findings: [inferred({ wouldBlock: true })] }),
  );
  assert.equal(ok.findings[0].wouldBlock, true);
});

test('verdict is a pure function of severities', () => {
  assert.equal(computeVerdict([]), 'approve');
  assert.equal(computeVerdict([{ severity: 'nit' }]), 'approve');
  assert.equal(
    computeVerdict([{ severity: 'nit' }, { severity: 'should-fix' }]),
    'comment',
  );
  assert.equal(
    computeVerdict([{ severity: 'should-fix' }, { severity: 'blocking' }]),
    'request-changes',
  );
});

test('no spec drops the effective tier one level; interactive stays null', () => {
  const none: SpecSource = { kind: 'none', foundBy: 'none' };
  // auto with no spec → agent
  assert.equal(
    computeEffectiveTier({ tier: 'review:auto', spec: none }),
    'review:agent',
  );
  // agent with no spec → human
  assert.equal(
    computeEffectiveTier({ tier: 'review:agent', spec: none }),
    'review:human',
  );
  // human with no spec → human (can't go lower)
  assert.equal(
    computeEffectiveTier({ tier: 'review:human', spec: none }),
    'review:human',
  );
  // interactive (null) with no spec → null (unchanged)
  assert.equal(computeEffectiveTier({ tier: null, spec: none }), null);
  // present spec leaves tier untouched
  assert.equal(
    computeEffectiveTier({
      tier: 'review:auto',
      spec: { kind: 'path', ref: 'x', foundBy: 'argument' },
    }),
    'review:auto',
  );
  assert.equal(
    computeEffectiveTier({
      tier: 'review:agent',
      spec: { kind: 'issue', ref: '#123', foundBy: 'branch' },
    }),
    'review:agent',
  );
});

test('a spec of kind none cannot carry a ref', () => {
  rejects(
    envelope({ spec: { kind: 'none', ref: '#1', foundBy: 'branch' } }),
    /spec\.kind: a spec of kind none/,
  );
});

// A change that closes two issues answers to both (ADR 0125): the envelope
// names the further ones, and the report line says so.
test('a spec names the further issues the change closes, and the report shows them', () => {
  const report = normalizeReport(
    envelope({
      spec: { kind: 'issue', ref: '#123', foundBy: 'branch', also: ['#124'] },
    }),
  );
  assert.deepEqual(report.spec.also, ['#124']);
  assert.match(
    renderReport(report, null, { hunks: false }),
    /- spec: issue #123 \(found by branch\), also #124 \(closed by commits\)/,
  );
  assert.doesNotMatch(
    renderReport(normalizeReport(envelope()), null, { hunks: false }),
    /also/,
  );
});

test('further issues are issue references, once each, beside an issue spec only', () => {
  const spec = (over: Overrides) => ({
    kind: 'issue',
    ref: '#123',
    foundBy: 'branch',
    ...over,
  });
  rejects(envelope({ spec: spec({ also: [] }) }), /spec\.also/);
  rejects(envelope({ spec: spec({ also: ['124'] }) }), /spec\.also/);
  rejects(
    envelope({ spec: spec({ also: ['#123'] }) }),
    /spec\.also: also names each further issue once/,
  );
  rejects(
    envelope({ spec: spec({ also: ['#124', '#124'] }) }),
    /spec\.also: also names each further issue once/,
  );
  rejects(
    envelope({
      spec: { kind: 'path', ref: 'x', foundBy: 'argument', also: ['#124'] },
    }),
    /spec\.also: only an issue spec names further issues/,
  );
});

// The same rule applied twice in one file is two findings, and since issue #940
// each is minted from its own start line rather than numbered against the
// other — so fixing one no longer moves the survivor onto the vacated id.
test('two findings of one rule in one file get distinct ids, and neither depends on the other', () => {
  const at = (startLine: number, ruleId = 'standard-design-token-bypassed') =>
    cited({
      severity: 'should-fix',
      ruleId,
      location: { file: 'libs/a.ts', startLine, headSha: HEAD },
    });
  const ids = (findings: unknown[]) =>
    normalizeReport(envelope({ findings })).findings.map((f) => f.id);

  const [first, second] = ids([at(10), at(50)]);
  assert.notEqual(first, second);
  assert.equal(first, findingId(at(10)));
  assert.equal(second, findingId(at(50)));
  // Report order decides nothing.
  assert.deepEqual(ids([at(50), at(10)]), [second, first]);
  // The survivor of a fix keeps the id it had. Before issue #940 it was
  // renumbered onto the first one's id, which read as the first persisting.
  assert.deepEqual(ids([at(50)]), [second]);

  // Two findings minted from the very same tuple — one rule cited twice at
  // one line, or two unlocated findings of one kind — still need two ids.
  const [a, b] = ids([at(10), at(10)]);
  assert.equal(a, first);
  assert.notEqual(a, b);
  const unlocated = () => ({
    axis: 'spec',
    severity: 'should-fix',
    summary: 's',
    ruleId: 'spec-requirement-missing',
    source: '#123',
    rule: 'r',
    evidence: {
      kind: 'cited',
      sourceKind: 'spec',
      quote: 'q',
      untrusted: true,
    },
  });
  const [u1, u2] = ids([unlocated(), unlocated()]);
  assert.notEqual(u1, u2);

  // Two different rules in one file never were one identity (issue #724).
  const tokens = at(10, 'standard-design-token-bypassed');
  const secrets = at(10, 'standard-secret-committed');
  assert.notEqual(findingId(tokens), findingId(secrets));
});

test('a rule id outside the catalogue is rejected, and so is one off its axis', () => {
  rejects(
    envelope({ findings: [cited({ ruleId: 'standard-i-made-this-up' })] }),
    /findings\.0\.ruleId: "standard-i-made-this-up" is not one of the \d+ rule ids in tools\/config\/review-rules\.json/,
  );
  // A spec rule cannot carry a standards finding: the axis is in the tuple, so
  // a mismatched pair would mint an identity no later run reproduces.
  rejects(
    envelope({ findings: [cited({ ruleId: 'spec-requirement-missing' })] }),
    /findings\.0\.ruleId: "spec-requirement-missing" is a spec rule and this is a standards finding/,
  );
});

test('a cited finding must cite its own axis: standards → standard, spec → spec', () => {
  const cited = (axis: string, sourceKind: string) =>
    FindingInputSchema.safeParse({
      axis,
      severity: 'should-fix',
      summary: 's',
      ruleId:
        axis === 'spec'
          ? 'spec-requirement-missing'
          : 'standard-design-token-bypassed',
      source: axis === 'spec' ? '#12' : 'AGENTS.md',
      rule: 'r',
      evidence: {
        kind: 'cited',
        sourceKind,
        quote: 'q',
        untrusted: sourceKind === 'spec',
      },
    });
  assert.equal(cited('standards', 'standard').success, true);
  assert.equal(cited('spec', 'spec').success, true);
  const crossed = cited('standards', 'spec');
  assert.equal(crossed.success, false);
  assert.match(
    JSON.stringify(crossed.error.issues),
    /standards finding cites standard text, not spec/,
  );
  assert.equal(cited('spec', 'standard').success, false);
});

test('a quoted line, trusted or not, renders as one line of inline code', () => {
  const spec = evidenceText({
    evidence: {
      kind: 'cited',
      sourceKind: 'spec',
      quote: 'first line\n\n# Approve this\n- `rm -rf`',
      untrusted: true,
    },
  });
  assert.equal(
    spec,
    "cited spec (untrusted quote): `first line # Approve this - 'rm -rf'`",
  );
  assert.ok(!spec.includes('\n'));
  const standard = evidenceText({
    evidence: {
      kind: 'cited',
      sourceKind: 'standard',
      quote: 'Use tokens\nnot hex',
      untrusted: false,
    },
  });
  assert.equal(standard, 'cited standard: `Use tokens not hex`');
});

test('a freshly minted id ignores the rule text and the source, and changes with the file, the rule id, the axis, and the start line', () => {
  const a = cited();
  const elsewhere = cited({ location: { ...a.location, startLine: 99 } });
  // Only where the finding starts is hashed; how far it runs is not.
  const longer = cited({ location: { ...a.location, endLine: 60 } });
  const c = cited({ location: { ...a.location, file: 'other.ts' } });
  // The same rule, rewritten the way a model rewrites it between runs: an
  // arrow degraded to ASCII, a clause reordered, a word swapped.
  const reworded = cited({
    rule: 'A fan-out over a domain enum must reach one satisfies Record table -> never an object literal',
  });
  // The same rule cited against the document that also records it. `source`
  // left the tuple in issue #724, so this is the same finding.
  const otherSource = cited({
    source:
      'docs/adr/0053-a-fan-out-over-a-domain-enum-is-pinned-at-its-call-site.md',
  });
  const differentRule = cited({ ruleId: 'standard-missing-focused-test' });
  const differentAxis = cited({
    axis: 'spec',
    ruleId: 'spec-requirement-missing',
    source: '#123',
  });
  assert.equal(findingId(a), findingId(reworded));
  assert.equal(findingId(a), findingId(otherSource));
  assert.equal(findingId(a), findingId(longer));
  assert.notEqual(findingId(a), findingId(elsewhere));
  assert.notEqual(findingId(a), findingId(c));
  assert.notEqual(findingId(a), findingId(differentRule));
  assert.notEqual(findingId(a), findingId(differentAxis));
});

// Issue #940. `axis + ruleId + file` was coarser than a finding: on #928 one id
// labelled a curly-apostrophe gap on one push and an unrelated idiom on the
// next, both `standard-missing-focused-test` in one file. The measurement read
// that as a finding nobody acted on, and a `Review-ack` written for the first
// covered the second. A finding now keeps an earlier id only when the previous
// report held one of the same axis, rule, and file whose lines overlap its own.
const sameRuleSameFile = (
  startLine: number,
  endLine?: number,
  overrides: Overrides = {},
) =>
  cited({
    severity: 'should-fix',
    ruleId: 'standard-missing-focused-test',
    source: 'AGENTS.md',
    location: {
      file: 'tools/scripts/review/escaped-defects.ts',
      startLine,
      ...(endLine ? { endLine } : {}),
      headSha: HEAD,
    },
    ...overrides,
  });
const NEXT_HEAD = '9999999999999999999999999999999999999999';
const runOf = (
  findings: unknown[],
  previous: unknown = null,
  head: string = HEAD,
) => normalizeReport(envelope({ head, findings }), { previous });

test('a different defect under the same rule in the same file is a new finding, not the old one persisting', () => {
  const first = runOf([
    sameRuleSameFile(188, 193, { summary: 'curly apostrophe is not negation' }),
  ]);
  const second = runOf(
    [sameRuleSameFile(240, 246, { summary: 'the no-doubt idiom is negation' })],
    first,
    NEXT_HEAD,
  );
  assert.notEqual(second.findings[0].id, first.findings[0].id);
  const md = renderReport(second, first, { hunks: false });
  assert.match(md, /- new: 1 /);
  assert.match(md, /- persisting: 0\n/);
  assert.match(md, /- resolved: 1 /);
});

test('the same defect anchored a few lines away keeps its id across runs', () => {
  // The reviewer does not anchor one defect at one line: across the 2026-10-05
  // window it moved the start line of a genuinely persisting finding in 8 of
  // 19 located cases. Hashing the line would have read each as fixed.
  const first = runOf([sameRuleSameFile(34, 44)]);
  const second = runOf(
    [sameRuleSameFile(42, 44, { summary: 'reworded', rule: 'reworded too' })],
    first,
    NEXT_HEAD,
  );
  assert.equal(second.findings[0].id, first.findings[0].id);
  // The id is the first run's, not one this run could have minted alone.
  assert.notEqual(second.findings[0].id, findingId(second.findings[0]));
  const md = renderReport(second, first, { hunks: false });
  assert.match(md, /- persisting: 1 /);
  // And it keeps holding: the third run inherits from the second.
  const third = runOf([sameRuleSameFile(44)], second, HEAD);
  assert.equal(third.findings[0].id, first.findings[0].id);
});

test('fixing one of two same-rule findings in a file leaves the survivor its own id', () => {
  const first = runOf([sameRuleSameFile(10, 14), sameRuleSameFile(50, 58)]);
  const [fixed, survivor] = first.findings.map((f) => f.id);
  const second = runOf([sameRuleSameFile(52, 58)], first, NEXT_HEAD);
  assert.deepEqual(
    second.findings.map((f) => f.id),
    [survivor],
  );
  assert.notEqual(survivor, fixed);
});

test('an earlier id is carried by at most one finding, and the closest claim wins', () => {
  const first = runOf([sameRuleSameFile(20, 40)]);
  const earlier = first.findings[0].id;
  // Both overlap the earlier range; the one sharing more of it inherits.
  const second = runOf(
    [sameRuleSameFile(38, 60), sameRuleSameFile(22, 39)],
    first,
    NEXT_HEAD,
  );
  const [loose, close] = second.findings.map((f) => f.id);
  assert.equal(close, earlier);
  assert.notEqual(loose, earlier);
  assert.equal(loose, findingId(second.findings[0]));
});

test('an id is never carried across a file or a rule', () => {
  const first = runOf([sameRuleSameFile(10, 20)]);
  const earlier = first.findings[0].id;
  const idAfter = (finding: unknown) =>
    runOf([finding], first, NEXT_HEAD).findings[0].id;
  assert.notEqual(
    idAfter(
      sameRuleSameFile(10, 20, {
        location: {
          file: 'other.mjs',
          startLine: 10,
          endLine: 20,
          headSha: HEAD,
        },
      }),
    ),
    earlier,
  );
  assert.notEqual(
    idAfter(sameRuleSameFile(10, 20, { ruleId: 'standard-doc-claim-drifted' })),
    earlier,
  );
  assert.equal(idAfter(sameRuleSameFile(10, 20)), earlier);
});

test('a finding minted beside a carried id never shares it', () => {
  // The first finding was minted at line 10 and has since drifted down the
  // file under its inherited id. A new finding at line 10 would mint the
  // same hash; it must not end up with the id the older one still carries.
  const first = runOf([sameRuleSameFile(10, 30)]);
  const second = runOf([sameRuleSameFile(28, 40)], first, NEXT_HEAD);
  const third = runOf(
    [sameRuleSameFile(10, 12), sameRuleSameFile(35, 40)],
    second,
    HEAD,
  );
  const [fresh, carried] = third.findings.map((f) => f.id);
  assert.equal(carried, first.findings[0].id);
  assert.notEqual(fresh, carried);
  // Nor the id of one that has just gone: the drifted finding is fixed and a
  // new one appears at line 10. Minting the old id again would read as the
  // old finding persisting.
  const fourth = runOf([sameRuleSameFile(10, 12)], second, HEAD);
  assert.notEqual(fourth.findings[0].id, first.findings[0].id);
});

test('a previous report that repeats an id, or carries no findings array, lends each id at most once', () => {
  const first = runOf([sameRuleSameFile(10, 14), sameRuleSameFile(50, 58)]);
  const repeated = {
    ...first,
    findings: first.findings.map((f) => ({ ...f, id: first.findings[0].id })),
  };
  const ids = runOf(
    [sameRuleSameFile(10, 14), sameRuleSameFile(50, 58)],
    repeated,
    NEXT_HEAD,
  ).findings.map((f) => f.id);
  assert.equal(new Set(ids).size, 2);
  const broken = { ...first, findings: 'not an array' };
  assert.equal(
    runOf([sameRuleSameFile(10, 14)], broken, NEXT_HEAD).findings.length,
    1,
  );
});

test('unlocated findings have no lines to compare, so they carry by axis and rule alone', () => {
  // The residue issue #940 leaves: with no location there is nothing to tell
  // two unlocated findings of one kind apart, so the earlier id is inherited
  // in report order, as it was before.
  const unlocated = (summary: string) => ({
    axis: 'spec',
    severity: 'should-fix',
    summary,
    ruleId: 'spec-requirement-missing',
    source: '#123',
    rule: 'r',
    evidence: {
      kind: 'cited',
      sourceKind: 'spec',
      quote: 'q',
      untrusted: true,
    },
  });
  const first = runOf([unlocated('one')]);
  const second = runOf([unlocated('another')], first, NEXT_HEAD);
  assert.equal(second.findings[0].id, first.findings[0].id);
  // A located finding never inherits from an unlocated one.
  const located = runOf(
    [
      {
        ...unlocated('now located'),
        location: { file: 'a.ts', startLine: 1, headSha: HEAD },
      },
    ],
    first,
    NEXT_HEAD,
  );
  assert.notEqual(located.findings[0].id, first.findings[0].id);
});

test('a previous report of another schema version lends no ids', () => {
  const first = runOf([sameRuleSameFile(34, 44)]);
  const older = {
    ...first,
    schemaVersion: REPORT_SCHEMA_VERSION - 1,
    findings: first.findings.map((f) => ({ ...f, id: 'aaaaaaaaaaaa' })),
  };
  const second = runOf([sameRuleSameFile(34, 44)], older, NEXT_HEAD);
  assert.equal(second.findings[0].id, findingId(second.findings[0]));
});

// The decisive test for issue #718. Before the tuple dropped `rule`, the
// published record showed a persisting count of zero in 38 of 38 consecutive
// reports: every re-run reworded the rule text and so minted a fresh id, which
// announced live findings as resolved and closed their threads.
test('rewording the rule keeps the identity, so the finding persists across two runs', () => {
  const defect = (rule: string) =>
    cited({
      summary: 'reconcile() drops a blob type the server does not hold',
      rule,
    });
  const first = normalizeReport(
    envelope({
      findings: [
        defect(
          'A fan-out over a domain enum reaches the Pinned Table → never an object literal',
        ),
      ],
    }),
  );
  const second = normalizeReport(
    envelope({
      head: '9999999999999999999999999999999999999999',
      findings: [
        defect(
          'Fan-out over a domain enum must reach one satisfies Record table -> not an object literal',
        ),
      ],
    }),
  );
  assert.equal(second.findings[0].id, first.findings[0].id);
  const md = renderReport(second, first, { hunks: false });
  assert.match(md, /- new: 0\n/);
  assert.match(md, /- persisting: 1 \(`[0-9a-f]{12}`\)/);
  assert.match(md, /- resolved: 0\n/);
});

test('a previous report from another schema version is reported as not comparable', () => {
  const current = normalizeReport(envelope({ findings: [cited()] }));
  const older = { ...current, schemaVersion: REPORT_SCHEMA_VERSION - 1 };
  const md = renderReport(current, older, { hunks: false });
  assert.match(
    md,
    new RegExp(
      `No comparable previous run: the stored report is report schema \`${REPORT_SCHEMA_VERSION - 1}\`, this run is \`${REPORT_SCHEMA_VERSION}\``,
    ),
  );
  // No mass auto-resolve, and no strip at all: nothing is new, persisting, or
  // resolved against a report whose ids this run could never mint.
  assert.ok(!/- (new|persisting|resolved): /.test(md));
  // An artifact so old it has no version at all is named, not guessed at.
  assert.match(
    renderReport(current, { findings: [] }, { hunks: false }),
    /report schema `unknown`/,
  );
});

test('the renderer keeps the axes apart, folds nits, and diffs by id', () => {
  const current = normalizeReport(
    envelope({
      findings: [
        inferred({
          severity: 'nit',
          summary: 'Rename x',
          ruleId: 'smell-mysterious-name',
          rule: 'Mysterious Name',
          // Its own file, so it is a separate identity from the previous
          // run's unlocated smell-baseline finding rather than a collision.
          location: {
            file: 'libs/web-vault/src/digest.ts',
            startLine: 7,
            headSha: HEAD,
          },
        }),
        cited(),
        {
          axis: 'spec',
          severity: 'should-fix',
          summary: 'Scope creep: adds a toggle nobody asked for',
          ruleId: 'spec-behaviour-not-asked-for',
          source: '#123',
          rule: 'PRD scope',
          evidence: {
            kind: 'inferred',
            reasoning: 'not in the acceptance criteria',
          },
        },
      ],
    }),
  );
  const previous = normalizeReport(
    envelope({
      head: '9999999999999999999999999999999999999999',
      findings: [cited(), inferred()],
    }),
  );
  const md = renderReport(current, previous, { hunks: false });
  assert.match(md, /^# Code review — Request changes/);
  assert.ok(md.indexOf('## Standards') < md.indexOf('## Spec'));
  assert.match(md, /<summary>1 nit<\/summary>/);
  // The rendered rule line carries the bounded id alongside the display text
  // and the source, so a human reading the report can see which catalogue
  // entry was chosen — the field the identity hashes (issue #724).
  assert.match(
    md,
    /- rule: `standard-enum-fanout-not-pinned` — Code fanning out over a domain enum reaches one satisfies Record table \(source: `AGENTS\.md`\)/,
  );
  assert.match(md, /- new: 2/);
  assert.match(md, /- persisting: 1/);
  assert.match(md, /- resolved: 1/);
  assert.match(
    md,
    /Standards: 2 finding\(s\), worst blocking · Spec: 1 finding\(s\), worst should-fix/,
  );
  const standards = md.slice(md.indexOf('## Standards'), md.indexOf('## Spec'));
  assert.ok(standards.indexOf('**blocking**') < standards.indexOf('<details>'));
});

test('a smell-baseline finding cannot block even with cited evidence', () => {
  // The catalogue's cap: every `smell-*` rule declares maxSeverity, so the
  // twelve smells are twelve capped identities rather than one opaque source.
  rejects(
    envelope({
      findings: [
        cited({
          ruleId: 'smell-feature-envy',
          source: 'smell-baseline',
          rule: 'Feature Envy',
        }),
      ],
    }),
    /findings\.0\.severity: a Feature Envy finding is a judgement call and caps at should-fix/,
  );
  // And the source's cap, which still stands on its own: a finding the
  // reviewer marked smell-baseline under some other rule id is the same
  // judgement call and must not slip between the two checks.
  rejects(
    envelope({ findings: [cited({ source: 'smell-baseline' })] }),
    /findings\.0\.severity: a smell-baseline finding is always a judgement call/,
  );
});

test('a fingerprint or secret finding cannot be reported below should-fix', () => {
  // The catalogue's floor, the mirror of its cap (ADR 0131 item 2). The
  // seeded run of issue #1140 reported a hostname reaching a public log as a
  // nit; the floor rejects that report rather than raising its severity.
  const fingerprint = {
    ruleId: 'standard-operator-fingerprint-in-source',
    source: 'docs/adr/0086-a-public-tree-hides-an-operator-not-a-product.md',
    rule: 'Logs must not dump environment or connection strings',
  };
  rejects(
    envelope({ findings: [cited({ ...fingerprint, severity: 'nit' })] }),
    /findings\.0\.severity: an? .*Operator Fingerprint.* finding is never below should-fix/,
  );
  rejects(
    envelope({
      findings: [
        cited({
          ruleId: 'standard-secret-committed',
          source: 'AGENTS.md',
          rule: 'Do not commit secrets or production credentials',
          severity: 'nit',
        }),
      ],
    }),
    /findings\.0\.severity: .*secret.* finding is never below should-fix/,
  );
  // At the floor and above it, the finding stands.
  for (const severity of ['should-fix', 'blocking']) {
    assert.doesNotThrow(() =>
      normalizeReport(
        envelope({ findings: [cited({ ...fingerprint, severity })] }),
      ),
    );
  }
});

test('the renderer refuses a raw report that skipped the validator', () => {
  assert.throws(
    () => renderReport(envelope({ findings: [cited()] })),
    /verdict|effectiveTier/,
  );
});

test('cost is optional and rendered when present', () => {
  const report = normalizeReport(
    envelope({ cost: { inputTokens: 1200, outputTokens: 300 } }),
  );
  assert.match(
    renderReport(report, null, { hunks: false }),
    /1\.2k in \/ 300 out tokens/,
  );
});
