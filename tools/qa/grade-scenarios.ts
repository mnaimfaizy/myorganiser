#!/usr/bin/env node
// Grades a QA Plan's scenarios into the five results and the QA Report
// headline (ADR 0147 decision 3).
//
//   node tools/qa/grade-scenarios.ts --input <file.json>
//   node tools/qa/grade-scenarios.ts --input -        (reads stdin)
//
// Input:  { "changeKind": "fix" | "feature",
//           "scenarios": [{ "id": "S1",
//                           "before": "pass" | "fail" | "not-run" | "cannot-run",
//                           "after":  "pass" | "fail" | "cannot-run" }] }
// Output: one JSON document on stdout — the headline, and per scenario its
// result and `maintainerDecision` (a FAIL: pre-existing is always the Maintainer's
// batched call). The grading itself is tools/qa/lib/grade-scenarios.ts.
//
// Exit 0 = graded, and the headline is not "QA failed". Exit 1 = graded, and
// the headline is "QA failed". Exit 2 = it could not grade: a missing or
// malformed input, an unknown flag, or a scenario that failed After with
// Before "not-run" (re-run it on the merge-base, then grade).
import { readFileSync } from 'node:fs';

import {
  GradingInputError,
  gradeScenarios,
  parseGradingInput,
} from './lib/grade-scenarios.ts';

const USAGE = 'usage: node tools/qa/grade-scenarios.ts --input <file.json | ->';

function fail(message: string): never {
  console.error(`qa:grade: ${message}`);
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}
const inputFlag = args.indexOf('--input');
const inputPath = inputFlag === -1 ? undefined : args[inputFlag + 1];
const extra = args.filter(
  (arg, index) => index !== inputFlag && index !== inputFlag + 1,
);
if (!inputPath || extra.length > 0) fail(USAGE);

let text: string;
try {
  text = readFileSync(inputPath === '-' ? 0 : inputPath, 'utf8');
} catch {
  fail(`cannot read input "${inputPath}"`);
}

let report;
try {
  report = gradeScenarios(parseGradingInput(JSON.parse(text)));
} catch (error) {
  if (error instanceof GradingInputError) fail(error.message);
  if (error instanceof SyntaxError) fail('input is not valid JSON');
  // Anything else is not a QA result, and an uncaught throw would exit 1,
  // which means "QA failed" here.
  fail(
    `unexpected error: ${error instanceof Error ? error.message : String(error)}`,
  );
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.headline === 'QA failed' ? 1 : 0);
