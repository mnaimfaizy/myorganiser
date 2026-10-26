// Covers the checklist/catalogue drift checker's parser. The comparison it
// feeds is three set operations; the parser is where a change to the
// checklist's Markdown shape would silently stop the gate from seeing
// anything, which is the failure that matters — a checker that parses
// nothing passes everything.
import assert from 'node:assert/strict';
import test from 'node:test';

import { citedFieldLabel, parseChecklist } from './check-review-checklist.ts';

const ENTRY = `## 1. Do the thing

**id** \`do-the-thing\`
**Fires when** something happens.

**Answer**

| Field   | What to write |
| ------- | ------------- |
| \`alpha\` | The alpha.    |
| \`beta\`  | The beta.     |

**Cites** \`alpha\`

**Defect** — alpha is missing.
`;

test('an entry yields its id and its answer fields in order', () => {
  const [entry] = parseChecklist(ENTRY);
  assert.equal(entry.id, 'do-the-thing');
  assert.deepEqual(entry.answerFields, ['alpha', 'beta']);
});

test('a section without an id line is prose about the list, not an entry', () => {
  const md = `## Deferred candidates

Real, incident-backed, and deliberately not in the first cohort.

- **Something held back.** With \`code\` in it.

${ENTRY}`;
  assert.deepEqual(
    parseChecklist(md).map((e) => e.id),
    ['do-the-thing'],
  );
});

test('the table header and separator are not mistaken for fields', () => {
  // They carry no backticks, which is the whole reason the row pattern
  // requires them rather than counting pipes.
  const [entry] = parseChecklist(ENTRY);
  assert.ok(!entry.answerFields.includes('Field'));
  assert.equal(entry.answerFields.length, 2);
});

test('entries come back in document order, which is what the gate compares', () => {
  const second = ENTRY.replace('do-the-thing', 'do-the-other-thing').replace(
    '## 1.',
    '## 2.',
  );
  assert.deepEqual(
    parseChecklist(`${ENTRY}\n${second}`).map((e) => e.id),
    ['do-the-thing', 'do-the-other-thing'],
  );
});

test('a backticked word in prose outside a table row is not an answer field', () => {
  // Only a line that *starts* a table row counts. An inline `field` in a
  // sentence would otherwise be read as one, and the gate would report
  // drift on an entry nobody changed.
  const md = ENTRY.replace(
    '**Defect** — alpha is missing.',
    '**Defect** — `alpha` is missing.',
  );
  assert.deepEqual(parseChecklist(md)[0].answerFields, ['alpha', 'beta']);
});

test('the Cites line names the fields whose answers must quote a line', () => {
  const [entry] = parseChecklist(ENTRY);
  assert.deepEqual(entry.citedFields, [{ field: 'alpha' }]);
});

test('a cited field may name the one value that has no line to quote', () => {
  // `wiredBy: none` says nothing invokes the gate. The catalogue spells that
  // `uncitedWhen`; the entry a human reads spells it `unless`, and the gate
  // compares the two, so the parser has to see it.
  const md = ENTRY.replace(
    '**Cites** `alpha`',
    '**Cites** `alpha` unless `none`, `beta`',
  );
  assert.deepEqual(parseChecklist(md)[0].citedFields, [
    { field: 'alpha', uncitedWhen: 'none' },
    { field: 'beta' },
  ]);
  assert.deepEqual(parseChecklist(md)[0].citedFields.map(citedFieldLabel), [
    'alpha unless none',
    'beta',
  ]);
});

test('an entry with no Cites line cites nothing, and says so', () => {
  // Not "cites everything" and not a crash: the comparison downstream is
  // between two lists, and an absent line is an empty one.
  const md = ENTRY.replace('**Cites** `alpha`\n\n', '');
  assert.deepEqual(parseChecklist(md)[0].citedFields, []);
});
