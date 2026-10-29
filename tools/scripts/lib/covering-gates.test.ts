// Contract Suite for the pure half of the Covering Gate rule (ADR 0140, ADR
// 0074): a path-gated gate's triggers must cover every trigger path of each
// review obligation that names it. The defect worth catching is a gate that
// is narrower than its obligation, passed as covered — a prefix that is too
// wide, a glob that only looks like its containing directory, or a finding
// that stops after the first narrow gate so the author fixes one and rediscovers
// the rest. Unsupported glob shapes are asserted as uncovered, never passed.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertCoveringGates,
  collectCoveringGateSites,
  coversGlob,
} from './covering-gates.ts';
import type { GateTriggerConfig } from './gate-triggers.ts';

const config = (
  overrides: Partial<GateTriggerConfig> = {},
): GateTriggerConfig => ({
  schemaVersion: 1,
  sharedInputs: ['package.json'],
  suites: [
    {
      id: 'openapi:check',
      ciStep: 'Check OpenAPI spec and generated client are in sync',
      why: 'Generated API surface.',
      triggers: ['apps/backend/src/**', 'libs/app-api-client/**'],
    },
  ],
  ...overrides,
});

test('coversGlob accepts identical globs and the whole-tree glob', () => {
  assert.equal(coversGlob('libs/a/x.ts', 'libs/a/x.ts'), true);
  assert.equal(coversGlob('**', 'libs/deep/nested/file.ts'), true);
});

test('coversGlob accepts a directory prefix over a nested path and a nested prefix', () => {
  assert.equal(coversGlob('apps/**', 'apps/backend/src/main.ts'), true);
  assert.equal(coversGlob('apps/**', 'apps/backend/src/**'), true);
});

test('coversGlob rejects a single-segment glob as covering a recursive one', () => {
  assert.equal(coversGlob('dir/*', 'dir/**'), false);
});

test('coversGlob rejects a narrower prefix as covering a wider one', () => {
  assert.equal(
    coversGlob('apps/backend/src/swagger/**', 'apps/backend/src/**'),
    false,
  );
});

test('coversGlob rejects a sibling directory that only shares a string prefix', () => {
  assert.equal(coversGlob('apps/**', 'appsx/y.ts'), false);
});

test('coversGlob covers nothing for an interior ** it cannot prove', () => {
  assert.equal(coversGlob('libs/**/x.json', 'libs/a/x.json'), false);
  assert.equal(coversGlob('libs/**/x.json', 'libs/a/b/x.json'), false);
  assert.equal(coversGlob('libs/**/x.json', 'libs/**/y.json'), false);
});

test('coversGlob rejects an unrelated glob', () => {
  assert.equal(coversGlob('apps/**', 'libs/x.ts'), false);
});

test('collectCoveringGateSites picks up each path object that names a gate', () => {
  const sites = collectCoveringGateSites([
    {
      id: 'obl-a',
      trigger: {
        paths: [
          { glob: 'package.json', coveringGate: 'openapi:check' },
          { glob: 'libs/app-api-client/**', coveringGate: 'openapi:check' },
        ],
      },
    },
  ]);

  assert.deepEqual(sites, [
    {
      obligationId: 'obl-a',
      coveringGate: 'openapi:check',
      glob: 'package.json',
    },
    {
      obligationId: 'obl-a',
      coveringGate: 'openapi:check',
      glob: 'libs/app-api-client/**',
    },
  ]);
});

test('collectCoveringGateSites ignores bare-string paths and paths with no coveringGate', () => {
  const sites = collectCoveringGateSites([
    {
      id: 'obl-b',
      trigger: {
        paths: ['package.json', { glob: 'libs/x/**' }],
      },
    },
  ]);

  assert.deepEqual(sites, []);
});

test('collectCoveringGateSites yields a null-glob site for a guarded-enum gate', () => {
  const sites = collectCoveringGateSites([
    {
      id: 'obl-c',
      trigger: { guardedEnums: { coveringGate: 'enum:fanout:check' } },
    },
  ]);

  assert.deepEqual(sites, [
    { obligationId: 'obl-c', coveringGate: 'enum:fanout:check', glob: null },
  ]);
});

test('collectCoveringGateSites tolerates an obligation with no trigger or null paths', () => {
  const sites = collectCoveringGateSites([
    { id: 'no-trigger' },
    { id: 'null-paths', trigger: { paths: null } },
  ]);

  assert.deepEqual(sites, []);
});

test('assertCoveringGates passes when the gate is absent from the config', () => {
  const result = assertCoveringGates({
    sites: [
      {
        obligationId: 'obl-a',
        coveringGate: 'prisma:migrations:check',
        glob: 'apps/backend/src/prisma/migrations/**',
      },
    ],
    config: config(),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.findings, []);
});

test('assertCoveringGates passes when a suite trigger covers the obligation glob', () => {
  const result = assertCoveringGates({
    sites: [
      {
        obligationId: 'obl-a',
        coveringGate: 'openapi:check',
        glob: 'apps/backend/src/swagger/**',
      },
    ],
    config: config(),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.checked, [
    {
      gate: 'openapi:check',
      obligationId: 'obl-a',
      glob: 'apps/backend/src/swagger/**',
    },
  ]);
});

test('assertCoveringGates passes when a shared input is what covers the obligation glob', () => {
  const result = assertCoveringGates({
    sites: [
      {
        obligationId: 'obl-a',
        coveringGate: 'openapi:check',
        glob: 'package.json',
      },
    ],
    config: config(),
  });

  assert.equal(result.ok, true);
});

test('assertCoveringGates names the gate, obligation and uncovered glob when nothing covers it', () => {
  const result = assertCoveringGates({
    sites: [
      {
        obligationId: 'run-the-gate-that-covers-this-change',
        coveringGate: 'openapi:check',
        glob: 'libs/design-tokens/src/tokens.json',
      },
    ],
    config: config(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.findings.length, 1);
  const [finding] = result.findings;
  assert.match(finding, /openapi:check/);
  assert.match(finding, /run-the-gate-that-covers-this-change/);
  assert.match(finding, /libs\/design-tokens\/src\/tokens\.json/);
});

test('assertCoveringGates fails a guarded-enum site that names a path-gated gate', () => {
  const result = assertCoveringGates({
    sites: [
      { obligationId: 'enum-obl', coveringGate: 'openapi:check', glob: null },
    ],
    config: config(),
  });

  assert.equal(result.ok, false);
  assert.match(
    result.findings[0],
    /openapi:check: obligation enum-obl names it/,
  );
  assert.match(result.findings[0], /non-path trigger/);
});

test('assertCoveringGates reports every failing site in one run', () => {
  const result = assertCoveringGates({
    sites: [
      {
        obligationId: 'obl-1',
        coveringGate: 'openapi:check',
        glob: 'libs/a/**',
      },
      {
        obligationId: 'obl-2',
        coveringGate: 'openapi:check',
        glob: 'libs/b/**',
      },
      {
        obligationId: 'obl-3',
        coveringGate: 'openapi:check',
        glob: 'apps/backend/src/**',
      },
    ],
    config: config(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.findings.length, 2);
  assert.match(result.findings[0], /libs\/a\/\*\*/);
  assert.match(result.findings[1], /libs\/b\/\*\*/);
});
