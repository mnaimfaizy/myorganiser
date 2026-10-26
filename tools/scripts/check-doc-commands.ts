#!/usr/bin/env node
// Asserts that a shell command printed in a Markdown doc names files that exist.
//
//   node tools/scripts/check-doc-commands.ts
//
// A documented command is a claim about the repository: "run this, against these files." The
// claim rots the ordinary way — a script is renamed, an input is never committed — and nothing
// notices, because prose is not executed. `docs/vault/README.md` advertised a rebuild of the
// vault pages from a `.dc.html` design export that has never existed in this repository, and the
// contradiction was found by a human following the instruction and failing (issue #534).
//
// This is an Assertion Gate in the sense of ADR 0043: it compares two artifacts — the paths a
// fenced command names, and the filesystem — and names the path that is wrong. It never asks
// whether a doc was touched.
//
// What it reads: every fenced `bash`/`sh`/`shell`/`console` block in every tracked `*.md`.
// What it asserts: a token that looks like a repo-relative path under a known top-level
// directory, or any token ending in `.dc.html`, resolves on disk.
//
// What it deliberately skips, and why:
//
//   - Placeholders. `<export-dir>`, `$BRANCH`, `*.spec.ts` are not claims about a file; they are
//     holes for the reader to fill. A checker that failed them would make every usage example
//     unwritable.
//   - Build outputs. A path git ignores is generated, so its absence in a clean tree is correct
//     rather than drift — `libs/web/ui/storybook-static` is documented and must stay documented.
//     Deferring to `.gitignore` keeps that judgement in one place instead of in an opt-out list
//     someone has to remember to prune.
//
// Exit 0 = every documented path resolves. Exit 1 = at least one does not. Exit 2 = cannot run.
import { existsSync, readFileSync } from 'node:fs';

import {
  cleanRepoPathToken,
  createCheckerFail,
  gitIgnoredPaths,
  isRepoPathToken,
  listTrackedMarkdown,
  type CheckerFail,
} from './lib/doc-paths.ts';
import { tokenize } from './lib/shell-command.ts';

const fail: CheckerFail = createCheckerFail('doc-commands');

const FENCE = /```(?:bash|sh|shell|console)\n([\s\S]*?)```/g;

// Re-exported so this module's contract tests, and any reader who comes here
// first, still find the split beside the rules that use it. The one copy lives
// in lib/ because the reviewer's allowlist gate needs the same split.
export { tokenize };

/** Strip shell and prose punctuation a path picks up in running text. */
export function clean(token: string): string {
  return cleanRepoPathToken(token);
}

/** Does this token claim to name a file in this repository? */
export function isRepoPath(token: string): boolean {
  return isRepoPathToken(token, { allowDcHtml: true });
}

const files = listTrackedMarkdown({ fail });
if (files.length === 0) fail('no tracked Markdown files found');

/** Every path claim in the corpus, before existence is considered. */
const claims = [];
for (const file of files) {
  if (!existsSync(file)) continue; // staged-deleted but still tracked
  const text = readFileSync(file, 'utf8');
  for (const block of text.matchAll(FENCE)) {
    for (const line of block[1].split('\n')) {
      if (line.trim().startsWith('#')) continue; // a shell comment, not a command
      for (const token of tokenize(line)) {
        const path = clean(token);
        if (path && isRepoPath(path)) claims.push({ file, path });
      }
    }
  }
}

const missing = claims.filter((claim) => !existsSync(claim.path));

// Only the missing ones need the ignore lookup, so a clean tree pays one subprocess at most.
const ignored = gitIgnoredPaths([...new Set(missing.map((m) => m.path))], {
  fail,
});

const findings = missing.filter((claim) => !ignored.has(claim.path));

if (findings.length > 0) {
  console.error(
    `doc-commands: ${findings.length} finding(s) — a documented command names a file that does not exist\n`,
  );
  for (const { file, path } of findings) {
    console.error(`  - ${file} → ${path}`);
  }
  console.error(
    '\nEither commit the file, or correct the doc. A command a reader cannot run is a claim' +
      '\nthis repository does not honour (ADR 0043).',
  );
  process.exit(1);
}

console.log(
  `doc-commands: OK — ${claims.length} documented paths across ${files.length} Markdown files resolve`,
);
