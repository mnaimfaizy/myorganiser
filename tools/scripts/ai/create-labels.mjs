#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

import {
  loadGithubLabelCatalog,
  provisionLabels,
} from '../lib/github-labels.ts';

const REPO = 'mnaimfaizy/myorganiser';
const LABELS = provisionLabels(loadGithubLabelCatalog());

function run(args) {
  return spawnSync('gh', args, {
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true,
  });
}

function fail(message, exitCode = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(exitCode);
}

const results = { created: [], skipped: [], failed: [] };

for (const label of LABELS) {
  const result = run([
    'api',
    `repos/${REPO}/labels`,
    '--method',
    'POST',
    '--field',
    `name=${label.name}`,
    '--field',
    `color=${label.color}`,
    '--field',
    `description=${label.description}`,
  ]);

  if (result.status === 0) {
    results.created.push(label.name);
    process.stdout.write(`  created  ${label.name}\n`);
    continue;
  }

  // Only the API's own code counts. A bare 422 is a validation error — a
  // description over 100 characters, for one — and masking it as "exists"
  // is how a trigger label went unprovisioned while the run reported success.
  const isAlreadyExists =
    result.stderr.includes('already_exists') ||
    result.stdout.includes('already_exists');

  if (isAlreadyExists) {
    results.skipped.push(label.name);
    process.stdout.write(`  exists   ${label.name}\n`);
    continue;
  }

  results.failed.push(label.name);
  process.stderr.write(`  FAILED   ${label.name}\n`);
  process.stderr.write(`           ${result.stderr.trim()}\n`);
}

process.stdout.write(
  `\nDone. ${results.created.length} created, ${results.skipped.length} already existed, ${results.failed.length} failed.\n`,
);

if (results.failed.length > 0) {
  fail(`\nFailed to create labels: ${results.failed.join(', ')}`);
}
