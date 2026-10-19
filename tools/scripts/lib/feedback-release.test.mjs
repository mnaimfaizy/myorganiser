/**
 * Contract suite for feedback-release.mjs (issue #1215, ADR 0133).
 *
 * The module is pure: it turns a release ref into a tag, picks the previous
 * release tag by numeric semver, and extracts the issue numbers that commit
 * messages close. Every expectation below is a literal value, so the suite
 * fails if the parsing rules drift rather than mirroring the implementation.
 */
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  closingIssueNumbers,
  markFeedbackRelease,
  previousReleaseTag,
  releaseTagFromRef,
} from './feedback-release.mjs';

test('releaseTagFromRef returns the tag for a release branch ref', () => {
  assert.equal(releaseTagFromRef('release/v1.4.0'), 'v1.4.0');
});

test('releaseTagFromRef also accepts a fully qualified refs/heads ref', () => {
  assert.equal(releaseTagFromRef('refs/heads/release/v1.4.0'), 'v1.4.0');
});

test('releaseTagFromRef throws an Error naming any ref that is not a release branch', () => {
  for (const ref of ['main', 'release/1.4.0', 'release/v1.4', '']) {
    assert.throws(
      () => releaseTagFromRef(ref),
      (error) =>
        error instanceof Error && (ref === '' || error.message.includes(ref)),
      `expected releaseTagFromRef(${JSON.stringify(ref)}) to throw`,
    );
  }
});

test('previousReleaseTag picks the numeric-highest tag below the release, not the lexical one', () => {
  const tags = ['v1.2.0', 'v1.9.0', 'v1.10.0', 'v1.11.0'];
  assert.equal(previousReleaseTag(tags, 'v1.10.0'), 'v1.9.0');
});

test('previousReleaseTag ignores mobile, pre-release and junk tags', () => {
  const tags = [
    'mobile-v1.3.0',
    'mobile-v1.9.5',
    'v1.9.1-rc1',
    'v1.3.0-beta',
    'junk',
    'release-notes',
    'v1.2.0',
  ];
  assert.equal(previousReleaseTag(tags, 'v1.10.0'), 'v1.2.0');
});

test('previousReleaseTag excludes the release tag itself when it already exists', () => {
  const tags = ['v1.3.0', 'v1.4.0'];
  assert.equal(previousReleaseTag(tags, 'v1.4.0'), 'v1.3.0');
});

test('previousReleaseTag returns null when no release tag is lower than the release', () => {
  const tags = ['v1.4.0', 'v2.0.0', 'mobile-v1.0.0'];
  assert.equal(previousReleaseTag(tags, 'v1.4.0'), null);
});

test('previousReleaseTag returns null for an empty tag list', () => {
  assert.equal(previousReleaseTag([], 'v1.4.0'), null);
});

test('closingIssueNumbers recognises every closing keyword family', () => {
  const keywords = [
    'close',
    'closes',
    'closed',
    'fix',
    'fixes',
    'fixed',
    'resolve',
    'resolves',
    'resolved',
  ];
  for (const keyword of keywords) {
    assert.deepEqual(
      closingIssueNumbers([`${keyword} #42`]),
      [42],
      `expected "${keyword} #42" to close #42`,
    );
  }
});

test('closingIssueNumbers accepts any letter case and an optional colon', () => {
  assert.deepEqual(closingIssueNumbers(['CLOSES #10']), [10]);
  assert.deepEqual(closingIssueNumbers(['Fixes: #11']), [11]);
  assert.deepEqual(closingIssueNumbers(['FIXES: #12']), [12]);
});

test('closingIssueNumbers counts several closing references in one message', () => {
  assert.deepEqual(closingIssueNumbers(['closes #3, closes #4']), [3, 4]);
  assert.deepEqual(
    closingIssueNumbers(['Closes #1214\n\nFixes #9']),
    [9, 1214],
  );
});

test('closingIssueNumbers dedupes across messages and sorts ascending', () => {
  const messages = ['Closes #20', 'Fixes #5\nCloses #20', 'fixed #7'];
  assert.deepEqual(closingIssueNumbers(messages), [5, 7, 20]);
});

