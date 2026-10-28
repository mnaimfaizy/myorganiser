#!/usr/bin/env node
// Grades a captured Host Apply log before anything prints it (ADR 0056, PRD
// #565 user story 30: a public Actions log must never become a secret store).
//
//   node tools/scripts/scrub-host-apply-log.ts <logFile>
//
// The SSH step captures its output to a file instead of streaming, so this
// script is what decides whether that output reaches the Actions log at all.
// A clean log is printed verbatim. A log carrying a connection string or a
// bare `DATABASE_URL=` assignment is never printed — only the line numbers and
// rule ids are, which is enough to find the leaking step without repeating the
// value into the very log we are protecting.
//
// Exit 0 = log clean and printed. Exit 1 = redaction violation, log withheld.
// Exit 2 = bad invocation.
import { existsSync, readFileSync } from 'node:fs';

import { findHostApplyLogLeaks } from './lib/host-apply.ts';

const [, , logPath] = process.argv;

if (!logPath) {
  console.error('scrub-host-apply-log: expected a log file path');
  process.exit(2);
}

if (!existsSync(logPath)) {
  console.error(`scrub-host-apply-log: ${logPath} not found`);
  process.exit(2);
}

const logText = readFileSync(logPath, 'utf8');
const findings = findHostApplyLogLeaks(logText);

if (findings.length === 0) {
  process.stdout.write(logText);
  process.exit(0);
}

console.error(
  `scrub-host-apply-log: withheld - ${findings.length} redaction violation(s) in the Host Apply output:\n`,
);
for (const finding of findings) {
  console.error(`  - line ${finding.line} (${finding.rule})`);
}
console.error(
  '\nThe log was not printed. Fix the step that emitted the value, then rotate the credential it exposed.',
);
process.exit(1);
