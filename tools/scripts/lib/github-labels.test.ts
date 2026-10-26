/**
 * Run with: yarn ai:create-pr:test
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  GITHUB_LABEL_DESCRIPTION_MAX,
  GITHUB_LABELS_CATALOG_PATH,
  loadGithubLabelCatalog,
  normalizeLabelArgs,
  provisionLabels,
  rejectedPrLabels,
  reviewTierLabelNames,
  surfaceLabelNames,
  triggerLabelNames,
  syncSurfaceLabelChanges,
} from './github-labels.ts';
import { NEEDS_HUMAN_LABEL } from './sandcastle-outcome.mjs';

// ADR 0025 as amended by ADR 0049: `qa` moved to the Orchestration vocabulary, so it is no
// longer a Surface Label and may not appear on a Pull Request. `grilling` was added there too.
const SURFACE_LABELS = [
  'backend',
  'bug',
  'dependencies',
  'documentation',
  'enhancement',
  'github-actions',
  'maintenance',
  'mobile-app',
  'research',
  'security',
  'tooling',
  'web-app',
];

test('repo catalog surface names match ADR 0025 as amended by ADR 0049', () => {
  const catalog = loadGithubLabelCatalog();
  assert.deepEqual([...surfaceLabelNames(catalog)].sort(), SURFACE_LABELS);
  assert.equal(surfaceLabelNames(catalog).has('ready-for-agent'), false);
  assert.equal(surfaceLabelNames(catalog).has('frontend'), false);
  assert.equal(surfaceLabelNames(catalog).has('database'), false);
});

test('qa and grilling are Orchestration Labels, not Surface Labels (ADR 0049)', () => {
  const catalog = loadGithubLabelCatalog();
  const orchestration = catalog.orchestration.map((label) => label.name);

  // They must be provisioned...
  assert.equal(orchestration.includes('qa'), true);
  assert.equal(orchestration.includes('grilling'), true);

  // ...but never wearable by a Pull Request. This is what stops `qa` — which now means
  // "this issue IS a QA Plan Issue" — from being stamped on a PR, where it would be false.
  assert.equal(surfaceLabelNames(catalog).has('qa'), false);
  assert.equal(surfaceLabelNames(catalog).has('grilling'), false);
  assert.deepEqual(rejectedPrLabels(['qa', 'grilling'], catalog), [
    'qa',
    'grilling',
  ]);
});

// The orchestrator swaps ready-for-agent for this label on a held slice (ADR 0111).
// Adding a label to an issue that the repo never provisioned fails, so the name the
// orchestrator writes must be one the catalog provisions.
test('the label a held slice takes is a provisioned Orchestration Label (ADR 0111)', () => {
  const catalog = loadGithubLabelCatalog();
  assert.equal(
    catalog.orchestration.some((l) => l.name === NEEDS_HUMAN_LABEL),
    true,
  );
  const provisioned = provisionLabels(catalog).map((label) => label.name);
  assert.equal(provisioned.includes(NEEDS_HUMAN_LABEL), true);
  assert.deepEqual(rejectedPrLabels([NEEDS_HUMAN_LABEL], catalog), [
    NEEDS_HUMAN_LABEL,
  ]);
});

test('review:* is a third set: provisioned, never a Surface Label, never accepted from --label (ADR 0070)', () => {
  const catalog = loadGithubLabelCatalog();
  const review = [...reviewTierLabelNames(catalog)].sort();
  assert.deepEqual(review, ['review:agent', 'review:auto', 'review:human']);
  for (const name of review) {
    assert.equal(surfaceLabelNames(catalog).has(name), false);
    assert.equal(
      catalog.orchestration.some((l) => l.name === name),
      false,
    );
  }
  assert.deepEqual(rejectedPrLabels(review, catalog), review);
  const provisioned = provisionLabels(catalog).map((label) => label.name);
  for (const name of review) assert.equal(provisioned.includes(name), true);
});

test('agent-review and golden-replay are triggers: provisioned, not Surface Labels, accepted from --label, never a tier', () => {
  const catalog = loadGithubLabelCatalog();
  assert.deepEqual(
    [...triggerLabelNames(catalog)],
    ['agent-review', 'golden-replay'],
  );
  for (const name of ['agent-review', 'golden-replay']) {
    assert.equal(surfaceLabelNames(catalog).has(name), false);
    assert.equal(reviewTierLabelNames(catalog).has(name), false);
    assert.deepEqual(rejectedPrLabels([name, 'tooling'], catalog), []);
    assert.equal(
      provisionLabels(catalog).some((l) => l.name === name),
      true,
    );
  }
});

test('provision list includes orchestration and surface labels', () => {
  const catalog = loadGithubLabelCatalog();
  const names = provisionLabels(catalog).map((label) => label.name);
  assert.equal(names.includes('ready-for-agent'), true);
  assert.equal(names.includes('documentation'), true);
  assert.equal(names.includes('web-app'), true);
});

test('normalizeLabelArgs splits, trims, and dedupes like --reviewer', () => {
  assert.deepEqual(
    normalizeLabelArgs(['documentation, tooling', 'backend', 'documentation']),
    ['documentation', 'tooling', 'backend'],
  );
});

test('rejects orchestration and unknown names on a PR', () => {
  const catalog = loadGithubLabelCatalog();
  assert.deepEqual(
    rejectedPrLabels(['documentation', 'ready-for-agent', 'frontend'], catalog),
    ['ready-for-agent', 'frontend'],
  );
  assert.deepEqual(rejectedPrLabels(['bug', 'backend'], catalog), []);
});

test('sync adds missing Surface Labels and removes stale ones, leaving others', () => {
  const catalog = loadGithubLabelCatalog();
  const surfaceNames = surfaceLabelNames(catalog);

  assert.deepEqual(
    syncSurfaceLabelChanges({
      currentNames: ['documentation', 'needs-e2e-review', 'tooling'],
      desiredNames: ['documentation', 'backend'],
      surfaceNames,
    }),
    {
      toAdd: ['backend'],
      toRemove: ['tooling'],
    },
  );
});

test('sync to an empty draft removes Surface Labels only', () => {
  const catalog = loadGithubLabelCatalog();

  assert.deepEqual(
    syncSurfaceLabelChanges({
      currentNames: ['documentation', 'needs-e2e-review'],
      desiredNames: [],
      surfaceNames: surfaceLabelNames(catalog),
    }),
    {
      toAdd: [],
      toRemove: ['documentation'],
    },
  );
});

// GitHub refuses a label description over 100 characters with a bare HTTP
// 422, which `ai:create-labels` can only report as "Validation Failed". The
// golden-replay label first shipped at 124 and was caught only when the
// labels were provisioned; the catalog loader is the place to refuse it.
test('every label description fits GitHub’s 100-character limit', () => {
  const catalog = loadGithubLabelCatalog();
  for (const label of provisionLabels(catalog))
    assert.ok(
      label.description.length <= GITHUB_LABEL_DESCRIPTION_MAX,
      `${label.name}: description is ${label.description.length} characters`,
    );
});

test('a catalog with an over-long description is refused on load', () => {
  const dir = mkdtempSync(join(tmpdir(), 'labels-'));
  const path = join(dir, 'github-labels.json');
  const catalog = JSON.parse(readFileSync(GITHUB_LABELS_CATALOG_PATH, 'utf8'));
  catalog.triggers[0].description = 'x'.repeat(
    GITHUB_LABEL_DESCRIPTION_MAX + 1,
  );
  writeFileSync(path, JSON.stringify(catalog));
  assert.throws(() => loadGithubLabelCatalog(path), /100 characters/);
});
