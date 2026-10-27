import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  MAX_SITES_PER_OBLIGATION,
  ObligationError,
  assertObligationCatalogue,
  checkAnswers,
  defectHolds,
  enumMemberValues,
  globToRegExp,
  loadObligationCatalogue,
  parseAddedLines,
  selectObligations,
} from './obligations.ts';

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

const diff = (...lines) => lines.join('\n');

test('a well-formed catalogue is accepted', () => {
  assert.equal(assertObligationCatalogue(catalogue()).obligations.length, 1);
});

test('the catalogue rejects what would make it untrustworthy', () => {
  const bad = [
    [{ ...catalogue(), schemaVersion: 2 }, /schemaVersion/],
    [{ ...catalogue(), obligations: [] }, /non-empty/],
    [catalogue([obligation({ id: 'Not A Slug' })]), /lowercase slug/],
    [catalogue([obligation(), obligation()]), /duplicate obligation id/],
    [catalogue([obligation({ question: '' })]), /question/],
    [catalogue([obligation({ answerFields: [] })]), /answerFields/],
    [catalogue([obligation({ answerFields: ['a', 'a'] })]), /duplicate/],
    [catalogue([obligation({ trigger: { paths: [] } })]), /trigger.paths/],
    [
      catalogue([obligation({ trigger: { paths: ['x'], addedPattern: '(' } })]),
      /bad pattern/,
    ],
  ];
  for (const [cat, re] of bad) {
    assert.throws(() => assertObligationCatalogue(cat), ObligationError);
    assert.throws(() => assertObligationCatalogue(cat), re);
  }
});

test('an entry must cite the incident and the case that score it', () => {
  // Without these the catalogue can grow on prudence, which is the brief that
  // did not work. They are the difference between evidence and opinion.
  assert.throws(
    () =>
      assertObligationCatalogue(catalogue([obligation({ seededFrom: '' })])),
    /seededFrom/,
  );
  assert.throws(
    () =>
      assertObligationCatalogue(catalogue([obligation({ goldenCase: '' })])),
    /goldenCase/,
  );
});

test('globs match paths, and ** crosses separators where * does not', () => {
  assert.ok(globToRegExp('libs/**').test('libs/web-vault/src/a.ts'));
  assert.ok(globToRegExp('package.json').test('package.json'));
  assert.ok(!globToRegExp('libs/*').test('libs/a/b.ts'));
  assert.ok(globToRegExp('libs/*').test('libs/a.ts'));
  assert.ok(!globToRegExp('libs/**').test('apps/libs/a.ts'));
  // A dot is literal, not "any character".
  assert.ok(!globToRegExp('package.json').test('packageXjson'));
});

test('added lines carry their head line numbers', () => {
  const added = parseAddedLines(
    diff(
      'diff --git a/libs/a.ts b/libs/a.ts',
      '--- a/libs/a.ts',
      '+++ b/libs/a.ts',
      '@@ -1,0 +10,2 @@',
      '+first',
      '+second',
      '@@ -20,1 +30,1 @@',
      '-gone',
      '+third',
    ),
  );
  assert.deepEqual(added.get('libs/a.ts'), [
    { line: 10, text: 'first' },
    { line: 11, text: 'second' },
    { line: 30, text: 'third' },
  ]);
});

test('an added line carries the declaration git names in its hunk header', () => {
  const added = parseAddedLines(
    diff(
      '--- a/libs/a.ts',
      '+++ b/libs/a.ts',
      '@@ -4,0 +5 @@ export const Colour = {',
      "+    Red: 'red',",
    ),
  );
  assert.deepEqual(added.get('libs/a.ts'), [
    { line: 5, text: "    Red: 'red',", context: 'export const Colour = {' },
  ]);
});

test('a hunkPattern fires only inside a hunk whose declaration matches', () => {
  const cat = assertObligationCatalogue(
    catalogue([
      obligation({
        trigger: {
          paths: [
            {
              glob: 'libs/**',
              addedPattern: ': ',
              hunkPattern: 'const Colour\\b',
            },
          ],
        },
      }),
    ]),
  );
  const { selected } = selectObligations({
    catalogue: cat,
    addedLines: parseAddedLines(
      diff(
        '--- a/libs/a.ts',
        '+++ b/libs/a.ts',
        '@@ -4,0 +5 @@ export const Colour = {',
        "+    Red: 'red',",
        '@@ -9,0 +11 @@ export const Shape = {',
        "+    Round: 'round',",
        '@@ -20,0 +23 @@',
        "+    Blue: 'blue',",
      ),
    ),
    head: 'abc',
  });
  assert.deepEqual(selected[0].sites, [{ file: 'libs/a.ts', line: 5 }]);
});

test('a hunkPattern is validated like an addedPattern', () => {
  assert.throws(
    () =>
      assertObligationCatalogue(
        catalogue([
          obligation({ trigger: { paths: [{ glob: 'x', hunkPattern: '(' }] } }),
        ]),
      ),
    /bad pattern/,
  );
  assert.throws(
    () =>
      assertObligationCatalogue(
        catalogue([
          obligation({ trigger: { paths: [{ glob: 'x', hunkPattern: 3 }] } }),
        ]),
      ),
    /hunkPattern must be a string/,
  );
});

test('a removal-only file contributes no sites', () => {
  const added = parseAddedLines(
    diff(
      '--- a/libs/a.ts',
      '+++ b/libs/a.ts',
      '@@ -1,2 +0,0 @@',
      '-one',
      '-two',
    ),
  );
  assert.deepEqual(added.get('libs/a.ts'), []);
});

