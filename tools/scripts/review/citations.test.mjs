// Covers the half of the answer sheet that run 45 showed was missing: a
// quotation compared to the tree it claims to come from
// (docs/research/2026-09-10-the-answer-sheet-is-inert.md, ADR 0078).
//
// Two layers, on purpose. The unit tests below run against an in-memory tree,
// because a comparison is the thing being tested and git is not. The replay at
// the bottom runs the real checker over the two answer sheets that brief
// recorded, against the real commits the golden set already pins — which is the
// only way to show that the check reports what those two runs did, rather than
// what a fixture was built to say.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  ObligationError,
  assertObligationCatalogue,
  checkAnswers,
  normalizeCitedFields,
  obligationRuleId,
  verifyCitation,
} from './obligations.mjs';

const CHECKER = 'tools/scripts/check-review-obligation-answers.ts';
const FIXTURES = join('tools', 'scripts', 'review', 'fixtures', '2026-09-10');

const obligation = (over = {}) => ({
  id: 'an-obligation',
  title: 'An obligation',
  question: 'Answer this.',
  answerFields: ['a', 'b'],
  citedFields: ['a'],
  defect: 'a is false',
  trigger: { paths: ['libs/**'] },
  seededFrom: '#1',
  goldenCase: 'a-case',
  ...over,
});

const catalogue = (obligations = [obligation()]) => ({
  schemaVersion: 1,
  obligations,
});

// One file, three lines. Enough to be quoted rightly, quoted wrongly, and
// quoted past the end.
const SOURCE = {
  'libs/a.ts': ['const x = 1;', '  const y = 2;', 'const z = 3;'].join('\n'),
};
const readSource = (file) => SOURCE[file] ?? null;

const worklist = (over = {}) => ({
  head: 'abc',
  selected: [
    {
      id: 'an-obligation',
      question: 'q',
      answerFields: ['a', 'b'],
      citedFields: [{ field: 'a' }],
      sites: [{ file: 'libs/a.ts', line: 1 }],
      truncated: 0,
      ...over,
    },
  ],
});

const sheet = (citations, answer = { a: 'x', b: 'y' }) => ({
  head: 'abc',
  answers: [
    {
      id: 'an-obligation',
      site: { file: 'libs/a.ts', line: 1 },
      answer,
      citations,
      raisedFindingIds: [],
    },
  ],
});

test('a quotation that matches the line it names is verified', () => {
  assert.deepEqual(
    verifyCitation(
      { file: 'libs/a.ts', line: 1, text: 'const x = 1;' },
      readSource,
    ),
    { ok: true },
  );
});

test('indentation is presentation, so a re-indented quote is the same quote', () => {
  // The reviewer reads a line through a tool that may or may not keep the
  // leading spaces. Failing on that would be a gate about whitespace, and
  // every real mismatch would be lost in the noise of it.
  assert.deepEqual(
    verifyCitation(
      { file: 'libs/a.ts', line: 2, text: 'const y = 2;' },
      readSource,
    ),
    { ok: true },
  );
});

test('a quotation whose text is not the text at that line is a mismatch', () => {
  const v = verifyCitation(
    { file: 'libs/a.ts', line: 2, text: 'const z = 3;' },
    readSource,
  );
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'text-differs');
  // The line that is actually there, so the failure names both sides.
  assert.equal(v.actual, 'const y = 2;');
});

test('a quotation whose line no longer exists is a mismatch, not a pass', () => {
  const v = verifyCitation(
    { file: 'libs/a.ts', line: 99, text: 'const x = 1;' },
    readSource,
  );
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'line-out-of-range');
  assert.equal(v.lineCount, 3);
});

test('a quotation of nothing but whitespace is refused before anything is read', () => {
  // The cheapest forgery available once whitespace is presentation: `" "`
  // collapses to the empty string and would otherwise match every blank line
  // in the tree, satisfying a citation without reading a thing.
  const v = verifyCitation({ file: 'libs/a.ts', line: 1, text: '   ' }, () => {
    throw new Error('the tree must not be read for a quotation of nothing');
  });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'quotes-nothing');
});

