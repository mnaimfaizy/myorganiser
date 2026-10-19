#!/usr/bin/env node
// Marks the Feedback Reports a Release fixed (ADR 0133, issue #1215). The
// Production deploy runs it after Host Apply and the frontend deploy succeed:
//
//   RELEASE_REF=release/v1.4.0 API_ORIGIN=… FEEDBACK_RELEASE_SECRET=… \
//     node tools/scripts/mark-feedback-release.mjs
//
// What it reads, sends, and refuses is in lib/feedback-release.mjs. This file
// only wires it to git and fetch, from a checkout of the release branch with
// its tags (fetch-depth: 0).
//
// Exit 0 = marked, or nothing to mark. Exit 1 = refused or failed; the
// Release stays live and its reports stay Planned, so the job can be re-run.
import { execFileSync } from 'node:child_process';

import { markFeedbackRelease } from './lib/feedback-release.mjs';

const runGit = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const git = {
  tags: () => runGit(['tag', '--list']).split('\n').filter(Boolean),
  // NUL-separated so a message's own blank lines never split a commit.
  messages: (range) =>
    runGit(['log', '--format=%B%x00', range])
      .split('\0')
      .map((message) => message.trim())
      .filter(Boolean),
};

try {
  const result = await markFeedbackRelease({
    releaseRef: process.env.RELEASE_REF,
    apiOrigin: process.env.API_ORIGIN,
    secret: process.env.FEEDBACK_RELEASE_SECRET,
    git,
    fetch: globalThis.fetch,
  });
  if (result.skipped) {
    console.log(
      `feedback-release: ${result.releaseTag} closes no issues; nothing to mark.`,
    );
  } else {
    console.log(
      `feedback-release: ${result.releaseTag} closes ${result.issueNumbers.length} issue(s): ${JSON.stringify(result.counts)}`,
    );
  }
} catch (error) {
  console.error(`feedback-release: ${error?.message ?? error}`);
  process.exit(1);
}