test('a path-only trigger fires on the file at its first changed line', () => {
  const added = parseAddedLines(
    diff('--- a/x', '+++ b/libs/a.ts', '@@ -0,0 +7,1 @@', '+anything'),
  );
  const { selected } = selectObligations({
    catalogue: catalogue(),
    addedLines: added,
    head: 'abc',
  });
  assert.deepEqual(selected[0].sites, [{ file: 'libs/a.ts', line: 7 }]);
});

test('a content trigger fires only on added lines that match', () => {
  const cat = catalogue([
    obligation({ trigger: { paths: ['libs/**'], addedPattern: 'needle' } }),
  ]);
  const added = parseAddedLines(
    diff(
      '--- a/x',
      '+++ b/libs/a.ts',
      '@@ -0,0 +1,3 @@',
      '+haystack',
      '+has needle here',
      '+haystack',
    ),
  );
  const { selected } = selectObligations({
    catalogue: cat,
    addedLines: added,
    head: 'abc',
  });
  assert.deepEqual(selected[0].sites, [{ file: 'libs/a.ts', line: 2 }]);
});

test('an obligation whose paths do not match does not fire at all', () => {
  const added = parseAddedLines(
    diff('--- a/x', '+++ b/apps/a.ts', '@@ -0,0 +1,1 @@', '+anything'),
  );
  const { selected } = selectObligations({
    catalogue: catalogue(),
    addedLines: added,
    head: 'abc',
  });
  // A diff that triggers nothing costs nothing: no entry, no prompt tokens.
  assert.deepEqual(selected, []);
});

test('sites are capped and the overflow is counted, not dropped silently', () => {
  const lines = ['--- a/x', '+++ b/libs/a.ts', '@@ -0,0 +1,40 @@'];
  for (let i = 0; i < 40; i += 1) lines.push('+needle');
  const cat = catalogue([
    obligation({ trigger: { paths: ['libs/**'], addedPattern: 'needle' } }),
  ]);
  const { selected } = selectObligations({
    catalogue: cat,
    addedLines: parseAddedLines(diff(...lines)),
    head: 'abc',
  });
  assert.equal(selected[0].sites.length, MAX_SITES_PER_OBLIGATION);
  assert.equal(selected[0].truncated, 40 - MAX_SITES_PER_OBLIGATION);
});

// Every catalogue entry now names at least one cited field, and checkAnswers
// refuses a selected entry that does not (ADR 0078), so these completeness
// fixtures carry one. They assert on completeness alone; whether the quotation
// holds is tools/scripts/review/citations.test.ts.
const io = { readSource: () => null };

const worklist = {
  head: 'abc',
  selected: [
    {
      id: 'an-obligation',
      title: 'An obligation',
      question: 'Answer this.',
      answerFields: ['a', 'b'],
      citedFields: [{ field: 'a' }],
      defect: 'a is false',
      sites: [
        { file: 'libs/a.ts', line: 1 },
        { file: 'libs/b.ts', line: 2 },
      ],
      truncated: 0,
    },
  ],
};

test('a fully answered worklist is complete', () => {
  const report = checkAnswers(
    worklist,
    {
      head: 'abc',
      answers: [
        {
          id: 'an-obligation',
          site: worklist.selected[0].sites[0],
          answer: { a: 1, b: 2 },
        },
        {
          id: 'an-obligation',
          site: worklist.selected[0].sites[1],
          answer: { a: 1, b: 2 },
        },
      ],
    },
    io,
  );
  assert.equal(report.complete, true);
  assert.equal(report.answered, 2);
  assert.equal(report.expected, 2);
});

test('an unanswered site is named, and completeness is false', () => {
  const report = checkAnswers(
    worklist,
    {
      head: 'abc',
      answers: [
        {
          id: 'an-obligation',
          site: worklist.selected[0].sites[0],
          answer: { a: 1, b: 2 },
        },
      ],
    },
    io,
  );
  assert.equal(report.complete, false);
  assert.equal(report.unanswered.length, 1);
  assert.equal(report.unanswered[0].site.file, 'libs/b.ts');
});

test('a missing answer field is incomplete, not merely present', () => {
  const report = checkAnswers(
    worklist,
    {
      head: 'abc',
      answers: [
        {
          id: 'an-obligation',
          site: worklist.selected[0].sites[0],
          answer: { a: 1 },
        },
        {
          id: 'an-obligation',
          site: worklist.selected[0].sites[1],
          answer: { a: 1, b: null },
        },
      ],
    },
    io,
  );
  assert.equal(report.complete, false);
  assert.deepEqual(
    report.incomplete.map((i) => i.missing),
    [['b'], ['b']],
  );
});

test('an empty or whitespace-only answer is not an answer', () => {
  // Presence is not an answer. Every obligation's defect rule is a comparison
  // over what was written - namesEverything against a quoted confirmation,
  // runtimeValue against an expression - so a blank field satisfies the
  // completeness signal while leaving the question unanswered.
  const report = checkAnswers(
    worklist,
    {
      head: 'abc',
      answers: [
        {
          id: 'an-obligation',
          site: worklist.selected[0].sites[0],
          answer: { a: '', b: 2 },
        },
        {
          id: 'an-obligation',
          site: worklist.selected[0].sites[1],
          answer: { a: 1, b: '   ' },
        },
      ],
    },
    io,
  );
  assert.equal(report.complete, false);
  assert.deepEqual(
    report.incomplete.map((i) => i.missing),
    [['a'], ['b']],
  );
});

