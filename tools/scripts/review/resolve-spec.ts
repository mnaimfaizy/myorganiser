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
// An issue's body is its report; what triage decided is a comment headed
// `## Agent Brief`, and a maintainer can amend that under `## Maintainer
// Review`. The Spec axis answers to those too, exactly as the AFK agent that
// built the change did (`lib/issue-comments.ts`), so each issue also carries
// `brief` (the latest trusted triage brief) and `notes` (trusted maintainer
// notes) when it has them, and `spec.text` names which of `body`, `brief`, and
// `notes` the primary issue's text was made of, so the published report can
// show it. Only the repository's owner, members, and
// collaborators can write either.
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
// A docs-only change on a `docs/` branch for an issue whose kind label is not
// documentation or research is that issue's design record, not its
// implementation: it resolves `none`, with `designRecordFor` and `reason`
// naming the issue (ADR 0149).
//
// Exit 0 = written (a `none` spec is a valid result). Exit 2 = could not run.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Bail } from './cli.ts';
import type { SPEC_TEXT_PARTS } from './schema.ts';
import { cannotRun, ghJson, isMain, parseArgs } from './cli.ts';
import { errorMessage } from '../lib/error-message.ts';
import type { IssueComment } from '../lib/issue-comments.ts';
import {
  extractMaintainerNotes,
  latestTriageBrief,
} from '../lib/issue-comments.ts';

/** The spec source a review was handed, as `spec.json` records it. */
export type DiscoveredSpec =
  | {
      kind: 'none';
      foundBy: 'none';
      /** Set when an issue was found and the change is its design record. */
      designRecordFor?: string;
      reason?: string;
    }
  | {
      kind: 'issue';
      ref: string;
      foundBy: 'branch' | 'commits';
      also?: string[];
      text?: (typeof SPEC_TEXT_PARTS)[number][];
    };

/** One issue as `gh issue view` returns the fields this script asks for. */
interface IssueView {
  title?: string;
  body?: string | null;
  state?: string;
  url?: string;
  comments?: IssueComment[];
  labels?: { name: string }[];
}

/** One issue's text as `spec.json` records it. */
export interface SpecText {
  title?: string;
  body: string;
  state?: string;
  brief?: string;
  notes?: string[];
}

const BRANCH_ISSUE = /^[a-z]+\/(\d+)-/;
// A commit reference is a keyword and a number, the shapes GitHub links
// to an issue. A bare `#N` is not one: `(#123)` is the squash-merge PR
// number and `item #4` is an ADR citation.
//
// A closing keyword counts anywhere on a line, because GitHub closes on one
// mid-sentence and the spec must agree with what the merge closes. A
// pointing keyword — `Refs`, `see`, `issue` — counts only where it opens the
// line, as a trailer does (`Refs #12`, or `- Refs #12` in a bullet list).
// Mid-sentence, those words are prose about an issue, not a claim that the
// change answers to it: #1362's commit described a report line as
// "e.g. `spec: issue #1273 (found by branch)`", and every review of it was
// judged against #1273, a page-title issue it never set out to meet.
const COMMIT_ISSUE = new RegExp(
  [
    /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/.source,
    /^\s*(?:[-*]\s+)?(?:refs?|see|issue)\s+#(\d+)\b/.source,
  ].join('|'),
  'i',
);
// The closing keywords alone, every one on the line. `Closes #12` says the
// change finishes #12, so the change answers to it; `Refs #12` and `see #12`
// only point at it, and a spec made of everything a commit mentions would
// ask the diff for work it never set out to do. One keyword closes one
// issue, as on GitHub: `Closes #12, #13` closes #12.
const COMMIT_CLOSES =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;

