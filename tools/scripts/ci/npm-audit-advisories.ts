#!/usr/bin/env node

/**
 * Reduces `yarn npm audit --json` to the advisory fields the tracked audit
 * issue reports (ADR 0124).
 *
 * `Secure Install Review` runs this after a failed audit on a push to `main`
 * and hands the result to `Report Audit Failure` as a job output, so the job
 * that holds `issues: write` never installs or audits anything itself.
 *
 * Reads the audit output on stdin and prints one line of JSON on stdout.
 * Output it cannot read yields `[]`, which the report states as such — this
 * never exits non-zero over the audit's content.
 *
 * Usage:
 *   corepack yarn npm audit --all --recursive --severity high --json \
 *     | node tools/scripts/ci/npm-audit-advisories.ts
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';

import { parseAuditAdvisories } from '../lib/npm-audit-issue.ts';

process.stdout.write(
  `${JSON.stringify(parseAuditAdvisories(readFileSync(0, 'utf8')))}\n`,
);