test('false and zero are answers, and are not mistaken for blanks', () => {
  // The obvious way to write the blank test is a falsiness check, which would
  // discard exactly the answers that matter: namesEverything and
  // isFocusableControl are findings precisely when they are false.
  const report = checkAnswers(
    worklist,
    {
      head: 'abc',
      answers: [
        {
          id: 'an-obligation',
          site: worklist.selected[0].sites[0],
          answer: { a: false, b: 0 },
        },
        {
          id: 'an-obligation',
          site: worklist.selected[0].sites[1],
          answer: { a: false, b: 0 },
        },
      ],
    },
    io,
  );
  assert.equal(report.complete, true);
  assert.deepEqual(report.incomplete, []);
});

test('the real selector output carries defectWhen all the way to checkAnswers', () => {
  // The wiring, not the pieces. defectWhen was validated in the catalogue and
  // read in checkAnswers, and selectObligations - the only thing that builds a
  // worklist in the real pipeline - did not copy it. Every test until this one
  // hand-built a worklist literal with defectWhen already set, so they all
  // passed while the gate could not fire once. The contradiction guard reads
  // `want.defectWhen && ...`, so a dropped field is not an error: it is a gate
  // that passes everything, silently.
  const catalogue = loadObligationCatalogue();
  const addedLines = parseAddedLines(
    diff('--- a/x', '+++ b/apps/a.tsx', '@@ -0,0 +1,1 @@', '+  <FormControl>'),
  );
  const w = selectObligations({ catalogue, addedLines, head: 'abc' });
  assert.equal(w.selected.length, 1);
  assert.ok(w.selected[0].defectWhen, 'defectWhen must survive selection');
  assert.deepEqual(
    w.selected[0].citedFields,
    [{ field: 'slotChild' }],
    'citedFields must survive selection for the same reason defectWhen must',
  );

  const sheet = {
    head: 'abc',
    answers: w.selected.flatMap((o) =>
      o.sites.map((site) => ({
        id: o.id,
        site,
        answer: {
          slotChild: 'div',
          propsLandOn: 'div',
          isFocusableControl: false,
        },
        citations: {
          slotChild: {
            file: 'apps/a.tsx',
            line: 2,
            text: '<div className="relative">',
          },
        },
        raisedFindingIds: [],
      })),
    ),
  };
  const readSource = () => '  <FormControl>\n  <div className="relative">\n';
  assert.equal(checkAnswers(w, sheet, { readSource }).contradictions.length, 1);
});

test('an answer meeting its own defect condition and raising nothing contradicts itself', () => {
  // Run 45. import-confirm wrote namesEverything: false - which its own defect
  // rule calls a finding in as many words - and raised nothing, and the
  // completeness report called that sheet complete. Completeness was never
  // the weak point: the answer was there, it was just ignored.
  const w = {
    head: 'abc',
    selected: [
      {
        id: 'an-obligation',
        question: 'q',
        answerFields: ['a', 'b'],
        citedFields: [{ field: 'a' }],
        defectWhen: { field: 'b', equals: false },
        sites: worklist.selected[0].sites,
      },
    ],
  };
  const report = checkAnswers(
    w,
    {
      head: 'abc',
      answers: [
        {
          id: 'an-obligation',
          site: w.selected[0].sites[0],
          answer: { a: 1, b: false },
          raisedFindingIds: [],
        },
        {
          id: 'an-obligation',
          site: w.selected[0].sites[1],
          answer: { a: 1, b: false },
          raisedFindingIds: ['f1'],
        },
      ],
    },
    io,
  );
  assert.equal(report.contradictions.length, 1);
  assert.equal(report.contradictions[0].site.file, w.selected[0].sites[0].file);
  // The old signal saw nothing wrong, which is the point.
  assert.equal(report.complete, true);
});

test('a blank field is reported once as incomplete, not also as a contradiction', () => {
  const w = {
    head: 'abc',
    selected: [
      {
        id: 'an-obligation',
        question: 'q',
        answerFields: ['a', 'b'],
        citedFields: [{ field: 'a' }],
        defectWhen: { field: 'b', equals: undefined },
        sites: [worklist.selected[0].sites[0]],
      },
    ],
  };
  const report = checkAnswers(
    w,
    {
      head: 'abc',
      answers: [
        { id: 'an-obligation', site: w.selected[0].sites[0], answer: { a: 1 } },
      ],
    },
    io,
  );
  assert.equal(report.incomplete.length, 1);
  assert.equal(report.contradictions.length, 0);
});

test('defectHolds composes all and any, and an unknown shape never fires', () => {
  const gate = {
    any: [
      { field: 'exitCode', notEquals: 0 },
      {
        all: [
          { field: 'exitCode', equals: 0 },
          { field: 'wiredBy', equals: 'none' },
        ],
      },
    ],
  };
  assert.equal(defectHolds(gate, { exitCode: 1, wiredBy: 'husky' }), true);
  assert.equal(defectHolds(gate, { exitCode: 0, wiredBy: 'none' }), true);
  assert.equal(defectHolds(gate, { exitCode: 0, wiredBy: 'husky' }), false);
  // A rule nobody can satisfy is worse than no rule, so these stay false
  // rather than throwing and taking a whole review down with them.
  assert.equal(defectHolds(undefined, { a: 1 }), false);
  assert.equal(defectHolds({}, { a: 1 }), false);
  assert.equal(defectHolds({ all: [] }, { a: 1 }), false);
});

