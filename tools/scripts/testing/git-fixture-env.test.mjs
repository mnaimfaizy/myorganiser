import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanGitEnv } from './git-fixture-env.mjs';

test('cleanGitEnv strips every GIT_-prefixed variable and keeps the rest', () => {
  const original = process.env.GIT_DIR;
  process.env.GIT_DIR = '/somewhere/.git';
  process.env.GIT_WORK_TREE = '/somewhere';
  process.env.GIT_INDEX_FILE = '/somewhere/.git/index';
  process.env.GIT_COMMON_DIR = '/somewhere/.git';
  process.env.GIT_AUTHOR_NAME = 'Someone Else';
  process.env.ZZZ_UNRELATED_FOR_THIS_TEST = 'kept';

  try {
    const env = cleanGitEnv();

    assert.equal(env.GIT_DIR, undefined);
    assert.equal(env.GIT_WORK_TREE, undefined);
    assert.equal(env.GIT_INDEX_FILE, undefined);
    assert.equal(env.GIT_COMMON_DIR, undefined);
    assert.equal(env.GIT_AUTHOR_NAME, undefined);
    assert.equal(env.ZZZ_UNRELATED_FOR_THIS_TEST, 'kept');
  } finally {
    delete process.env.GIT_DIR;
    delete process.env.GIT_WORK_TREE;
    delete process.env.GIT_INDEX_FILE;
    delete process.env.GIT_COMMON_DIR;
    delete process.env.GIT_AUTHOR_NAME;
    delete process.env.ZZZ_UNRELATED_FOR_THIS_TEST;
    if (original !== undefined) process.env.GIT_DIR = original;
  }
});

test('cleanGitEnv does not mutate process.env itself', () => {
  process.env.GIT_DIR = '/somewhere/.git';
  try {
    cleanGitEnv();
    assert.equal(process.env.GIT_DIR, '/somewhere/.git');
  } finally {
    delete process.env.GIT_DIR;
  }
});