test('closingIssueNumbers ignores non-closing references and merge-subject suffixes', () => {
  assert.deepEqual(closingIssueNumbers(['Refs #1206']), []);
  assert.deepEqual(closingIssueNumbers(['See #5']), []);
  assert.deepEqual(closingIssueNumbers(['Introduced in #1209']), []);
  assert.deepEqual(
    closingIssueNumbers(['Merge pull request #1218 from owner/feat/branch']),
    [],
  );
  assert.deepEqual(closingIssueNumbers(['feat: x (#1225)']), []);
});

test('closingIssueNumbers ignores references to other repositories', () => {
  assert.deepEqual(closingIssueNumbers(['Closes owner/repo#7']), []);
});

test('closingIssueNumbers requires a word boundary before the keyword', () => {
  assert.deepEqual(closingIssueNumbers(['prefix #8']), []);
  assert.deepEqual(closingIssueNumbers(['unfixed #9']), []);
});

test('closingIssueNumbers ignores #0 and returns an empty array for no messages', () => {
  assert.deepEqual(closingIssueNumbers(['Closes #0']), []);
  assert.deepEqual(closingIssueNumbers([]), []);
});

describe('markFeedbackRelease', () => {
  const ORIGIN = 'https://api.example.com';
  const MARK_URL = 'https://api.example.com/api/v1/feedback/releases/mark';
  const SECRET = 'mark-sec-123';
  const MARK_PATH = '/api/v1/feedback/releases/mark';

  /** Fake git that records every call; tags and messages are fixed. */
  function fakeGit({
    tags = ['v1.3.0', 'v1.4.0'],
    messages = ['Closes #12', 'Fixes #15'],
  } = {}) {
    const calls = { tags: 0, messages: [] };
    return {
      calls,
      tags: () => {
        calls.tags += 1;
        return tags;
      },
      messages: (range) => {
        calls.messages.push(range);
        return messages;
      },
    };
  }

  /** Fake fetch that records each call and answers with `respond`. */
  function fakeFetch(respond = () => okResponse({ marked: 2 })) {
    const calls = [];
    const fetch = async (url, init) => {
      calls.push({ url, init });
      return respond(url, init);
    };
    return { calls, fetch };
  }

  const okResponse = (json) => ({
    ok: true,
    status: 200,
    json: async () => json,
  });

  const errorResponse = (status) => ({
    ok: false,
    status,
    json: async () => ({ error: 'nope' }),
  });

  /** Runs markFeedbackRelease with defaults that a test can override. */
  function run(overrides = {}) {
    const git = overrides.git ?? fakeGit();
    const { calls: fetchCalls, fetch } = overrides.fetchFake ?? fakeFetch();
    const options = {
      releaseRef: 'release/v1.4.0',
      apiOrigin: ORIGIN,
      secret: SECRET,
      git,
      fetch,
      ...overrides.options,
    };
    return {
      git,
      fetchCalls,
      promise: markFeedbackRelease(options),
    };
  }

  /** Asserts git and fetch were never touched, for refusals before any effect. */
  function assertNoEffects(git, fetchCalls) {
    assert.equal(git.calls.tags, 0, 'git.tags must not be called');
    assert.deepEqual(git.calls.messages, [], 'git.messages must not be called');
    assert.equal(fetchCalls.length, 0, 'fetch must not be called');
  }

  test('rejects a bad release ref before any git or fetch call', async () => {
    const { git, fetchCalls, promise } = run({
      options: { releaseRef: 'main' },
    });
    await assert.rejects(promise, (error) => {
      assert.match(error.message, /main/);
      return true;
    });
    assertNoEffects(git, fetchCalls);
  });

  test('rejects a missing apiOrigin by name before any git or fetch call', async () => {
    const { git, fetchCalls, promise } = run({
      options: { apiOrigin: undefined },
    });
    await assert.rejects(promise, (error) => {
      assert.match(error.message, /API_ORIGIN/);
      return true;
    });
    assertNoEffects(git, fetchCalls);
  });

  test('rejects an empty secret by name before any git or fetch call', async () => {
    const { git, fetchCalls, promise } = run({
      options: { secret: '' },
    });
    await assert.rejects(promise, (error) => {
      assert.match(error.message, /FEEDBACK_RELEASE_SECRET/);
      return true;
    });
    assertNoEffects(git, fetchCalls);
  });

  test('reads commits from the previous release tag to HEAD', async () => {
    const { git, promise } = run({
      git: fakeGit({ tags: ['v1.3.0', 'v1.4.0'] }),
    });
    await promise;
    assert.deepEqual(git.calls.messages, ['v1.3.0..HEAD']);
  });

  test('reads commits from HEAD alone when there is no earlier release tag', async () => {
    const { git, promise } = run({
      git: fakeGit({ tags: ['v1.4.0'] }),
    });
    await promise;
    assert.deepEqual(git.calls.messages, ['HEAD']);
  });

  test('skips the POST and resolves with null counts when no issue is closed', async () => {
    const { fetchCalls, promise } = run({
      git: fakeGit({ messages: ['Refs #1206', 'feat: x (#1225)'] }),
    });
    const result = await promise;
    assert.deepEqual(result, {
      releaseTag: 'v1.4.0',
      issueNumbers: [],
      counts: null,
      skipped: true,
    });
    assert.equal(fetchCalls.length, 0, 'fetch must not be called');
  });

  test('skips the fetch and marks nothing when the commit range is empty', async () => {
    const { git, fetchCalls, promise } = run({
      git: fakeGit({ messages: [] }),
    });
    const result = await promise;
    assert.deepEqual(result, {
      releaseTag: 'v1.4.0',
      issueNumbers: [],
      counts: null,
      skipped: true,
    });
    assert.equal(fetchCalls.length, 0, 'fetch must not be called');
    assert.deepEqual(git.calls.messages, ['v1.3.0..HEAD']);
  });

  test('POSTs exactly once and accepts 500 distinct issues, the cap itself', async () => {
    const messages = Array.from(
      { length: 500 },
      (_, index) => `Closes #${index + 1}`,
    );
    const { fetchCalls, promise } = run({ git: fakeGit({ messages }) });
    const result = await promise;
    assert.equal(fetchCalls.length, 1, 'exactly one POST');
    const body = JSON.parse(fetchCalls[0].init.body);
    assert.equal(body.issueNumbers.length, 500);
    assert.equal(result.issueNumbers.length, 500);
    assert.equal(result.skipped, false);
  });

  test('rejects naming the 500 cap when more than 500 issues are closed', async () => {
    const messages = Array.from(
      { length: 501 },
      (_, index) => `Closes #${index + 1}`,
    );
    const { fetchCalls, promise } = run({ git: fakeGit({ messages }) });
    await assert.rejects(promise, (error) => {
      assert.match(error.message, /500/);
      return true;
    });
    assert.equal(fetchCalls.length, 0, 'fetch must not be called');
  });

  test('POSTs the release tag and issue numbers to the mark endpoint without a doubled slash', async () => {
    const { fetchCalls, promise } = run({
      options: { apiOrigin: `${ORIGIN}/` },
    });
    await promise;
    assert.equal(fetchCalls.length, 1, 'exactly one POST');
    const [{ url, init }] = fetchCalls;
    assert.equal(url, MARK_URL);
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.equal(init.headers['X-Deploy-Secret'], SECRET);
    assert.deepEqual(JSON.parse(init.body), {
      releaseTag: 'v1.4.0',
      issueNumbers: [12, 15],
    });
  });

  test('resolves with the response counts when the endpoint answers 200', async () => {
    const { promise } = run({
      fetchFake: fakeFetch(() => okResponse({ marked: 2 })),
    });
    const result = await promise;
    assert.deepEqual(result, {
      releaseTag: 'v1.4.0',
      issueNumbers: [12, 15],
      counts: { marked: 2 },
      skipped: false,
    });
  });

  test('rejects with the HTTP status on a non-ok response and never leaks the secret', async () => {
    for (const status of [400, 401, 500]) {
      const { promise } = run({
        fetchFake: fakeFetch(() => errorResponse(status)),
      });
      await assert.rejects(promise, (error) => {
        assert.match(error.message, new RegExp(String(status)));
        assert.doesNotMatch(error.message, new RegExp(SECRET));
        return true;
      });
    }
  });

  test('rejects a network failure naming the URL without the secret', async () => {
    const { promise } = run({
      fetchFake: fakeFetch(() => {
        throw new TypeError('fetch failed');
      }),
    });
    await assert.rejects(promise, (error) => {
      assert.match(error.message, new RegExp(MARK_PATH.replace(/\//g, '\\/')));
      assert.doesNotMatch(error.message, new RegExp(SECRET));
      return true;
    });
  });
});
