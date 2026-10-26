/**
 * Run with: yarn agents:models:test
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseRetirementTable,
  retirementFindings,
} from './model-retirements.ts';

// Shaped like the Copilot supported-models page after `htmlToLines`: the
// supported table first, then the retirement table, then trailing prose.
const COPILOT_LINES = [
  'Model name',
  'Provider',
  'Release status',
  'GPT-5.6 Luna',
  'OpenAI',
  'GA',
  'Model retirement history',
  'The following table lists AI models that are retired or scheduled for retirement from Copilot.',
  'Model name',
  'Retirement date',
  'Suggested alternative',
  'Gemini 3.6 Flash',
  '2026-10-02',
  'Latest Gemini Flash model',
  'Kimi K2.7 Code',
  '2026-10-02',
  'Latest Kimi model',
  'Claude Sonnet 4.6',
  '5',
  '2026-09-01',
  'Latest Claude Sonnet model',
  'GPT-5.1-Codex',
  '2026-04-01',
  'Latest GPT Codex model',
  'Grok 4.6',
  '2026-12-01',
  'Latest Grok model',
  'Next steps',
  'To get up and running with Copilot, see',
  'Quickstart for using GitHub Copilot on GitHub.com',
  'and',
  'Quickstart for using GitHub Copilot in your IDE',
  '.',
  'Footnotes',
  'Not a table row',
  '2020-01-01',
];

test('reads each retirement row as a model and its date', () => {
  assert.deepEqual(parseRetirementTable(COPILOT_LINES), {
    tableFound: true,
    rows: [
      { model: 'Gemini 3.6 Flash', date: '2026-10-02' },
      { model: 'Kimi K2.7 Code', date: '2026-10-02' },
      { model: 'Claude Sonnet 4.6', date: '2026-09-01' },
      { model: 'GPT-5.1-Codex', date: '2026-04-01' },
      { model: 'Grok 4.6', date: '2026-12-01' },
    ],
  });
});

test('a row with no suggested alternative does not shift the rows after it', () => {
  const { rows } = parseRetirementTable([
    'Model name',
    'Retirement date',
    'Suggested alternative',
    'Raptor mini',
    '2026-09-01',
    'Gemini 3.6 Flash',
    '2026-10-02',
    'Latest Gemini Flash model',
  ]);
  assert.deepEqual(rows, [
    { model: 'Raptor mini', date: '2026-09-01' },
    { model: 'Gemini 3.6 Flash', date: '2026-10-02' },
  ]);
});

test('a page with no retirement table reports that it found none', () => {
  assert.deepEqual(
    parseRetirementTable(['Model name', 'Provider', 'Release status']),
    { tableFound: false, rows: [] },
  );
});

test('a table whose dates are not ISO dates is found but yields no rows', () => {
  assert.deepEqual(
    parseRetirementTable([
      'Model name',
      'Retirement date',
      'Suggested alternative',
      'Gemini 3.6 Flash',
      'October 2, 2026',
      'Latest Gemini Flash model',
    ]),
    { tableFound: true, rows: [] },
  );
});

const { rows } = parseRetirementTable(COPILOT_LINES);

test('a pinned model retired on or before the run date is reported as retired', () => {
  assert.deepEqual(
    retirementFindings({
      harness: 'copilot',
      assignedTerms: ['Gemini 3.6 Flash', 'Kimi K2.7 Code', 'GPT-5.6 Luna'],
      requiredTerms: [],
      rows,
      today: '2026-10-02',
    }),
    [
      'copilot: pinned model "Gemini 3.6 Flash" is listed as retired (retirement date 2026-10-02).',
      'copilot: pinned model "Kimi K2.7 Code" is listed as retired (retirement date 2026-10-02).',
    ],
  );
});

test('a retirement date after the run date is reported as scheduled', () => {
  assert.deepEqual(
    retirementFindings({
      harness: 'copilot',
      assignedTerms: ['Grok 4.6'],
      requiredTerms: [],
      rows,
      today: '2026-10-10',
    }),
    [
      'copilot: pinned model "Grok 4.6" is scheduled for retirement on 2026-12-01.',
    ],
  );
});

test('a required term nobody is pinned to is reported as tracked, once', () => {
  assert.deepEqual(
    retirementFindings({
      harness: 'copilot',
      assignedTerms: ['Kimi K2.7 Code'],
      requiredTerms: ['Gemini 3.6 Flash', 'Kimi K2.7 Code'],
      rows,
      today: '2026-10-10',
    }),
    [
      'copilot: pinned model "Kimi K2.7 Code" is listed as retired (retirement date 2026-10-02).',
      'copilot: tracked model "Gemini 3.6 Flash" is listed as retired (retirement date 2026-10-02).',
    ],
  );
});

test('a term matches a row only when the names are equal', () => {
  assert.deepEqual(
    retirementFindings({
      harness: 'copilot',
      assignedTerms: ['GPT-5.1', 'gemini 3.6  flash'],
      requiredTerms: [],
      rows,
      today: '2026-10-10',
    }),
    [
      'copilot: pinned model "gemini 3.6  flash" is listed as retired (retirement date 2026-10-02).',
    ],
  );
});
