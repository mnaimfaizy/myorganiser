import assert from 'node:assert/strict';
import test from 'node:test';

import type { GhExec, GhExecOptions } from './gh.ts';
import { gh, GhJsonError, ghJson } from './gh.ts';

interface FakeExecCall {
  file: string;
  args: readonly string[];
  options: GhExecOptions;
}

/** A stand-in for execFileSync that records its call and answers `stdout`. */
function fakeExec(stdout: string): { exec: GhExec; calls: FakeExecCall[] } {
  const calls: FakeExecCall[] = [];
  const exec: GhExec = (file, args, options) => {
    calls.push({ file, args, options });
    return stdout;
  };
  return { exec, calls };
}

test('gh runs the gh binary with the given args and returns stdout as text', () => {
  const { exec, calls } = fakeExec('octocat\n');
  assert.equal(gh(['api', 'user'], { exec }), 'octocat\n');
  assert.equal(calls[0].file, 'gh');
  assert.deepEqual(calls[0].args, ['api', 'user']);
  assert.equal(calls[0].options.encoding, 'utf8');
});

test('gh passes input on stdin only when given', () => {
  const withInput = fakeExec('');
  gh(['api', 'graphql', '--input', '-'], { exec: withInput.exec, input: '{}' });
  assert.equal(withInput.calls[0].options.input, '{}');

  const without = fakeExec('');
  gh(['api', 'user'], { exec: without.exec });
  assert.equal('input' in without.calls[0].options, false);
});

test('gh raises the default output buffer and lets a caller raise it further', () => {
  const standard = fakeExec('');
  gh(['pr', 'list'], { exec: standard.exec });
  assert.ok(standard.calls[0].options.maxBuffer >= 64 * 1024 * 1024);

  const large = fakeExec('');
  gh(['pr', 'list'], { exec: large.exec, maxBuffer: 256 * 1024 * 1024 });
  assert.equal(large.calls[0].options.maxBuffer, 256 * 1024 * 1024);
});

test('gh lets a failed command throw unchanged, keeping stderr and status', () => {
  const failure = Object.assign(new Error('Command failed: gh api user'), {
    status: 4,
    stderr: 'gh: To get started with GitHub CLI, please run: gh auth login',
  });
  const exec = () => {
    throw failure;
  };
  assert.throws(
    () => gh(['api', 'user'], { exec }),
    (error) => error === failure,
  );
});

test('ghJson parses stdout, and reads empty output as null', () => {
  assert.deepEqual(ghJson(['api', 'x'], fakeExec('{"a":1}')), { a: 1 });
  assert.equal(ghJson(['api', 'x'], fakeExec('')), null);
});

test('ghJson throws GhJsonError, carrying the args and output, when stdout is not JSON', () => {
  assert.throws(
    () => ghJson(['api', 'x'], fakeExec('<html>rate limited</html>')),
    (error) =>
      error instanceof GhJsonError &&
      error.stdout === '<html>rate limited</html>' &&
      error.args.join(' ') === 'api x',
  );
});