test('a defectWhen naming a field outside answerFields is a load error', () => {
  // The silent no-op shape: a rule that looks present and can never fire.
  assert.throws(
    () =>
      assertObligationCatalogue(
        catalogue([
          obligation({
            answerFields: ['a'],
            defectWhen: { field: 'typo', equals: false },
          }),
        ]),
      ),
    /not an answerField/,
  );
});

test('an answer for a site nobody asked about is reported, not counted', () => {
  const report = checkAnswers(
    worklist,
    {
      head: 'abc',
      answers: [
        {
          id: 'an-obligation',
          site: { file: 'libs/z.ts', line: 9 },
          answer: { a: 1, b: 2 },
        },
      ],
    },
    io,
  );
  assert.equal(report.answered, 0);
  assert.equal(report.unexpected.length, 1);
});

test('an empty worklist is not "complete" — there was nothing to complete', () => {
  const report = checkAnswers(
    { head: 'abc', selected: [] },
    {
      head: 'abc',
      answers: [],
    },
  );
  assert.equal(report.expected, 0);
  assert.equal(report.complete, false);
});

test('a path may carry its own addedPattern, overriding the entry-level one', () => {
  // One entry often spans a value line and a whole generated directory. The
  // gate obligation shipped firing on ANY package.json edit because a single
  // entry-level pattern cannot say both things; the CI reviewer proved it on
  // this branch's own scripts-only edit.
  const cat = catalogue([
    obligation({
      trigger: {
        paths: [{ glob: 'package.json', addedPattern: 'needle' }, 'libs/**'],
      },
    }),
  ]);
  const fired = (diffText) =>
    selectObligations({
      catalogue: cat,
      addedLines: parseAddedLines(diffText),
      head: 'abc',
    }).selected;

  // The pattern gates package.json...
  assert.deepEqual(
    fired(diff('--- a/x', '+++ b/package.json', '@@ -0,0 +1,1 @@', '+chaff')),
    [],
  );
  assert.equal(
    fired(diff('--- a/x', '+++ b/package.json', '@@ -0,0 +1,1 @@', '+needle'))
      .length,
    1,
  );
  // ...and does not leak onto the bare glob beside it.
  assert.equal(
    fired(diff('--- a/x', '+++ b/libs/a.ts', '@@ -0,0 +1,1 @@', '+chaff'))
      .length,
    1,
  );
});

test('one glob compiler, and it does not eat the separator after **', () => {
  // There were two. This module carried its own, in which `**` consumed the
  // following `/` without putting one back, so `libs/**/x.ts` matched
  // `libs/ax.ts`; `?` was a literal here and a wildcard in the other. A glob
  // moved between the two catalogues changed meaning.
  assert.ok(!globToRegExp('libs/**/x.ts').test('libs/ax.ts'));
  assert.ok(globToRegExp('libs/**/x.ts').test('libs/a/x.ts'));
  // `**/` is optional, so the pattern still matches with no directory between.
  assert.ok(globToRegExp('libs/**/x.ts').test('libs/x.ts'));
  assert.ok(globToRegExp('a?.ts').test('ab.ts'));
  assert.ok(!globToRegExp('a?.ts').test('abc.ts'));
});

test('a path object is validated like any other trigger', () => {
  assert.throws(
    () =>
      assertObligationCatalogue(
        catalogue([obligation({ trigger: { paths: [{}] } })]),
      ),
    /needs a glob/,
  );
  assert.throws(
    () =>
      assertObligationCatalogue(
        catalogue([
          obligation({
            trigger: { paths: [{ glob: 'x', addedPattern: '(' }] },
          }),
        ]),
      ),
    /bad pattern/,
  );
});

test('the shipped catalogue is well-formed', () => {
  assert.ok(loadObligationCatalogue().obligations.length > 0);
});

// The point of the catalogue is that these four shapes stop depending on the
// reviewer noticing them. Each case below is the shape of the incident the
// entry was bought from; if the selector stops firing on it, the entry is
// dead and the golden case that scores it can only ever miss.
const ENV = 'process' + '.env.';

const fires = (id, diffText) => {
  const { selected } = selectObligations({
    catalogue: loadObligationCatalogue(),
    addedLines: parseAddedLines(diffText),
    head: 'abc',
  });
  return selected.some((o) => o.id === id);
};

test('#408: a version bump fires the gate obligation', () => {
  assert.ok(
    fires(
      'run-the-gate-that-covers-this-change',
      diff(
        '--- a/x',
        '+++ b/package.json',
        '@@ -3,1 +3,1 @@',
        '+  "version": "0.4.0",',
      ),
    ),
  );
});

test('#657: a bare window.confirm fires the destructive-confirmation obligation', () => {
  assert.ok(
    fires(
      'destructive-confirmation-names-what-it-mutates',
      diff(
        '--- a/x',
        '+++ b/apps/web/src/app/vault-export/page.tsx',
        '@@ -0,0 +88,1 @@',
        "+    if (!window.confirm('Importing will replace your current local vault data. Continue?')) return;",
      ),
    ),
  );
});

test('#525: a FormControl fires the slot obligation', () => {
  assert.ok(
    fires(
      'slot-injected-props-land-on-the-control',
      diff(
        '--- a/x',
        '+++ b/apps/web/src/app/(auth)/signup/page.tsx',
        '@@ -0,0 +40,2 @@',
        '+              <FormControl>',
        '+                <div className="relative">',
      ),
    ),
  );
});