/** The one issue the order above finds first, or `none`. */
const discoverPrimary = ({
  headRef,
  commits,
}: {
  headRef?: string | null;
  commits: string[];
}): DiscoveredSpec => {
  const fromBranch = headRef?.match(BRANCH_ISSUE);
  if (fromBranch)
    return { kind: 'issue', ref: `#${fromBranch[1]}`, foundBy: 'branch' };
  for (const message of commits) {
    const hit = message.match(COMMIT_ISSUE);
    if (hit)
      return { kind: 'issue', ref: `#${hit[1] ?? hit[2]}`, foundBy: 'commits' };
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
 */
export const discoverSpec = ({
  headRef,
  commits = [],
}: {
  headRef?: string | null;
  commits?: string[];
}): DiscoveredSpec => {
  const spec = discoverPrimary({ headRef, commits });
  if (spec.kind === 'none') return spec;
  const also: string[] = [];
  for (const message of commits) {
    for (const hit of message.matchAll(COMMIT_CLOSES)) {
      const ref = `#${hit[1]}`;
      if (ref !== spec.ref && !also.includes(ref)) also.push(ref);
    }
  }
  return also.length > 0 ? { ...spec, also } : spec;
};

/**
 * The branch type each kind Surface Label maps to: AGENTS.md, Branch naming,
 * in the table's order, where the first match wins (ADR 0149). Keep it in step
 * with the kind labels in `tools/config/github-labels.json`.
 */
export const KIND_LABEL_BRANCH_TYPES = [
  ['bug', 'fix'],
  ['security', 'fix'],
  ['enhancement', 'feat'],
  ['documentation', 'docs'],
  ['tooling', 'chore'],
  ['maintenance', 'chore'],
  ['dependencies', 'chore'],
  ['research', 'docs'],
] as const;

/** A file is documentation when it sits under one of these or is one of them. */
const DOCUMENTATION_DIRECTORIES = ['docs/'] as const;
const DOCUMENTATION_FILES = ['CONTEXT.md'] as const;

const isDocumentationFile = (file: string) =>
  DOCUMENTATION_FILES.some((name) => name === file) ||
  DOCUMENTATION_DIRECTORIES.some((dir) => file.startsWith(dir));

/**
 * Pure: the kind-mismatch rule (ADR 0149). A change on a `docs/` branch that
 * touches documentation only, and whose found issue is labelled with a kind
 * whose branch type is not `docs/`, is that issue's design record, not its
 * implementation: it resolves `none`, naming the issue and why. Every other
 * input resolves as discovered. Labels that could not be read (`undefined`)
 * never produce `none`.
 */
export const applyDesignRecordRule = ({
  spec,
  headRef,
  changedFiles,
  labels,
}: {
  spec: DiscoveredSpec;
  headRef?: string | null;
  changedFiles: string[];
  labels?: string[];
}): DiscoveredSpec => {
  if (spec.kind !== 'issue' || !labels) return spec;
  if (headRef?.split('/')[0] !== 'docs') return spec;
  if (changedFiles.length === 0 || !changedFiles.every(isDocumentationFile))
    return spec;
  const kindLabel = KIND_LABEL_BRANCH_TYPES.find(([label]) =>
    labels.includes(label),
  );
  if (!kindLabel || kindLabel[1] === 'docs') return spec;
  return {
    kind: 'none',
    foundBy: 'none',
    designRecordFor: spec.ref,
    reason: `design record: a docs-only change on a docs/ branch for ${spec.ref} (kind label: ${kindLabel[0]}), so it is not that issue's implementation`,
  };
};

/**
 * Pure: what one fetched issue contributes. `gh issue view` answers for a
 * pull request number too, and a pull request's body is its author's summary
 * of the diff — not a spec source (ADR 0076 item 7).
 */
export const isPullRequest = (issue?: IssueView | null) =>
  /\/pull\/\d+$/.test(String(issue?.url ?? ''));

/** Pure: what one issue's spec text is made of, for `spec.text`. */
export const specTextParts = (
  text: SpecText,
): (typeof SPEC_TEXT_PARTS)[number][] => [
  'body',
  ...(text.brief ? (['brief'] as const) : []),
  ...(text.notes ? (['notes'] as const) : []),
];

/**
 * Pure: one fetched issue's text for `spec.json` — its body, plus the triage
 * brief and maintainer notes its trusted comments carry. A field with nothing
 * in it is left out, so an untriaged issue resolves exactly as before.
 */
export const specTextOf = (issue: IssueView): SpecText => {
  const brief = latestTriageBrief(issue.comments);
  const notes = extractMaintainerNotes(issue.comments);
  return {
    title: issue.title,
    body: issue.body ?? '',
    state: issue.state,
    ...(brief ? { brief } : {}),
    ...(notes.length > 0 ? { notes } : {}),
  };
};

export const main = (argv: string[]): void => {
  const bail: Bail = cannotRun('review-spec');
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
  const fetchIssue = (ref: string): IssueView => {
    try {
      return ghJson([
        'issue',
        'view',
        ref.slice(1),
        ...repoArgs,
        '--json',
        'title,body,state,url,comments,labels',
      ]) as IssueView;
    } catch (err) {
      return bail(`cannot fetch ${ref}: ${errorMessage(err)}`);
    }
  };
  // Only a `docs/` branch can be a design record, so only it lists the diff.
  // A diff that cannot be listed leaves the list empty, which keeps the spec.
  // `--no-renames` lists the old path of a move, so code moved into `docs/`
  // still counts as code.
  const listChangedFiles = (): string[] => {
    try {
      return execFileSync(
        'git',
        [
          'diff',
          '--name-only',
          '--no-renames',
          `${flags.base}...${flags.head}`,
        ],
        { encoding: 'utf8' },
      )
        .split('\n')
        .filter(Boolean);
    } catch {
      return [];
    }
  };
  const primaryIssue =
    found.kind === 'issue' ? fetchIssue(found.ref) : undefined;
  const resolved = applyDesignRecordRule({
    spec: found,
    headRef: flags['head-ref'],
    changedFiles:
      found.kind === 'issue' && flags['head-ref']?.startsWith('docs/')
        ? listChangedFiles()
        : [],
    labels: primaryIssue?.labels?.map((label) => label.name),
  });
  const { also: alsoRefs = [], ...primary } =
    resolved.kind === 'issue' ? resolved : { ...resolved, also: undefined };
  let result: {
    spec: DiscoveredSpec;
    also?: ({ ref: string } & SpecText)[];
  } & Partial<SpecText> = { spec: primary };
  if (primary.kind === 'issue' && primaryIssue) {
    const primaryText = specTextOf(primaryIssue);
    Object.assign(result, primaryText);
    result.spec = { ...primary, text: specTextParts(primaryText) };
    // A closing reference to a pull request is dropped, not fetched as spec:
    // the envelope names only what the Spec axis was actually handed.
    const also: ({ ref: string } & SpecText)[] = [];
    for (const ref of alsoRefs) {
      const issue = fetchIssue(ref);
      if (isPullRequest(issue)) {
        console.log(`review-spec: ${ref} is a pull request, not a spec source`);
        continue;
      }
      also.push({ ref, ...specTextOf(issue) });
    }
    if (also.length > 0) {
      result = {
        ...result,
        spec: { ...result.spec, also: also.map((issue) => issue.ref) },
        also,
      };
    }
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  const { spec } = result;
  const named: string =
    spec.kind === 'issue'
      ? `${spec.ref} (found by ${spec.foundBy})${
          spec.also ? `, also ${spec.also.join(', ')}` : ''
        }`
      : `none${spec.designRecordFor ? ` (design record for ${spec.designRecordFor})` : ''}`;
  console.log(`review-spec: ${named} → ${out}`);
};

if (isMain(import.meta.url)) main(process.argv.slice(2));
