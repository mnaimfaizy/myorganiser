import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import type { TestContext } from 'node:test';

import type { GateManifestEntry } from './gate-manifest.ts';
import {
  GATE_MANIFEST,
  assertManifestAgainstDisk,
  parseNodeSegments,
  runGateManifest,
} from './gate-manifest.ts';
import { createGateManifestWorkspace } from './gate-manifest-test-workspace.ts';

test('parseNodeSegments reads a single bare node invocation', () => {
  const segments = parseNodeSegments('node tools/scripts/check-readme.ts');
  assert.deepEqual(segments, [
    { script: 'tools/scripts/check-readme.ts', args: [] },
  ]);
});

test('parseNodeSegments reads a && chain and keeps arguments', () => {
  const segments = parseNodeSegments(
    'node tools/scripts/sync-subagents.ts --check && node tools/scripts/sync-agent-models.ts --check',
  );
  assert.deepEqual(segments, [
    { script: 'tools/scripts/sync-subagents.ts', args: ['--check'] },
    { script: 'tools/scripts/sync-agent-models.ts', args: ['--check'] },
  ]);
});

test('parseNodeSegments drops non-node segments', () => {
  const segments = parseNodeSegments('nx format:check');
  assert.deepEqual(segments, []);
});

function createWorkspace(t: TestContext): string {
  return createGateManifestWorkspace(t);
}

const twoEntryManifest: GateManifestEntry[] = [
  {
    id: 'a',
    npmScript: 'a:check',
    script: 'tools/scripts/check-a.ts',
    args: [],
  },
  {
    id: 'b',
    npmScript: 'b:check',
    script: 'tools/scripts/check-b.ts',
    args: ['--check'],
  },
];

test('assertManifestAgainstDisk accepts a manifest that matches package.json', (t) => {
  const workspace = createWorkspace(t);
  const pkg = {
    scripts: {
      'a:check': 'node tools/scripts/check-a.ts',
      'b:check': 'node tools/scripts/check-b.ts --check',
    },
  };

  const result = assertManifestAgainstDisk(twoEntryManifest, {
    cwd: workspace,
    pkg,
  });

  assert.deepEqual(result, { ok: true, findings: [] });
});

test('assertManifestAgainstDisk rejects a declared script missing from disk', (t) => {
  const workspace = createWorkspace(t);
  rmSync(join(workspace, 'tools/scripts/check-a.ts'));
  const pkg = {
    scripts: {
      'a:check': 'node tools/scripts/check-a.ts',
      'b:check': 'node tools/scripts/check-b.ts --check',
    },
  };

  const result = assertManifestAgainstDisk(twoEntryManifest, {
    cwd: workspace,
    pkg,
  });

  assert.equal(result.ok, false);
  assert.match(
    result.findings.join('\n'),
    /declared script .*check-a\.ts does not exist/,
  );
});

test('assertManifestAgainstDisk rejects a check-*.mjs entry even when it matches package.json', (t) => {
  const workspace = createGateManifestWorkspace(t, {
    scripts: ['tools/scripts/check-a.mjs'],
  });
  const manifest: GateManifestEntry[] = [
    {
      id: 'a',
      npmScript: 'a:check',
      script: 'tools/scripts/check-a.mjs',
      args: [],
    },
  ];

  const result = assertManifestAgainstDisk(manifest, {
    cwd: workspace,
    pkg: { scripts: { 'a:check': 'node tools/scripts/check-a.mjs' } },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.findings, [
    'a: declared script tools/scripts/check-a.mjs is not a .ts file — ' +
      'the aggregate runs only TypeScript checkers (ADR 0135)',
  ]);
});

test('assertManifestAgainstDisk rejects a manifest entry whose npm script no longer exists', (t) => {
  const workspace = createWorkspace(t);
  const pkg = {
    scripts: { 'b:check': 'node tools/scripts/check-b.ts --check' },
  };

  const result = assertManifestAgainstDisk(twoEntryManifest, {
    cwd: workspace,
    pkg,
  });

  assert.equal(result.ok, false);
  assert.match(
    result.findings.join('\n'),
    /a:check: declared in the gate manifest but package\.json has no such script/,
  );
});

test('assertManifestAgainstDisk rejects a manifest entry that drifted from its npm script', (t) => {
  const workspace = createWorkspace(t);
  const pkg = {
    scripts: {
      'a:check': 'node tools/scripts/check-a.ts --now-with-a-flag',
      'b:check': 'node tools/scripts/check-b.ts --check',
    },
  };

  const result = assertManifestAgainstDisk(twoEntryManifest, {
    cwd: workspace,
    pkg,
  });

  assert.equal(result.ok, false);
  assert.match(
    result.findings.join('\n'),
    /manifest says `a:check` runs `node tools\/scripts\/check-a\.ts`, but package\.json's script does not contain that invocation/,
  );
});

test('assertManifestAgainstDisk rejects an npm script invocation the manifest never declared', (t) => {
  const workspace = createWorkspace(t);
  writeFileSync(
    join(workspace, 'tools/scripts/check-c.ts'),
    'process.exit(0);\n',
  );
  const pkg = {
    scripts: {
      'a:check':
        'node tools/scripts/check-a.ts && node tools/scripts/check-c.ts',
      'b:check': 'node tools/scripts/check-b.ts --check',
    },
  };

  const result = assertManifestAgainstDisk(twoEntryManifest, {
    cwd: workspace,
    pkg,
  });

  assert.equal(result.ok, false);
  assert.match(
    result.findings.join('\n'),
    /a:check: package\.json runs `node tools\/scripts\/check-c\.ts`, which is not declared in the gate manifest/,
  );
});

test('runGateManifest runs every entry and never stops after a failure', () => {
  const spawned: string[] = [];
  const spawn = (entry: GateManifestEntry) => {
    spawned.push(entry.id);
    if (entry.id === 'a') return { status: 1, stdout: '', stderr: 'a failed' };
    if (entry.id === 'b')
      return { status: 2, stdout: '', stderr: 'b could not run' };
    return { status: 0, stdout: 'ok', stderr: '' };
  };

  const results = runGateManifest(
    [
      ...twoEntryManifest,
      { id: 'c', npmScript: 'c:check', script: 'x', args: [] },
    ],
    { spawn },
  );

  assert.deepEqual(spawned, ['a', 'b', 'c']);
  assert.deepEqual(
    results.map((r) => r.status),
    [1, 2, 0],
  );
  assert.equal(results[0].stderr, 'a failed');
  assert.equal(results[1].stderr, 'b could not run');
});

test('GATE_MANIFEST matches the real repository package.json', () => {
  const result = assertManifestAgainstDisk(GATE_MANIFEST);
  assert.deepEqual(result, { ok: true, findings: [] });
});
