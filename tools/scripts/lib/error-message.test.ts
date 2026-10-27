// Contract Suite for lib/error-message.ts.
//
// Run: node --test tools/scripts/lib/error-message.test.ts
// Reached by `yarn tools:test`, which globs every suite under tools/scripts.
import assert from 'node:assert/strict';
import test from 'node:test';

import { errorMessage } from './error-message.ts';

test('an Error gives up its message, not its stringification', () => {
  assert.equal(
    errorMessage(new Error('ENOENT: no such file')),
    'ENOENT: no such file',
  );
});

test('a subclass of Error is still read as one', () => {
  class ReadFailure extends Error {}
  assert.equal(errorMessage(new ReadFailure('unreadable')), 'unreadable');
});

test('an Error carrying no message yields the empty string, not "undefined"', () => {
  assert.equal(errorMessage(new Error()), '');
});

test('a thrown string is the message', () => {
  assert.equal(errorMessage('plain string'), 'plain string');
});

test('a thrown non-Error object is stringified rather than read for .message', () => {
  assert.equal(errorMessage({ message: 'not an Error' }), '[object Object]');
});

test('null and undefined are named rather than swallowed', () => {
  assert.equal(errorMessage(null), 'null');
  assert.equal(errorMessage(undefined), 'undefined');
});
