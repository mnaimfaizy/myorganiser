import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { GraphUnavailableError, loadProjectGraph } from './nx-graph.ts';

function writeGraph(t: TestContext, contents: string | object): string {
  const dir = mkdtempSync(join(tmpdir(), 'nx-graph-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'graph.json');
  writeFileSync(
    file,
    typeof contents === 'string' ? contents : JSON.stringify(contents),
  );
  return file;
}

test('reads the nested { graph: { nodes } } shape nx graph emits', (t) => {
  const file = writeGraph(t, {
    graph: { nodes: { core: { name: 'core', data: { root: 'libs/core' } } } },
  });

  const { nodes } = loadProjectGraph(file);

  assert.deepEqual(Object.keys(nodes), ['core']);
  assert.equal(nodes.core.data.root, 'libs/core');
});

test('reads a bare { nodes } shape', (t) => {
  const file = writeGraph(t, {
    nodes: { core: { name: 'core', data: { root: 'libs/core' } } },
  });

  assert.deepEqual(Object.keys(loadProjectGraph(file).nodes), ['core']);
});

test('rejects a path that does not exist', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'nx-graph-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.throws(() => loadProjectGraph(join(dir, 'absent.json')), {
    name: 'GraphUnavailableError',
    message: /not found/,
  });
});

test('rejects a file that is not JSON', (t) => {
  const file = writeGraph(t, 'not json at all');

  assert.throws(() => loadProjectGraph(file), GraphUnavailableError);
});

test('rejects a JSON file that carries no project nodes', (t) => {
  const file = writeGraph(t, { unexpected: true });

  assert.throws(() => loadProjectGraph(file), {
    name: 'GraphUnavailableError',
    message: /no project nodes/,
  });
});

test('rejects an empty node set rather than reporting success over nothing', (t) => {
  const file = writeGraph(t, { graph: { nodes: {} } });

  assert.throws(() => loadProjectGraph(file), {
    message: /no project nodes/,
  });
});
