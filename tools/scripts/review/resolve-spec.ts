#!/usr/bin/env node
// Resolves the spec source for a CI code review (SKILL.md step 2) with the
// job token, so the reviewer never holds one (ADR 0071 item 8).
//
//   node tools/scripts/review/resolve-spec.ts --head-ref <branch> \
//     --base <sha> --head <sha> --out <spec.json> [--repo owner/name]
//
// Order is the skill's: the branch name (`<type>/<issue>-<slug>`), then an
// issue reference in a commit subject or body, otherwise `none`. The issue
// is fetched with `gh issue view` and written beside the resolved source:
//
//   { "spec": { "kind": "issue", "ref": "#123", "foundBy": "branch" },
//     "title": "...", "body": "..." }
//
// A change answers to every issue its commits close, not only the one that
// was found first (ADR 0125). Each further issue a commit closes is named in
// `spec.also` and fetched the same way:
//
//   { "spec": { "kind": "issue", "ref": "#123", "foundBy": "branch",
//               "also": ["#124"] },
//     "title": "...", "body": "...",
//     "also": [{ "ref": "#124", "title": "...", "body": "..." }] }
//
// Every body is untrusted text (ADR 0071 item 4); it is written verbatim for
// the reviewer to quote, never interpreted here.
//
// The pull request body is deliberately NOT a source here: on agent-authored
// work it is the author's own summary of the diff, so the Spec axis would be
// checking the diff against itself (ADR 0076). Branches whose names carry no
// issue number — `feat/<prd-slug>`, `claude/…`, `copilot/…` — carry it in
// their first commit instead, which the commit step below already reads.
//
// Exit 0 = written (a `none` spec is a valid result). Exit 2 = could not run.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { cannotRun, ghJson, isMain, parseArgs } from './cli.ts';

const BRANCH_ISSUE = /^[a-z]+\/(\d+)-/;
// A commit reference is a keyword and a number, the shapes GitHub links
// to an issue. A bare `#N` is not one: `(#123)` is the squash-merge PR
// number and `item #4` is an ADR citation.
const COMMIT_ISSUE =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|see|issue)\s+#(\d+)\b/i;
// The closing keywords alone, every one on the line. `Closes #12` says the
// change finishes #12, so the change answers to it; `Refs #12` and `see #12`
// only point at it, and a spec made of everything a commit mentions would
// ask the diff for work it never set out to do. One keyword closes one
// issue, as on GitHub: `Closes #12, #13` closes #12.
const COMMIT_CLOSES =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;

/** The one issue the order above finds first, or `none`. */
const discoverPrimary = ({ headRef, commits }) => {
  const fromBranch = headRef?.match(BRANCH_ISSUE);
  if (fromBranch)
    return { kind: 'issue', ref: `#${fromBranch[1]}`, foundBy: 'branch' };
  for (const message of commits) {
    const hit = message.match(COMMIT_ISSUE);
    if (hit) return { kind: 'issue', ref: `#${hit[1]}`, foundBy: 'commits' };
  }
  return { kind: 'none', foundBy: 'none' };
};

/**
 * Pure: which issue, and how it was found. Branch first, then commits, in
 * commit order (oldest first is what `git log --reverse` hands us). A commit
 * counts only when it names the issue the way GitHub does (`closes #12`,
 * `refs #12`, `fix #12`); a bare `#12` is a PR number or a citation.
 *
 * `also` names every other issue a commit closes, in commit order and once
 * each (ADR 0125). It is absent when there is none, so a change that closes
 * one issue resolves exactly as it did before. A branch with no issue at all
 * has no `also` either: the first closing reference is then the issue found.
 *
 * @param {{ headRef?: string, commits?: string[] }} input
 */
export const discoverSpec = ({ headRef, commits = [] }) => {
  const spec = discoverPrimary({ headRef, commits });
  if (spec.kind === 'none') return spec;
  const also = [];
  for (const message of commits) {
    for (const hit of message.matchAll(COMMIT_CLOSES)) {
      const ref = `#${hit[1]}`;
      if (ref !== spec.ref && !also.includes(ref)) also.push(ref);
    }
  }
  return also.length > 0 ? { ...spec, also } : spec;
};

/**
 * Pure: what one fetched issue contributes. `gh issue view` answers for a
 * pull request number too, and a pull request's body is its author's summary
 * of the diff — not a spec source (ADR 0076 item 7).
 */
export const isPullRequest = (issue) =>
  /\/pull\/\d+$/.test(String(issue?.url ?? ''));

export const main = (argv) => {
  const bail = cannotRun('review-spec');
  const { flags } = parseArgs(argv);
  const out = flags.out;
  if (!out) bail('--out <spec.json> is required');
  if (!flags.base || !flags.head) bail('--base and --head are required');

  const commits = execFileSync(
    'git',
    ['log', '--reverse', '--format=%s%n%b', `${flags.base}..${flags.head}`],
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean);

  const found = discoverSpec({ headRef: flags['head-ref'], commits });
  const repoArgs = flags.repo ? ['--repo', flags.repo] : [];
  const fetchIssue = (ref) => {
    try {
      return ghJson([
        'issue',
        'view',
        ref.slice(1),
        ...repoArgs,
        '--json',
        'title,body,state,url',
      ]);
    } catch (err) {
      return bail(`cannot fetch ${ref}: ${err.message}`);
    }
  };
  const textOf = (issue) => ({
    title: issue.title,
    body: issue.body ?? '',
    state: issue.state,
  });

  const { also: alsoRefs = [], ...primary } = found;
  let result = { spec: primary };
  if (primary.kind === 'issue') {
    Object.assign(result, textOf(fetchIssue(primary.ref)));
    // A closing reference to a pull request is dropped, not fetched as spec:
    // the envelope names only what the Spec axis was actually handed.
    const also = [];
    for (const ref of alsoRefs) {
      const issue = fetchIssue(ref);
      if (isPullRequest(issue)) {
        console.log(`review-spec: ${ref} is a pull request, not a spec source`);
        continue;
      }
      also.push({ ref, ...textOf(issue) });
    }
    if (also.length > 0) {
      result = {
        ...result,
        spec: { ...primary, also: also.map((issue) => issue.ref) },
        also,
      };
    }
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  const { spec } = result;
  const named =
    spec.kind === 'issue'
      ? `${spec.ref} (found by ${spec.foundBy})${
          spec.also ? `, also ${spec.also.join(', ')}` : ''
        }`
      : 'none';
  console.log(`review-spec: ${named} → ${out}`);
};

if (isMain(import.meta.url)) main(process.argv.slice(2));