test('the trailing newline is not a line anybody can cite', () => {
  // `split('\n')` on a file ending in a newline yields a trailing empty
  // element. Counting it reports one more line than the file has, in the one
  // message whose whole job is to say how many there are.
  const withNewline = (file) =>
    file === 'libs/n.ts' ? 'const x = 1;\nconst y = 2;\n' : null;
  const v = verifyCitation(
    { file: 'libs/n.ts', line: 3, text: 'const z = 3;' },
    withNewline,
  );
  assert.equal(v.reason, 'line-out-of-range');
  assert.equal(v.lineCount, 2);
  // And the last real line still verifies.
  assert.deepEqual(
    verifyCitation(
      { file: 'libs/n.ts', line: 2, text: 'const y = 2;' },
      withNewline,
    ),
    { ok: true },
  );
});

test('a quotation from a file that is not in the tree at head is a mismatch', () => {
  const v = verifyCitation(
    { file: 'libs/gone.ts', line: 1, text: 'const x = 1;' },
    readSource,
  );
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'file-not-found');
});

test('a cited field with no citation fails; presence was never the weak point', () => {
  const report = checkAnswers(worklist(), sheet(undefined), { readSource });
  assert.equal(report.sound, false);
  assert.equal(report.citationFailures.length, 1);
  assert.equal(report.citationFailures[0].reason, 'uncited');
  assert.equal(report.citationFailures[0].field, 'a');
  // And it is not a completeness problem: every field carries a value.
  assert.equal(report.complete, true);
});

test('a verified citation is counted, and the sheet is sound', () => {
  const report = checkAnswers(
    worklist(),
    sheet({ a: { file: 'libs/a.ts', line: 1, text: 'const x = 1;' } }),
    { readSource },
  );
  assert.deepEqual(report.citations, { required: 1, verified: 1 });
  assert.deepEqual(report.citationFailures, []);
  assert.equal(report.sound, true);
});

test('an invented quotation fails the sheet', () => {
  const report = checkAnswers(
    worklist(),
    sheet({ a: { file: 'libs/a.ts', line: 1, text: 'const q = 9;' } }),
    { readSource },
  );
  assert.equal(report.sound, false);
  assert.equal(report.citationFailures[0].reason, 'text-differs');
  assert.deepEqual(report.citations, { required: 1, verified: 0 });
});

test('the one answer with no line to point at carries no citation', () => {
  // `wiredBy: "none"` says nothing invokes the gate. Requiring a quotation for
  // it would force the reviewer to invent one, which is the failure this check
  // exists to stop, arriving by the shortest possible route.
  const w = worklist({ citedFields: [{ field: 'a', uncitedWhen: 'none' }] });
  const report = checkAnswers(w, sheet(undefined, { a: 'none', b: 'y' }), {
    readSource,
  });
  assert.deepEqual(report.citations, { required: 0, verified: 0 });
  assert.equal(report.sound, true);
  // Any other value must still quote a line.
  const other = checkAnswers(w, sheet(undefined, { a: 'husky', b: 'y' }), {
    readSource,
  });
  assert.equal(other.citationFailures[0].reason, 'uncited');
});

test('a blank cited field is reported once, as incomplete', () => {
  // It is already named as missing; failing it a second time for quoting
  // nothing would report one hole twice and hide how many there are.
  const report = checkAnswers(worklist(), sheet(undefined, { a: '', b: 'y' }), {
    readSource,
  });
  assert.deepEqual(
    report.incomplete.map((i) => i.missing),
    [['a']],
  );
  assert.deepEqual(report.citationFailures, []);
});

test('a worklist with cited fields and no reader is refused, not skipped', () => {
  // The silent no-op shape: with no tree to read, every quotation would verify
  // and the report would say the sheet was sound — indistinguishable from the
  // state run 45 was in, which is the thing being fixed.
  assert.throws(
    () => checkAnswers(worklist(), sheet(undefined)),
    ObligationError,
  );
  assert.throws(() => checkAnswers(worklist(), sheet(undefined)), /readSource/);
});