test('#409: a process.env assignment fires the env obligation', () => {
  assert.ok(
    fires(
      'env-assignment-runtime-value',
      diff(
        '--- a/x',
        '+++ b/apps/backend/src/services/EmailService.spec.ts',
        '@@ -0,0 +12,1 @@',
        '+    process.env.MAIL_USERNAME = undefined;',
      ),
    ),
  );
});

test('#408: a package.json edit that is not a version bump does NOT fire', () => {
  // The boundary the reviewer found unverified, and the behaviour it should
  // have had: adding a yarn script is not a release.
  assert.ok(
    !fires(
      'run-the-gate-that-covers-this-change',
      diff(
        '--- a/x',
        '+++ b/package.json',
        '@@ -10,1 +10,1 @@',
        '+    "review:obligations:select": "node x.mjs",',
      ),
    ),
  );
});

test('#408: a generated output still fires without a version line', () => {
  assert.ok(
    fires(
      'run-the-gate-that-covers-this-change',
      diff(
        '--- a/x',
        '+++ b/libs/api-specs/src/api-specs.openapi.yaml',
        '@@ -1,1 +1,1 @@',
        '+  title: MyOrganiser',
      ),
    ),
  );
});

test('#409: a comparison is not an assignment and does not fire', () => {
  // The pattern ended at a bare `=`, which is also the first character of
  // `===`, so every ordinary read of an environment variable fired the
  // obligation. A trigger that fires everywhere teaches the reviewer to ignore
  // it, which is the failure the checklist exists to avoid.
  const READ = '+  if (' + ENV + "NODE_ENV === 'production') {";
  assert.ok(
    !fires(
      'env-assignment-runtime-value',
      diff('--- a/x', '+++ b/apps/a.ts', '@@ -0,0 +1,1 @@', READ),
    ),
  );
});

test('a diff touching none of those shapes fires nothing', () => {
  const { selected } = selectObligations({
    catalogue: loadObligationCatalogue(),
    addedLines: parseAddedLines(
      diff('--- a/x', '+++ b/docs/adr/0074-x.md', '@@ -0,0 +1,1 @@', '+prose'),
    ),
    head: 'abc',
  });
  assert.deepEqual(selected, []);
});

// --- Covering Gate: a fact the catalogue states, not a choice (ADR 0098) -----
//
// Golden Replay run 47 answered `gate: "deploy:pages:check"` with a citation
// that matched the tree. Every field was true, the defect correctly did not
// fire, and the answer was about the wrong gate. The golden case is explicitly
// NOT the signal these tests replace — it draws from a distribution and was
// caught repeatedly while the gap was open. What is asserted here is the
// mechanism: that answer is no longer expressible.

const gated = (over = {}) =>
  obligation({
    answerFields: ['wiredBy'],
    citedFields: ['wiredBy'],
    siteFields: ['coveringGate'],
    trigger: {
      paths: [{ glob: 'libs/**', coveringGate: 'openapi:check' }],
    },
    ...over,
  });

test('a trigger path must carry every declared site field', () => {
  const bad = [
    // The whole point of requiring it: an entry that omits the gate cannot
    // load, so "no map entry exists" is unrepresentable and the only state
    // left is "no gate covers this" — which is `wiredBy: "none"`.
    [gated({ trigger: { paths: [{ glob: 'libs/**' }] } }), /coveringGate/],
    [
      gated({ trigger: { paths: [{ glob: 'libs/**', coveringGate: '' }] } }),
      /non-empty coveringGate/,
    ],
    // A bare glob is the pre-0098 spelling and carries nothing, so it cannot
    // satisfy a site field either.
    [gated({ trigger: { paths: ['libs/**'] } }), /must carry coveringGate/],
    [gated({ siteFields: [] }), /siteFields/],
    [gated({ siteFields: ['coveringGate', 'coveringGate'] }), /duplicate/],
    // A field cannot be both stated and asked for; that is the ambiguity the
    // ADR removes.
    [
      gated({ answerFields: ['wiredBy', 'coveringGate'] }),
      /both siteFields and answerFields/,
    ],
  ];
  for (const o of bad) {
    const cat = catalogue([o[0]]);
    assert.throws(() => assertObligationCatalogue(cat), ObligationError);
    assert.throws(() => assertObligationCatalogue(cat), o[1]);
  }
});

test('the selector carries the covering gate onto every site it produces', () => {
  const worklist = selectObligations({
    catalogue: assertObligationCatalogue(
      catalogue([
        gated({
          trigger: {
            paths: [
              { glob: 'libs/tokens/**', coveringGate: 'design-tokens:check' },
              { glob: 'libs/**', coveringGate: 'openapi:check' },
            ],
          },
        }),
      ]),
    ),
    addedLines: parseAddedLines(
      diff(
        '--- a/libs/tokens/t.json',
        '+++ b/libs/tokens/t.json',
        '@@ -1,0 +1 @@',
        '+one',
        '--- a/libs/other/o.ts',
        '+++ b/libs/other/o.ts',
        '@@ -1,0 +1 @@',
        '+two',
      ),
    ),
    head: 'HEAD',
  });
  const [entry] = worklist.selected;
  assert.deepEqual(entry.siteFields, ['coveringGate']);
  // First matching rule wins, so the narrower glob must be the one that
  // decides — a site is about the gate over ITS trigger, not the entry's.
  assert.deepEqual(
    Object.fromEntries(entry.sites.map((s) => [s.file, s.coveringGate])),
    {
      'libs/tokens/t.json': 'design-tokens:check',
      'libs/other/o.ts': 'openapi:check',
    },
  );
});

