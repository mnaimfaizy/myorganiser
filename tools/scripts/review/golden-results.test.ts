import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  GENERATED_END,
  GENERATED_START,
  GoldenResultError,
  OUTCOMES,
  VOID_REASONS,
  runFactFields,
  appendResultLine,
  buildResultRecord,
  formatResultLine,
  groupRuns,
  parseResultsFile,
  renderRunsTable,
  seededCaseIds,
  summarizeRun,
} from './golden-results.ts';

const CAUGHT = {
  date: '2026-09-30',
  runId: '111',
  commit: 'a'.repeat(40),
  caseId: 'export-envelope-drops-tasks',
  outcome: 'caught',
  recall: 1,
  model: 'claude-sonnet-5',
};

const VOID = {
  date: '2026-09-30',
  runId: '111',
  commit: 'a'.repeat(40),
  caseId: 'release-bump-leaves-generated-client-stale',
  outcome: 'void',
  voidReason: 'rate-limit',
  model: 'claude-sonnet-5',
};

test('buildResultRecord accepts a caught record with fixed key order', () => {
  const record = buildResultRecord(CAUGHT);
  assert.deepEqual(Object.keys(record), [
    'date',
    'run_id',
    'commit',
    'case',
    'outcome',
    'void_reason',
    'recall',
    'total_cost_usd',
    'turns',
    'model',
    'cli_version',
    'index_opened',
    'dispatch_on_template',
    'shape_readable',
  ]);
  assert.equal(record.case, 'export-envelope-drops-tasks');
  assert.equal(record.void_reason, null);
  assert.equal(record.recall, 1);
});

test('buildResultRecord accepts a void record with no recall', () => {
  const record = buildResultRecord(VOID);
  assert.equal(record.outcome, 'void');
  assert.equal(record.void_reason, 'rate-limit');
  assert.equal(record.recall, null);
});

test('buildResultRecord rejects a bad date', () => {
  assert.throws(
    () => buildResultRecord({ ...CAUGHT, date: '09/30/2026' }),
    GoldenResultError,
  );
});

test('buildResultRecord rejects an outcome outside the vocabulary', () => {
  assert.throws(
    () => buildResultRecord({ ...CAUGHT, outcome: 'flaky' }),
    /outcome must be one of/,
  );
});

test('buildResultRecord rejects a void record with no void_reason', () => {
  assert.throws(
    () => buildResultRecord({ ...VOID, voidReason: null }),
    /void_reason must be one of/,
  );
});

test('buildResultRecord rejects a void record outside the reason vocabulary', () => {
  assert.throws(
    () => buildResultRecord({ ...VOID, voidReason: 'gremlins' }),
    /void_reason must be one of/,
  );
});

// This is the acceptance criterion ADR 0101 exists for: a void must never be
// scorable, or it can be read back as a miss or a catch.
test('buildResultRecord rejects a void record carrying a recall', () => {
  assert.throws(
    () => buildResultRecord({ ...VOID, recall: 0 }),
    /carries no recall/,
  );
});

test('buildResultRecord rejects a caught/missed record with a void_reason', () => {
  assert.throws(
    () => buildResultRecord({ ...CAUGHT, voidReason: 'rate-limit' }),
    /carries no void_reason/,
  );
});

test('buildResultRecord rejects a non-void record with no recall', () => {
  assert.throws(
    () => buildResultRecord({ ...CAUGHT, recall: null }),
    /recall must be a number between 0 and 1/,
  );
});

test('buildResultRecord rejects a recall outside 0..1', () => {
  assert.throws(
    () => buildResultRecord({ ...CAUGHT, recall: 1.5 }),
    GoldenResultError,
  );
  assert.throws(
    () => buildResultRecord({ ...CAUGHT, recall: -0.1 }),
    GoldenResultError,
  );
});

test('buildResultRecord rejects a negative total_cost_usd or turns', () => {
  assert.throws(
    () => buildResultRecord({ ...CAUGHT, totalCostUsd: -1 }),
    /total_cost_usd/,
  );
  assert.throws(() => buildResultRecord({ ...CAUGHT, turns: -1 }), /turns/);
});

test('buildResultRecord requires run_id, commit, case, and model', () => {
  for (const field of ['runId', 'commit', 'caseId', 'model']) {
    assert.throws(
      () => buildResultRecord({ ...CAUGHT, [field]: '' }),
      GoldenResultError,
      field,
    );
  }
});

