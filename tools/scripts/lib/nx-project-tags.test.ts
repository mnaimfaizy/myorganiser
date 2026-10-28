import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertProjectTags,
  loadTagVocabulary,
  type NxProjectTagInput,
} from './nx-project-tags.ts';

const vocab = {
  type: ['app', 'util'],
  scope: ['web', 'shared'],
  tier: ['human', 'agent', 'auto'],
};

const project = (
  tags: string[] | undefined,
  path = 'libs/x/project.json',
): NxProjectTagInput => ({
  name: 'x',
  path,
  tags,
});

test('a project with one tag per dimension passes', () => {
  assert.deepEqual(
    assertProjectTags(
      [project(['type:util', 'scope:shared', 'tier:auto'])],
      vocab,
    ),
    [],
  );
});

test('a missing dimension is named', () => {
  assert.deepEqual(assertProjectTags([project(['type:util'])], vocab), [
    'libs/x/project.json: missing a scope:* tag',
    'libs/x/project.json: missing a tier:* tag',
  ]);
});

test('empty and absent tags are both a finding per dimension', () => {
  assert.equal(assertProjectTags([project([])], vocab).length, 3);
  assert.equal(assertProjectTags([project(undefined)], vocab).length, 3);
});

test('two tags in one dimension and a value outside the vocabulary are findings', () => {
  const out = assertProjectTags(
    [project(['type:app', 'type:util', 'scope:web', 'tier:ship-it'])],
    vocab,
  );
  assert.match(out[0], /more than one type:\* tag/);
  assert.match(out[1], /"tier:ship-it" is not in the vocabulary/);
  assert.equal(out.length, 2);
});

test('a tag in an unknown dimension is a finding', () => {
  const out = assertProjectTags(
    [project(['type:app', 'scope:web', 'tier:agent', 'team:blue'])],
    vocab,
  );
  assert.deepEqual(out, [
    'libs/x/project.json: "team:blue" uses an unknown dimension (known: type, scope, tier)',
  ]);
});

test('the committed vocabulary loads with the three dimensions', () => {
  const v = loadTagVocabulary();
  assert.deepEqual(Object.keys(v), ['type', 'scope', 'tier']);
  assert.ok(v.tier.includes('human'));
});
