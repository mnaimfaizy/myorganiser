/**
 * Run with: yarn graphify:project-edges:test
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectGraphIntegrity,
  compareProjectEdges,
  createBenchmarkReport,
  ownerForSourceFile,
  projectEdgesFromGraphify,
  projectsFromNxGraph,
  staticProjectEdgesFromNxGraph,
} from './graphify-project-edge-benchmark.ts';

const projects = [
  { name: 'web', root: 'libs/web' },
  { name: 'account', root: 'libs/web/pages/account' },
  { name: 'vault-core', root: 'libs/vault-core' },
];

test('assigns source files to the project with the longest matching root', () => {
  assert.equal(
    ownerForSourceFile('libs/web/pages/account/src/index.ts', projects),
    'account',
  );
  assert.equal(ownerForSourceFile('libs/web/src/index.ts', projects), 'web');
  assert.equal(ownerForSourceFile('tools/scripts/check.mjs', projects), null);
});

test('projects directed import edges onto owning Nx projects', () => {
  const graph = {
    nodes: [
      {
        id: 'account_page',
        source_file: 'libs/web/pages/account/src/AccountPage.tsx',
      },
      {
        id: 'vault_type',
        source_file: 'libs/vault-core/src/lib/types.ts',
      },
      {
        id: 'account_helper',
        source_file: 'libs/web/pages/account/src/helper.ts',
      },
    ],
    links: [
      { source: 'account_page', target: 'vault_type', relation: 'imports' },
      { source: 'account_page', target: 'vault_type', relation: 'calls' },
      {
        source: 'account_page',
        target: 'account_helper',
        relation: 'imports_from',
      },
    ],
  };

  assert.deepEqual(projectEdgesFromGraphify(graph, projects), [
    ['account', 'vault-core'],
  ]);
});

test('compares Graphify edges with Nx ground truth', () => {
  const result = compareProjectEdges(
    [
      ['account', 'vault-core'],
      ['web', 'vault-core'],
    ],
    [
      ['account', 'vault-core'],
      ['account', 'web'],
    ],
  );

  assert.deepEqual(result, {
    graphifyEdges: 2,
    nxEdges: 2,
    intersection: 1,
    falsePositives: [['web', 'vault-core']],
    falseNegatives: [['account', 'web']],
    precision: 0.5,
    recall: 0.5,
    f1: 0.5,
  });
});

test('normalizes the installed Nx project graph envelope', () => {
  const nxOutput = {
    graph: {
      nodes: {
        account: { data: { root: 'libs/web/pages/account' } },
        'vault-core': { data: { root: 'libs/vault-core' } },
      },
      dependencies: {
        account: [
          { source: 'account', target: 'vault-core', type: 'static' },
          { source: 'account', target: 'tools', type: 'implicit' },
        ],
        'vault-core': [],
      },
    },
  };

  assert.deepEqual(projectsFromNxGraph(nxOutput), [
    { name: 'account', root: 'libs/web/pages/account' },
    { name: 'vault-core', root: 'libs/vault-core' },
  ]);
  assert.deepEqual(staticProjectEdgesFromNxGraph(nxOutput), [
    ['account', 'vault-core'],
  ]);
});

test('reports graph integrity and an end-to-end project edge benchmark', () => {
  const graphifyGraph = {
    directed: false,
    built_at_commit: 'abc123',
    nodes: [
      {
        id: 'account_page',
        label: 'Shared',
        source_file: 'libs/web/pages/account/src/AccountPage.tsx',
      },
      {
        id: 'vault_type',
        label: 'Shared',
        source_file: 'libs/vault-core/src/lib/types.ts',
      },
    ],
    links: [
      { source: 'account_page', target: 'vault_type', relation: 'imports' },
      { source: 'missing', target: 'vault_type', relation: 'imports' },
    ],
  };
  const nxOutput = {
    graph: {
      nodes: {
        account: { data: { root: 'libs/web/pages/account' } },
        'vault-core': { data: { root: 'libs/vault-core' } },
      },
      dependencies: {
        account: [{ source: 'account', target: 'vault-core', type: 'static' }],
        'vault-core': [],
      },
    },
  };

  assert.deepEqual(collectGraphIntegrity(graphifyGraph, 'def456'), {
    directed: false,
    builtAtCommit: 'abc123',
    currentCommit: 'def456',
    freshAtHead: false,
    nodes: 2,
    edges: 2,
    missingEndpointEdges: 1,
    ambiguousLabels: 1,
  });
  assert.deepEqual(createBenchmarkReport(graphifyGraph, nxOutput, 'abc123'), {
    integrity: {
      directed: false,
      builtAtCommit: 'abc123',
      currentCommit: 'abc123',
      freshAtHead: true,
      nodes: 2,
      edges: 2,
      missingEndpointEdges: 1,
      ambiguousLabels: 1,
    },
    projects: 2,
    metrics: {
      graphifyEdges: 1,
      nxEdges: 1,
      intersection: 1,
      falsePositives: [],
      falseNegatives: [],
      precision: 1,
      recall: 1,
      f1: 1,
    },
  });
});