test("run 47's answer is not expressible: gate is not an answer field", () => {
  const live = loadObligationCatalogue();
  const entry = live.obligations.find(
    (o) => o.id === 'run-the-gate-that-covers-this-change',
  );

  // The field the reviewer filled with `deploy:pages:check` is gone from the
  // sheet entirely. Citing it would only have proved the named gate exists.
  assert.equal(entry.answerFields.includes('gate'), false);
  assert.deepEqual(entry.answerFields, ['command', 'exitCode', 'wiredBy']);
  assert.deepEqual(entry.siteFields, ['coveringGate']);

  // And the gate it should have named is the one the site now hands it. The
  // run 47 diff was a version bump: the invalidated artifact is the OpenAPI
  // spec and the generated client, neither of which is in that diff.
  const worklist = selectObligations({
    catalogue: live,
    addedLines: parseAddedLines(
      diff(
        '--- a/package.json',
        '+++ b/package.json',
        '@@ -3,1 +3,1 @@',
        '+  "version": "0.4.0",',
      ),
    ),
    head: 'HEAD',
  });
  const fired = worklist.selected.find(
    (o) => o.id === 'run-the-gate-that-covers-this-change',
  );
  assert.deepEqual(
    fired.sites.map((s) => s.coveringGate),
    ['openapi:check'],
  );
});

test('every covering gate in the live catalogue names a real script', () => {
  const live = loadObligationCatalogue();
  const scripts = new Set(
    Object.keys(
      JSON.parse(
        readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
      ).scripts,
    ),
  );
  for (const o of live.obligations)
    for (const p of o.trigger.paths)
      for (const f of o.siteFields ?? [])
        if (f === 'coveringGate')
          assert.ok(
            scripts.has(p[f]),
            `${o.id}: ${p.glob}: coveringGate ${p[f]} is not a package.json script`,
          );
});

// --- Enum fan-out: the lesson ADR 0053 recorded, carried by the harness ------
//
// Both enum fan-out golden cases predate ADR 0053, and since ADR 0102 the
// replay reviews the case head's tree, standards included, so the reviewer has
// no document to cite. The obligation is the harness carrying the lesson
// instead (#895). Its trigger is expanded from enum:fanout:check's own list;
// the tests below fail if any guarded enum stops firing, or if the trigger
// names an enum that list does not carry.

const ENUM_FANOUT = 'enum-fanout-omits-a-member';

const enumFanoutSites = (diffText) =>
  selectObligations({
    catalogue: loadObligationCatalogue(),
    addedLines: parseAddedLines(diffText),
    head: 'abc',
  }).selected.find((o) => o.id === ENUM_FANOUT)?.sites ?? [];

test('#512: a member added to a guarded enum fires the fan-out obligation', () => {
  const sites = enumFanoutSites(
    diff(
      '--- a/libs/app-api-client/src/api.ts',
      '+++ b/libs/app-api-client/src/api.ts',
      '@@ -1662,0 +1669,1 @@ export const VaultBlobType = {',
      "+    Groceries: 'groceries',",
      '@@ -1518,0 +1525 @@ export const VaultBackupBlobType = {',
      "+    Groceries: 'groceries',",
    ),
  );
  // Only the guarded enum's own declaration: the generated client declares a
  // dozen enums, and a trigger on every member line of every one of them spent
  // the whole site cap on #537's audit enums before reaching the consumer.
  assert.deepEqual(sites, [
    {
      file: 'libs/app-api-client/src/api.ts',
      line: 1669,
      coveringGate: 'enum:fanout:check',
    },
  ]);
});

test('#537: a consumer naming members on the enum fires the fan-out obligation, as at the case head', () => {
  const sites = enumFanoutSites(
    diff(
      '--- a/libs/web-vault/src/lib/vault/vaultExportImport.ts',
      '+++ b/libs/web-vault/src/lib/vault/vaultExportImport.ts',
      '@@ -0,0 +64,2 @@',
      '+  if (envelope.blobs.addresses) out.push(VaultBlobType.Addresses);',
      '+  if (envelope.blobs.mobileNumbers) out.push(VaultBlobType.MobileNumbers);',
    ),
  );
  assert.deepEqual(
    sites.map((s) => [s.line, s.coveringGate]),
    [
      [64, 'enum:fanout:check'],
      [65, 'enum:fanout:check'],
    ],
  );
});

test('an enum-shaped line outside the guarded definition does not fire the fan-out obligation', () => {
  assert.deepEqual(
    enumFanoutSites(
      diff(
        '--- a/apps/web/src/a.ts',
        '+++ b/apps/web/src/a.ts',
        '@@ -0,0 +1,1 @@',
        "+    Groceries: 'groceries',",
      ),
    ),
    [],
  );
});