test('a selected entry that cites nothing is refused, not waved through', () => {
  // The catalogue requires a cited field on every entry, so an entry arriving
  // without one did not come from the selector at this head. Defaulting it to
  // "cites nothing" would report the sheet sound while comparing none of it —
  // the same silent no-op as a missing reader, reached from the other side.
  const w = worklist({ citedFields: [] });
  assert.throws(
    () => checkAnswers(w, sheet(undefined), { readSource }),
    /names no cited field/,
  );
  const gone = worklist({ citedFields: undefined });
  assert.throws(
    () => checkAnswers(gone, sheet(undefined), { readSource }),
    ObligationError,
  );
});

test('a worklist on which nothing fired needs no reader and is not refused', () => {
  // The ordinary case: most diffs trigger no obligation at all.
  const report = checkAnswers(
    { head: 'abc', selected: [] },
    { head: 'abc', answers: [] },
  );
  assert.equal(report.expected, 0);
  assert.equal(report.sound, true);
});

test('the catalogue rejects an entry whose citations could never fire', () => {
  const bad = [
    [catalogue([obligation({ citedFields: undefined })]), /citedFields/],
    [catalogue([obligation({ citedFields: [] })]), /citedFields/],
    [catalogue([obligation({ citedFields: ['typo'] })]), /not an answerField/],
    [catalogue([obligation({ citedFields: ['a', 'a'] })]), /duplicate/],
    [catalogue([obligation({ citedFields: [{}] })]), /citedFields entry/],
    [
      catalogue([
        obligation({ citedFields: [{ field: 'a', uncitedWhen: '' }] }),
      ]),
      /uncitedWhen/,
    ],
  ];
  for (const [cat, re] of bad) {
    assert.throws(() => assertObligationCatalogue(cat), ObligationError);
    assert.throws(() => assertObligationCatalogue(cat), re);
  }
});

test('both spellings of a cited field normalize to one shape', () => {
  assert.deepEqual(
    normalizeCitedFields([
      'a',
      { field: 'b' },
      { field: 'c', uncitedWhen: 'none' },
    ]),
    [{ field: 'a' }, { field: 'b' }, { field: 'c', uncitedWhen: 'none' }],
  );
});

// ---------------------------------------------------------------------------
// The replay. Run 45's two answer sheets, through the checker as CI runs it,
// against the commits the golden set pins for those two cases.

const replay = (worklistFile, answersFile) =>
  spawnSync(
    process.execPath,
    [CHECKER, join(FIXTURES, worklistFile), join(FIXTURES, answersFile)],
    { encoding: 'utf8' },
  );