test('OUTCOMES and VOID_REASONS are the documented vocabularies', () => {
  assert.deepEqual(OUTCOMES, [
    'caught',
    'missed',
    'clean-pass',
    'clean-fail',
    'void',
  ]);
  assert.deepEqual(VOID_REASONS, [
    'rate-limit',
    'turn-ceiling',
    'prevented',
    'answer-sheet-check-failed',
    'brief-not-read',
    'finding-not-returned',
    'evidence-not-executed',
    'unknown',
  ]);
});

// ---------------------------------------------------------------------------
// Clean-diff cases (issue #933): scored clean-pass or clean-fail, never with
// a recall — the same distinction golden.ts's scoreCase draws, preserved
// here so the result record cannot fold a clean case back into a recall
// number on the way to disk.

const CLEAN_PASS = {
  date: '2026-09-30',
  runId: '111',
  commit: 'a'.repeat(40),
  caseId: 'npm-advisory-rekey-lands-clean',
  outcome: 'clean-pass',
  model: 'claude-sonnet-5',
};

test('buildResultRecord accepts a clean-pass record with no recall', () => {
  const record = buildResultRecord(CLEAN_PASS);
  assert.equal(record.outcome, 'clean-pass');
  assert.equal(record.recall, null);
  assert.equal(record.void_reason, null);
});

test('buildResultRecord accepts a clean-fail record with no recall', () => {
  const record = buildResultRecord({ ...CLEAN_PASS, outcome: 'clean-fail' });
  assert.equal(record.outcome, 'clean-fail');
  assert.equal(record.recall, null);
});

test('buildResultRecord rejects a clean-pass or clean-fail record carrying a recall', () => {
  assert.throws(
    () => buildResultRecord({ ...CLEAN_PASS, recall: 1 }),
    /carries no recall/,
  );
  assert.throws(
    () =>
      buildResultRecord({ ...CLEAN_PASS, outcome: 'clean-fail', recall: 0 }),
    /carries no recall/,
  );
});

test('buildResultRecord rejects a clean-pass or clean-fail record carrying a void_reason', () => {
  assert.throws(
    () => buildResultRecord({ ...CLEAN_PASS, voidReason: 'rate-limit' }),
    /carries no void_reason/,
  );
});

test('summarizeRun counts clean-pass alongside caught and clean-fail alongside missed', () => {
  const group = groupRuns([
    buildResultRecord(CAUGHT),
    buildResultRecord(CLEAN_PASS),
    buildResultRecord({
      ...CLEAN_PASS,
      caseId: 'x',
      outcome: 'clean-fail',
    }),
    buildResultRecord(VOID),
  ])[0];
  const s = summarizeRun(group);
  assert.equal(s.caught, 2);
  assert.equal(s.missed, 1);
  assert.equal(s.voided, 1);
  assert.equal(s.scorable, 3);
  assert.equal(s.total, 4);
  assert.equal(s.result, '2 of 3 scorable, 1 void');
});

test('formatResultLine round-trips through parseResultsFile', () => {
  const record = buildResultRecord(CAUGHT);
  const line = formatResultLine(record);
  assert.doesNotThrow(() => JSON.parse(line));
  const [parsed] = parseResultsFile(`${line}\n`);
  assert.deepEqual(parsed, record);
});

test('parseResultsFile skips blank lines and reads several records', () => {
  const text = `${formatResultLine(buildResultRecord(CAUGHT))}\n\n${formatResultLine(buildResultRecord(VOID))}\n`;
  const records = parseResultsFile(text);
  assert.equal(records.length, 2);
  assert.equal(records[0].outcome, 'caught');
  assert.equal(records[1].outcome, 'void');
});

test('parseResultsFile reports the offending line on malformed JSON', () => {
  const text = `${formatResultLine(buildResultRecord(CAUGHT))}\nnot json\n`;
  assert.throws(() => parseResultsFile(text), /line 2: not valid JSON/);
});

test('parseResultsFile reports the offending line on a schema violation', () => {
  const bad = JSON.stringify({
    ...buildResultRecord(CAUGHT),
    outcome: 'flaky',
  });
  assert.throws(
    () => parseResultsFile(`${bad}\n`),
    /line 1: outcome must be one of/,
  );
});

test('parseResultsFile treats an empty file as zero records', () => {
  assert.deepEqual(parseResultsFile(''), []);
});

test('appendResultLine creates the directory and appends valid lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'golden-results-'));
  const path = join(dir, 'nested', 'results.jsonl');
  appendResultLine(path, CAUGHT);
  appendResultLine(path, VOID);
  const records = parseResultsFile(readFileSync(path, 'utf8'));
  assert.equal(records.length, 2);
  assert.equal(records[0].case, 'export-envelope-drops-tasks');
  assert.equal(records[1].outcome, 'void');
});