test('the fan-out obligation fires on every enum enum:fanout:check guards', async () => {
  const { GUARDED_ENUMS } = await import('../lib/enum-fanout-guarded.ts');
  assert.ok(GUARDED_ENUMS.length > 0);
  for (const guard of GUARDED_ENUMS) {
    // A member added where the enum is defined.
    assert.equal(
      enumFanoutSites(
        diff(
          `--- a/${guard.definedIn}`,
          `+++ b/${guard.definedIn}`,
          `@@ -1,0 +2,1 @@ export const ${guard.enum} = {`,
          "+    Seventh: 'seventh',",
        ),
      ).length,
      1,
      `${guard.enum}: a member added in ${guard.definedIn} does not fire`,
    );
    // A consumer naming two members, anywhere the checker would scan it.
    for (const root of [...guard.valueRoots, 'apps/web/src/']) {
      const file = `${root}consumer.ts`;
      assert.equal(
        enumFanoutSites(
          diff(
            `--- a/${file}`,
            `+++ b/${file}`,
            '@@ -0,0 +1,1 @@',
            `+  const both = [${guard.enum}.First, ${guard.enum}.Second];`,
          ),
        ).length,
        1,
        `${guard.enum}: a consumer in ${root} does not fire`,
      );
    }
  }
});

test('excludePaths keeps a matching file out of every trigger path', () => {
  const cat = assertObligationCatalogue(
    catalogue([
      obligation({
        trigger: {
          paths: [{ glob: 'libs/**', addedPattern: 'Colour\\.' }],
          excludePaths: ['**/*.test.ts'],
        },
      }),
    ]),
  );
  const { selected } = selectObligations({
    catalogue: cat,
    addedLines: parseAddedLines(
      diff(
        '--- a/libs/a.ts',
        '+++ b/libs/a.ts',
        '@@ -0,0 +1 @@',
        '+  use(Colour.Red);',
        '--- a/libs/a.test.ts',
        '+++ b/libs/a.test.ts',
        '@@ -0,0 +1 @@',
        '+  expect(Colour.Red);',
      ),
    ),
    head: 'abc',
  });
  assert.deepEqual(selected[0].sites, [{ file: 'libs/a.ts', line: 1 }]);
  assert.throws(
    () =>
      assertObligationCatalogue(
        catalogue([
          obligation({ trigger: { paths: ['x'], excludePaths: 'x' } }),
        ]),
      ),
    /excludePaths/,
  );
});

test('#537: a test listing members as fixtures is not a site, so one finding answers the case', () => {
  // A test site would carry the same omission answer as the consumer, and the
  // answer-sheet check only counts a finding anchored in the site's own file —
  // so the reviewer's one correct finding would leave the test sites
  // contradicting themselves and void the replay.
  for (const file of [
    'libs/web-vault/src/lib/vault/vaultExportImportHardened.test.ts',
    'apps/web/src/a.spec.tsx',
  ])
    assert.deepEqual(
      enumFanoutSites(
        diff(
          `--- a/${file}`,
          `+++ b/${file}`,
          '@@ -0,0 +124,1 @@',
          '+        VaultBlobType.Addresses,',
        ),
      ),
      [],
    );
});

// --- The trigger is generated from enum:fanout:check's list, not restated ---
//
// PR #998's review: a consumer that lists members as property names
// (`localVault.data.tasks`) — the shape envelopeFromLocalVault actually had —
// never wrote `VaultBlobType`, so a trigger on the enum's name alone could miss
// it. The checker already knows where member values mean blob types
// (`valueRoots`), and the selector can read the values at the reviewed head.

const VAULT_MEMBERS = [
  'addresses',
  'groceries',
  'mobileNumbers',
  'subscriptions',
  'tasks',
  'todos',
];

const generatedSites = (diffText, membersOf = () => VAULT_MEMBERS) =>
  selectObligations({
    catalogue: loadObligationCatalogue(undefined, { membersOf }),
    addedLines: parseAddedLines(diffText),
    head: 'abc',
  }).selected.find((o) => o.id === ENUM_FANOUT)?.sites ?? [];

test('a consumer listing members as property names inside a value root fires', async () => {
  const { GUARDED_ENUMS } = await import('../lib/enum-fanout-guarded.ts');
  for (const root of GUARDED_ENUMS[0].valueRoots) {
    const file = `${root}lib/vault/envelope.ts`;
    assert.deepEqual(
      generatedSites(
        diff(
          `--- a/${file}`,
          `+++ b/${file}`,
          '@@ -0,0 +12,1 @@',
          '+  if (localVault.data.tasks) {',
        ),
      ).map((s) => s.line),
      [12],
      `${root}: a property-name consumer does not fire`,
    );
  }
});

test('a member value outside the value roots does not fire', () => {
  assert.deepEqual(
    generatedSites(
      diff(
        '--- a/apps/web/src/a.ts',
        '+++ b/apps/web/src/a.ts',
        '@@ -0,0 +1,1 @@',
        '+  const pending = project.tasks.filter(Boolean);',
      ),
    ),
    [],
  );
});

test('with no member values at head, only the enum-qualified shapes fire', () => {
  const file = 'libs/web/vault/src/lib/vault/envelope.ts';
  assert.deepEqual(
    generatedSites(
      diff(
        `--- a/${file}`,
        `+++ b/${file}`,
        '@@ -0,0 +1,2 @@',
        '+  if (localVault.data.tasks) {',
        '+  out.push(VaultBlobType.Tasks);',
      ),
      () => [],
    ).map((s) => s.line),
    [2],
  );
});

