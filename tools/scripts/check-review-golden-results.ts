#!/usr/bin/env node
// Asserts that the golden replay ledger's two generated sections match what
// they are generated from: the Runs section against
// docs/review/golden-replay-results.jsonl — the results record every replay
// case run appends a line to, including voids (issue #932, ADR 0101) — and
// the standing table against that record and the golden set's declared tiers
// (issue #937, ADR 0116).
//
//   node tools/scripts/check-review-golden-results.ts [--print | --write]
//
// One direction: the record and the set are the sources, and each generated
// section (between its GENERATED markers) is rendered from them and compared
// with what is committed. Nothing is asserted the other way — the ledger
// cannot contradict the record, it can only be stale — and nothing outside
// the markers is read: the historical rows and tier history above them are
// hand-written. The same shape as the other generated-page checks
// (review:pages:check, agents:map:check): generate from source, diff against
// what is committed, fail on drift.
//
// --print renders both expected sections without comparing. --write puts
// them between the markers, which is what the scheduled replay does after it
// appends to the record: a record committed without its ledger would fail
// this check on main for a drift no pull request introduced.
//
// Each section is wrapped in a prettier-ignore range. Prettier pads a
// Markdown table's columns, so without it the section this script writes and
// the section a formatted commit carries would never be the same text.
//
// Exit 0 = in sync, or written. Exit 1 = drift. Exit 2 = the check could not run.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import {
  GENERATED_END,
  GENERATED_START,
  GoldenResultError,
  parseResultsFile,
  renderRunsTable,
  seededCaseIds,
} from './review/golden-results.ts';
import {
  STANDING_END,
  STANDING_START,
  renderStandingTable,
} from './review/golden-standing.ts';
import { errorMessage } from './lib/error-message.ts';
import { GOLDEN_SET_PATH } from './review/golden-tiers.ts';

const RECORD = 'docs/review/golden-replay-results.jsonl';
const LEDGER = 'docs/review/golden-replay-results.md';
const printOnly = process.argv.includes('--print');
const write = process.argv.includes('--write');

const fail: (msg: string) => never = (msg) => {
  console.error(`review-golden-results: ${msg}`);
  process.exit(2);
};

if (!existsSync(LEDGER)) fail(`${LEDGER} not found`);

const recordText = existsSync(RECORD) ? readFileSync(RECORD, 'utf8') : '';
let records;
try {
  records = parseResultsFile(recordText);
} catch (err) {
  if (err instanceof GoldenResultError) fail(`${RECORD}: ${err.message}`);
  throw err;
}

// Read as plain JSON, not through loadGoldenSet: that reaches zod, and the
// scheduled replay's recording job installs nothing. review:golden:check is
// what validates the set.
let set;
try {
  set = JSON.parse(readFileSync(GOLDEN_SET_PATH, 'utf8'));
} catch (err) {
  fail(`cannot read ${GOLDEN_SET_PATH}: ${errorMessage(err)}`);
}

const unformatted = (body: string) =>
  `<!-- prettier-ignore-start -->\n${body}\n<!-- prettier-ignore-end -->`;

const sections = [
  {
    name: 'Runs',
    source: RECORD,
    start: GENERATED_START,
    end: GENERATED_END,
    expected: unformatted(
      renderRunsTable(records, { seeded: seededCaseIds(set) }),
    ),
  },
  {
    name: 'standing',
    source: `${RECORD} and ${GOLDEN_SET_PATH}`,
    start: STANDING_START,
    end: STANDING_END,
    expected: unformatted(renderStandingTable(set, records)),
  },
];

if (printOnly) {
  for (const s of sections) console.log(`${s.start}\n\n${s.expected}\n`);
  process.exit(0);
}

let ledger = readFileSync(LEDGER, 'utf8');
const drifted = [];
for (const s of sections) {
  const startIndex = ledger.indexOf(s.start);
  const endIndex = ledger.indexOf(s.end);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex)
    fail(
      `${LEDGER} has no ${s.start} / ${s.end} marker pair to compare against`,
    );
  const actual = ledger.slice(startIndex + s.start.length, endIndex).trim();
  if (actual === s.expected) continue;
  drifted.push({ ...s, actual });
  if (write)
    ledger = `${ledger.slice(0, startIndex + s.start.length)}\n\n${s.expected}\n\n${ledger.slice(endIndex)}`;
}

if (write) {
  if (drifted.length) writeFileSync(LEDGER, ledger);
  console.log(
    drifted.length
      ? `review-golden-results: wrote ${drifted.map((s) => s.name).join(' and ')} to ${LEDGER}`
      : `review-golden-results: ${LEDGER} already in sync, nothing written`,
  );
  process.exit(0);
}

if (drifted.length) {
  for (const s of drifted) {
    console.error(
      `review-golden-results: ${LEDGER}'s generated ${s.name} section does not match ${s.source}\n`,
    );
    console.error('--- expected (rendered from the source) ---');
    console.error(s.expected);
    console.error('--- actual (between the markers in the ledger) ---');
    console.error(s.actual);
  }
  console.error(
    `\nRegenerate with \`node tools/scripts/check-review-golden-results.ts --write\`, or fix ${RECORD}.`,
  );
  process.exit(1);
}

console.log(
  `review-golden-results: OK — ${records.length} recorded line(s), ${new Set(records.map((r) => r.run_id)).size} run(s), match the ledger's generated Runs section and standing table`,
);