test('a head this clone does not have is "could not run", not "the reviewer is wrong"', () => {
  // `git show <head>:<file>` fails identically for a missing path and for a ref
  // that does not resolve, so without the guard a mistyped head reports every
  // quotation as citing a file that is not in the tree — the script's loudest
  // accusation about the reviewer, made when the reviewer did nothing wrong.
  const dir = mkdtempSync(join(tmpdir(), 'review-citations-'));
  try {
    const w = join(dir, 'worklist.json');
    const a = join(dir, 'answers.json');
    writeFileSync(w, JSON.stringify({ ...worklist(), head: '0'.repeat(40) }));
    writeFileSync(
      a,
      JSON.stringify({
        ...sheet({ a: { file: 'libs/a.ts', line: 1, text: 'const x = 1;' } }),
        head: '0'.repeat(40),
      }),
    );
    const out = spawnSync(process.execPath, [CHECKER, w, a], {
      encoding: 'utf8',
    });
    assert.equal(out.status, 2, out.stderr);
    assert.match(out.stderr, /is not a commit in this clone/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run 45: the signup sheet asserted where it should have cited', () => {
  // Sites 232 and 267 are the two the incident is about, and the two the
  // reviewer answered falsely; the other five FormControl sites in that file
  // were answered truthfully and are not what this fixture is for. The sheet
  // as written carries no quotation at all, which is now a failure with a
  // name rather than a report that called it complete.
  const out = replay('signup.worklist.json', 'signup.answers.json');
  assert.equal(out.status, 1, out.stderr);
  assert.match(out.stderr, /field slotChild claims something about source/);
  assert.equal(out.stderr.match(/quotes no line/g)?.length, 2);
});

test('run 45: the same claim, quoted, does not survive the tree', () => {
  // The answer carried forward with the citation it would have to write today.
  // `slotChild: "Input"` quoting the direct child's line reports what is
  // actually on that line at head: a positioning div.
  const out = replay('signup.worklist.json', 'signup.cited.answers.json');
  assert.equal(out.status, 1, out.stderr);
  assert.match(out.stderr, /where head has "<div className=\\"relative\\">"/);
});

test('run 45: the import-confirm sheet answers its own defect and raises nothing', () => {
  const out = replay(
    'import-confirm.worklist.json',
    'import-confirm.answers.json',
  );
  assert.equal(out.status, 1, out.stderr);
  assert.match(
    out.stderr,
    /answers its own defect condition and raises no finding/,
  );
  // And it quoted nothing either, which the same run had no way to notice.
  assert.match(
    out.stderr,
    /field confirmationText claims something about source/,
  );
});

// ---------------------------------------------------------------------------
// The self-contradiction, read out of the report rather than declared.

const defectWorklist = () =>
  worklist({ defectWhen: { field: 'a', equals: false } });

const defectSheet = (raisedFindingIds) => ({
  head: 'abc',
  answers: [
    {
      id: 'an-obligation',
      site: { file: 'libs/a.ts', line: 1 },
      answer: { a: false, b: 'y' },
      citations: { a: { file: 'libs/a.ts', line: 1, text: 'const x = 1;' } },
      ...(raisedFindingIds === undefined ? {} : { raisedFindingIds }),
    },
  ],
});

test('the obligation rule id is the one the catalogue mirrors', () => {
  assert.equal(obligationRuleId('an-obligation'), 'obligation-an-obligation');
});

test('an answer meeting its defect condition is cleared by the finding, not by saying so', () => {
  // The reviewer raised it: a finding with the mirrored rule id, in the site's
  // file. Nothing was declared in raisedFindingIds, because the reviewer has
  // no id to declare — the validator hashes those after the sheet is written.
  const report = checkAnswers(defectWorklist(), defectSheet(), {
    readSource,
    findings: [
      {
        ruleId: 'obligation-an-obligation',
        location: { file: 'libs/a.ts' },
      },
    ],
  });
  assert.deepEqual(report.contradictions, []);
  assert.equal(report.sound, true);
});

test('a report with no finding for the site contradicts the answer, whatever the sheet claims', () => {
  // And the invented declaration does not save it: this is the half of ADR
  // 0078 that a sheet cannot assert its way past.
  for (const declared of [undefined, [], ['invented-id']]) {
    const report = checkAnswers(defectWorklist(), defectSheet(declared), {
      readSource,
      findings: [
        { ruleId: 'standard-other', location: { file: 'libs/a.ts' } },
        {
          ruleId: 'obligation-an-obligation',
          location: { file: 'libs/elsewhere.ts' },
        },
      ],
    });
    assert.equal(report.contradictions.length, 1);
    assert.equal(report.contradictions[0].readFrom, 'report');
    assert.equal(report.sound, false);
  }
});

test('a finding the contract allows to carry no location still counts', () => {
  const report = checkAnswers(defectWorklist(), defectSheet(), {
    readSource,
    findings: [{ ruleId: 'obligation-an-obligation' }],
  });
  assert.deepEqual(report.contradictions, []);
});

test('with no report supplied the declaration is all there is, and it says so', () => {
  const none = checkAnswers(defectWorklist(), defectSheet(), { readSource });
  assert.equal(none.contradictions.length, 1);
  assert.equal(none.contradictions[0].readFrom, 'declaration');
  const declared = checkAnswers(defectWorklist(), defectSheet(['anything']), {
    readSource,
  });
  assert.deepEqual(declared.contradictions, []);
});

test('the checker reads --report and names the rule id it looked for', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-citations-'));
  try {
    const w = join(dir, 'worklist.json');
    const a = join(dir, 'answers.json');
    const r = join(dir, 'report.json');
    // Real files at a real head, so the citation itself verifies and the only
    // thing under test is the contradiction.
    const headFile = 'tools/scripts/review/obligations.mjs';
    const headLine = 1;
    const text = spawnSync('git', ['show', `HEAD:${headFile}`], {
      encoding: 'utf8',
    }).stdout.split('\n')[headLine - 1];
    const base = {
      head: 'HEAD',
      selected: [
        {
          id: 'an-obligation',
          question: 'q',
          answerFields: ['a', 'b'],
          citedFields: [{ field: 'a' }],
          sites: [{ file: headFile, line: headLine }],
          truncated: 0,
          defectWhen: { field: 'a', equals: false },
        },
      ],
    };
    writeFileSync(w, JSON.stringify(base));
    writeFileSync(
      a,
      JSON.stringify({
        head: 'HEAD',
        answers: [
          {
            id: 'an-obligation',
            site: { file: headFile, line: headLine },
            answer: { a: false, b: 'y' },
            citations: { a: { file: headFile, line: headLine, text } },
            raisedFindingIds: ['looks-like-an-id'],
          },
        ],
      }),
    );
    writeFileSync(r, JSON.stringify({ findings: [] }));
    const out = spawnSync(process.execPath, [CHECKER, w, a, '--report', r], {
      encoding: 'utf8',
    });
    assert.equal(out.status, 1, out.stderr);
    assert.match(out.stderr, /no finding with ruleId obligation-an-obligation/);
    // The citation line is always reported, including when nothing failed it.
    assert.match(out.stdout, /1 of 1 citation\(s\) verified/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Golden Replay run 35833576958 (pull request #884): the miss that quoted the
// wrong tree (docs/review/golden-replay-results.md, ADR 0101). The worklist is
// the selector's own output over the case range; the answer sheet is rebuilt
// from the checker line the results record quotes, because the run's artifact
// could not be fetched here — the citation is verbatim, the `wiredBy` value
// and the "not run" fields are what the record says the reviewer answered.

const FIXTURES_0923 = join(
  'tools',
  'scripts',
  'review',
  'fixtures',
  '2026-09-23',
);

test('run 35833576958: a wiredBy quoted from the checkout fails at the case head', () => {
  const out = spawnSync(
    process.execPath,
    [
      CHECKER,
      join(FIXTURES_0923, 'release-bump.worklist.json'),
      join(FIXTURES_0923, 'release-bump.answers.json'),
    ],
    { encoding: 'utf8' },
  );
  assert.equal(out.status, 1, out.stderr);
  assert.match(
    out.stderr,
    /field wiredBy quotes " {8}run: corepack yarn openapi:check" at \.github\/workflows\/ci\.yml:527, where head has "timeout-minutes: 30"/,
  );
});

test('run 35833576958: the same quotation holds at the pull request head it was read from', () => {
  // Which is why it looked like an answer. The check is only as good as the
  // head it reads, and the worklist records the case head, not the checkout.
  const worklist = JSON.parse(
    readFileSync(join(FIXTURES_0923, 'release-bump.worklist.json'), 'utf8'),
  );
  const sheet = JSON.parse(
    readFileSync(join(FIXTURES_0923, 'release-bump.answers.json'), 'utf8'),
  );
  const at = (head) => (file) => {
    const r = spawnSync('git', ['show', `${head}:${file}`], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return r.status === 0 ? r.stdout : null;
  };
  assert.equal(
    checkAnswers(worklist, sheet, {
      readSource: at('0b9046ec117323c1a5f1be865b280536ba651c8e'),
    }).sound,
    true,
  );
  assert.equal(
    checkAnswers(worklist, sheet, { readSource: at(worklist.head) }).sound,
    false,
  );
});