test('appendResultLine refuses an invalid record and writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'golden-results-'));
  const path = join(dir, 'results.jsonl');
  assert.throws(() => appendResultLine(path, { ...CAUGHT, outcome: 'flaky' }));
});

test('groupRuns groups by run_id in first-seen order', () => {
  const a = buildResultRecord(CAUGHT);
  const b = buildResultRecord({ ...VOID, runId: '111' });
  const c = buildResultRecord({
    ...CAUGHT,
    runId: '222',
    date: '2026-10-01',
    caseId: 'mail-test-setup-assigns-undefined-to-env',
  });
  const groups = groupRuns([a, b, c]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].runId, '111');
  assert.equal(groups[0].records.length, 2);
  assert.equal(groups[1].runId, '222');
  assert.equal(groups[1].records.length, 1);
});

test('groupRuns rejects a run whose records disagree on date, model, or commit', () => {
  const a = buildResultRecord(CAUGHT);
  const b = buildResultRecord({ ...CAUGHT, date: '2026-10-01' });
  assert.throws(() => groupRuns([a, b]), /different date values/);

  const c = buildResultRecord({ ...CAUGHT, model: 'claude-opus-5-5' });
  assert.throws(() => groupRuns([a, c]), /different model values/);
});

test('summarizeRun counts caught, missed, and void separately, never mixed', () => {
  const group = groupRuns([
    buildResultRecord(CAUGHT),
    buildResultRecord({ ...CAUGHT, caseId: 'x', outcome: 'missed', recall: 0 }),
    buildResultRecord(VOID),
  ])[0];
  const s = summarizeRun(group);
  assert.equal(s.caught, 1);
  assert.equal(s.missed, 1);
  assert.equal(s.voided, 1);
  assert.equal(s.scorable, 2);
  assert.equal(s.total, 3);
  assert.equal(s.result, '1 of 2 scorable, 1 void');
});

test('summarizeRun omits the void clause when nothing voided', () => {
  const group = groupRuns([buildResultRecord(CAUGHT)])[0];
  assert.equal(summarizeRun(group).result, '1 of 1');
});

test('renderRunsTable renders a placeholder for an empty record', () => {
  assert.equal(renderRunsTable([]), '_No recorded runs yet._');
});

test('renderRunsTable renders one row per run, and a void never counts as caught or missed', () => {
  const records = [buildResultRecord(CAUGHT), buildResultRecord(VOID)];
  const table = renderRunsTable(records);
  assert.match(
    table,
    /\| Date \| Run ID \| Model \| Cases \| Result \| Commit \|/,
  );
  assert.match(
    table,
    /\| 2026-09-30 \| `111` \| `claude-sonnet-5` \| 2 \| 1 of 1 scorable, 1 void \| `aaaaaaa` \|/,
  );
});

test('GENERATED markers are the ones the checker and the ledger share', () => {
  assert.equal(GENERATED_START, '<!-- GENERATED:golden-runs:START -->');
  assert.equal(GENERATED_END, '<!-- GENERATED:golden-runs:END -->');
});

// --- run facts on a result line (ADR 0123 item 7) ----------------------------

test('a review that did not run as built is a void under its own reason', () => {
  for (const voidReason of [
    'brief-not-read',
    'finding-not-returned',
    'evidence-not-executed',
  ]) {
    const record = buildResultRecord({ ...VOID, voidReason });
    assert.equal(record.outcome, 'void');
    assert.equal(record.void_reason, voidReason);
    assert.equal(record.recall, null);
  }
});

test('a result line carries the CLI version and the three tightening facts', () => {
  const record = buildResultRecord({
    ...CAUGHT,
    cliVersion: '2.1.293',
    indexOpened: false,
    dispatchOnTemplate: true,
    shapeReadable: true,
  });
  assert.equal(record.cli_version, '2.1.293');
  assert.equal(record.index_opened, false);
  assert.equal(record.dispatch_on_template, true);
  assert.equal(record.shape_readable, true);
  const [parsed] = parseResultsFile(formatResultLine(record));
  assert.deepEqual(parsed, record);
  assert.throws(
    () => buildResultRecord({ ...CAUGHT, indexOpened: 'no' }),
    /index_opened must be true, false, or null/,
  );
  assert.throws(
    () => buildResultRecord({ ...CAUGHT, cliVersion: '' }),
    /cli_version/,
  );
});