test('the catalogue names no enum: every one comes from the checker list, both ways', async () => {
  const { GUARDED_ENUMS } = await import('../lib/enum-fanout-guarded.ts');
  const raw = JSON.parse(
    readFileSync(
      new URL('../../config/review-obligations.json', import.meta.url),
      'utf8',
    ),
  );
  const entry = raw.obligations.find((o) => o.id === ENUM_FANOUT);
  for (const g of GUARDED_ENUMS)
    assert.equal(
      JSON.stringify(entry.trigger).includes(g.enum),
      false,
      `the catalogue restates ${g.enum}`,
    );
  // And the reverse: every enum the expanded trigger names is a guarded one.
  const named = new Set();
  for (const p of loadObligationCatalogue().obligations.find(
    (o) => o.id === ENUM_FANOUT,
  ).trigger.paths)
    for (const s of [p.addedPattern, p.hunkPattern].filter(Boolean))
      for (const m of s.matchAll(/([A-Z][A-Za-z0-9]+)(?:\\\.| = )/g))
        named.add(m[1]);
  assert.deepEqual(
    [...named].sort(),
    [...new Set(GUARDED_ENUMS.map((g) => g.enum))].sort(),
  );
});

test('enumMemberValues reads a const-object enum out of the generated client', () => {
  const source = [
    'export const VaultBackupBlobType = {',
    "    Addresses: 'addresses',",
    '} as const;',
    'export const VaultBlobType = {',
    "    Addresses: 'addresses',",
    "    Tasks: 'tasks',",
    "    Todos: 'todos'",
    '} as const;',
  ].join('\n');
  assert.deepEqual(enumMemberValues(source, 'VaultBlobType'), [
    'addresses',
    'tasks',
    'todos',
  ]);
  assert.deepEqual(enumMemberValues(source, 'Missing'), []);
  assert.deepEqual(enumMemberValues(null, 'VaultBlobType'), []);
});

test('the selector reads member values from the reviewed head, not the tooling tree', async () => {
  const { main } = await import('./select-obligations.ts');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const out = join(mkdtempSync(join(tmpdir(), 'select-')), 'w.json');
  const file = 'libs/vault-core/src/lib/envelope.ts';
  const reads = [];
  main(['--base', 'b', '--head', 'h', '--out', out], {
    run: () =>
      diff(
        `--- a/${file}`,
        `+++ b/${file}`,
        '@@ -0,0 +7,1 @@',
        '+  if (local.data.chores) {',
      ),
    read: (head, path) => {
      reads.push([head, path]);
      return "export const VaultBlobType = {\n    Chores: 'chores'\n} as const;";
    },
  });
  const worklist = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(
    worklist.selected
      .find((o) => o.id === ENUM_FANOUT)
      .sites.map((s) => s.line),
    [7],
  );
  assert.ok(reads.every(([head]) => head === 'h'));
});

test("the checker's declaration sites are not consumers and never a site", async () => {
  const { GUARDED_ENUMS } = await import('../lib/enum-fanout-guarded.ts');
  for (const { path } of GUARDED_ENUMS[0].declarationSites)
    assert.deepEqual(
      generatedSites(
        diff(
          `--- a/${path}`,
          `+++ b/${path}`,
          '@@ -0,0 +2,2 @@',
          "+  | 'tasks'",
          '+  tasks: EncryptedBlobSchema.optional(),',
        ),
      ),
      [],
      `${path} fired`,
    );
});

test('the worklist names every file the diff added lines to, most lines first', () => {
  // Read outside the model, so the coverage fact is held to a list the
  // reviewer did not write (issue #1140).
  const { changedFiles } = selectObligations({
    catalogue: { schemaVersion: 1, obligations: [] },
    addedLines: parseAddedLines(
      diff(
        '--- a/tools/a.mjs',
        '+++ b/tools/a.mjs',
        '@@ -1,0 +2,2 @@',
        '+one',
        '+two',
        '--- a/.github/workflows/deploy.yml',
        '+++ b/.github/workflows/deploy.yml',
        '@@ -1,0 +2,3 @@',
        '+a',
        '+b',
        '+c',
      ),
    ),
    head: 'abc',
  });
  assert.deepEqual(changedFiles, [
    { file: '.github/workflows/deploy.yml', added: 3 },
    { file: 'tools/a.mjs', added: 2 },
  ]);
});

test('a deleted file and a deletion-only file add no lines and are not changed files', () => {
  const addedLines = parseAddedLines(
    diff(
      'diff --git a/x.mjs b/x.mjs',
      '--- a/x.mjs',
      '+++ b/x.mjs',
      '@@ -3,2 +2,0 @@',
      '-gone',
      '-gone too',
      'diff --git a/old.mjs b/old.mjs',
      'deleted file mode 100644',
      '--- a/old.mjs',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-bye',
      'diff --git a/kept.mjs b/kept.mjs',
      '--- a/kept.mjs',
      '+++ b/kept.mjs',
      '@@ -1,0 +2,2 @@',
      '+hello',
      // Content that happens to read like a header is still content.
      '+++ b/not-a-file.mjs',
    ),
  );
  // A deleted file's `+++ /dev/null` header is not an added line of the file
  // before it.
  assert.deepEqual(addedLines.get('x.mjs') ?? [], []);
  assert.deepEqual(
    addedLines.get('kept.mjs').map((l) => l.text),
    ['hello', '++ b/not-a-file.mjs'],
  );
  // There is nothing at head to open in either, so neither is listed (#1140).
  const { changedFiles } = selectObligations({
    catalogue: { schemaVersion: 1, obligations: [] },
    addedLines,
    head: 'abc',
  });
  assert.deepEqual(changedFiles, [{ file: 'kept.mjs', added: 2 }]);
});