test('a line written before the run facts were recorded reads them as not known', () => {
  const {
    cli_version,
    index_opened,
    dispatch_on_template,
    shape_readable,
    ...old
  } = buildResultRecord(CAUGHT);
  const [parsed] = parseResultsFile(JSON.stringify(old));
  assert.equal(parsed.cli_version, null);
  assert.equal(parsed.index_opened, null);
  assert.equal(parsed.dispatch_on_template, null);
  assert.equal(parsed.shape_readable, null);
  assert.deepEqual(
    [cli_version, index_opened, dispatch_on_template, shape_readable],
    [null, null, null, null],
  );
});

const axisFacts = (overrides = {}) => ({
  dispatched: true,
  briefRead: true,
  onTemplate: true,
  toolCalls: 3,
  ...overrides,
});

const normalizedWith = (runFacts) => ({
  runFactsFrom: 'transcript',
  runFacts: {
    shape: 'readable',
    shapeReason: null,
    cliVersion: '2.1.293',
    dispatches: 2,
    axes: { standards: axisFacts(), spec: axisFacts() },
    indexOpened: true,
    repliesParsed: true,
    unattributedDispatches: 0,
    ...runFacts,
  },
});

test('the run facts of a line are read from the normalized report', () => {
  assert.deepEqual(runFactFields(normalizedWith({})), {
    cliVersion: '2.1.293',
    indexOpened: true,
    dispatchOnTemplate: true,
    shapeReadable: true,
  });
  const thin = runFactFields(
    normalizedWith({
      indexOpened: false,
      axes: {
        standards: axisFacts({ onTemplate: false }),
        spec: axisFacts({ dispatched: false, onTemplate: null }),
      },
      repliesParsed: false,
    }),
  );
  assert.equal(thin.indexOpened, false);
  assert.equal(thin.dispatchOnTemplate, false);
  assert.equal(thin.shapeReadable, false);
  // A dispatch that is neither axis's is off the template by itself.
  assert.equal(
    runFactFields(normalizedWith({ unattributedDispatches: 1 }))
      .dispatchOnTemplate,
    false,
  );
});

test('cannot tell is recorded as null, never as false', () => {
  const unknown = runFactFields(
    normalizedWith({
      shape: 'unknown',
      shapeReason: 'no result event',
      dispatches: null,
      axes: null,
      indexOpened: null,
      repliesParsed: null,
      unattributedDispatches: null,
    }),
  );
  assert.deepEqual(unknown, {
    cliVersion: '2.1.293',
    indexOpened: null,
    dispatchOnTemplate: null,
    shapeReadable: false,
  });
  // No validated report, or one whose facts are the reviewer's own.
  for (const report of [null, { runFactsFrom: 'reviewer', runFacts: null }])
    assert.deepEqual(runFactFields(report), {
      cliVersion: null,
      indexOpened: null,
      dispatchOnTemplate: null,
      shapeReadable: null,
    });
});

// ADR 0130 item 4: a Seeded Case shows the reviewer can catch a defect shape,
// an attributed one that it would have caught a defect that shipped. The run
// tally never pools the two.

test('a run with seeded cases tallies them apart from attributed ones', () => {
  const seeded = new Set(['seeded-swap', 'seeded-host']);
  const group = groupRuns([
    buildResultRecord(CAUGHT),
    buildResultRecord({
      ...CAUGHT,
      caseId: 'attributed-miss',
      outcome: 'missed',
      recall: 0,
    }),
    buildResultRecord({ ...CAUGHT, caseId: 'seeded-swap' }),
    buildResultRecord({
      ...CAUGHT,
      caseId: 'seeded-host',
      outcome: 'missed',
      recall: 0,
    }),
    buildResultRecord({ ...VOID, caseId: 'seeded-host' }),
  ])[0];
  assert.equal(
    summarizeRun(group, { seeded }).result,
    'attributed 1 of 2 · seeded 1 of 2 scorable, 1 void',
  );
  // A run with no seeded case reads exactly as it always has, so the ledger's
  // existing rows do not move.
  const plain = groupRuns([buildResultRecord(CAUGHT)])[0];
  assert.equal(summarizeRun(plain, { seeded }).result, '1 of 1');
  assert.match(
    renderRunsTable(group.records, { seeded }),
    /\| 5 \| attributed 1 of 2 · seeded 1 of 2 scorable, 1 void \|/,
  );
});

test('seededCaseIds reads the seeded cases from a raw golden set', () => {
  assert.deepEqual(
    seededCaseIds({
      cases: [
        { id: 'a', origin: 'attributed' },
        { id: 'b', origin: 'seeded' },
      ],
    }),
    new Set(['b']),
  );
});
