#!/usr/bin/env node
// The production gate: holds a production deploy while the Cut's Sign-off
// Issue has a `staging` Person Check that the Maintainer has neither ticked
// nor waived (ADR 0151 decisions 8 and 9).
//
//   node tools/scripts/ci/signoff-gate.ts --release-branch release/vX.Y.Z \
//     [--repository <owner/name>]
//
// Runs in `dispatch-production-deploy.yml` before the deploy is dispatched,
// so Deploy Approval is never asked for a held deploy. A waiver is a comment
// on the Sign-off Issue by the Maintainer, one line per check:
//
//   waive: <pr>:<key> — <reason>
//
// and a held run prints the exact line to paste for each open check.
//
// This is the IO half: read-only `gh api graphql` calls. Every decision is
// pure in tools/scripts/lib/signoff-gate.ts, and its tests cover it; the
// calls here are untested, like the Merge Train's.
//
// Exit 0 = allowed. Exit 1 = held, naming each open check. Exit 2 = it cannot
// decide (an unreadable or truncated read, a deleted revision, two issues
// frozen for the Cut) or a bad invocation; the deploy is held then too.
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

import {
  decideProductionGate,
  isCandidate,
  releaseVersion,
  renderGateDecision,
  type ContentEdit,
  type GateComment,
  type GateIssue,
} from '../lib/signoff-gate.ts';
import { SIGNOFF_ISSUE_LABEL } from '../lib/signoff-issue.ts';

const die = (message: string): never => {
  console.error(`signoff-gate: ${message}`);
  process.exit(2);
};

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const branch =
  flag('--release-branch') ??
  die('--release-branch release/vX.Y.Z is required');
const version =
  releaseVersion(branch) ?? die(`not a release branch: ${branch}`);
const repository =
  flag('--repository') ??
  process.env.GITHUB_REPOSITORY ??
  die('--repository <owner/name> is required outside Actions');
const [owner, name] = repository.split('/');
if (!owner || !name) die(`not <owner/name>: ${repository}`);

/** One issue as the list query reads it. */
interface IssueNode {
  number: number;
  state: 'OPEN' | 'CLOSED';
  author: { login: string } | null;
  body: string;
}

interface Page<T> {
  totalCount: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: T[];
}

/** The fields these queries read, every one optional: a missing one reads as a failed read. */
interface GraphqlData {
  repository?: {
    owner?: { __typename?: string; login?: string } | null;
    issues?: Page<IssueNode>;
    issue?: {
      userContentEdits?: Page<ContentEdit>;
      comments?: Page<GateComment>;
    } | null;
  } | null;
}

/** One GraphQL read; null when `gh` fails or GitHub reports errors. */
function graphql(
  query: string,
  variables: Record<string, string | number | null>,
): GraphqlData | null {
  const argv = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(variables))
    if (value !== null)
      argv.push(typeof value === 'number' ? '-F' : '-f', `${key}=${value}`);
  const run = spawnSync('gh', argv, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) return null;
  try {
    const json = JSON.parse(run.stdout) as {
      data?: GraphqlData;
      errors?: unknown;
    };
    return json.errors ? null : (json.data ?? null);
  } catch {
    return null;
  }
}

/** Every node of a connection, page by page; null on any failed page. */
function readAll<T>(
  query: string,
  vars: Record<string, string | number>,
  pick: (data: GraphqlData) => Page<T> | undefined,
): { totalCount: number; nodes: T[] } | null {
  const nodes: T[] = [];
  let cursor: string | null = null;
  let totalCount = 0;
  for (let page = 0; page < 100; page += 1) {
    const data = graphql(query, { ...vars, cursor });
    const connection = data ? pick(data) : undefined;
    if (!connection) return null;
    totalCount = connection.totalCount;
    nodes.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) return { totalCount, nodes };
    cursor = connection.pageInfo.endCursor;
  }
  return null;
}

const ownerData = graphql(
  'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){owner{__typename login}}}',
  { owner, name },
);
const repoOwner = ownerData?.repository?.owner ?? null;

const issueList = readAll<IssueNode>(
  `query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){
    issues(labels:["${SIGNOFF_ISSUE_LABEL}"],states:[OPEN,CLOSED],first:100,after:$cursor){
      totalCount pageInfo{hasNextPage endCursor} nodes{number state author{login} body}}}}`,
  { owner, name },
  (data) => data?.repository?.issues,
);

const ownerLogin = repoOwner?.login;
let issues: GateIssue[] | null = null;
if (
  issueList &&
  issueList.nodes.length === issueList.totalCount &&
  ownerLogin
) {
  // Filtered here only so history is read for candidates alone; the gate
  // applies the same test again, so it never depends on this.
  issues = issueList.nodes
    .filter((issue) => isCandidate(issue, ownerLogin))
    .map((issue) => ({
      ...issue,
      edits: readAll<ContentEdit>(
        `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){issue(number:$number){
          userContentEdits(first:100,after:$cursor){totalCount pageInfo{hasNextPage endCursor} nodes{editedAt deletedAt editor{login} diff}}}}}`,
        { owner, name, number: issue.number },
        (data) => data?.repository?.issue?.userContentEdits,
      ),
      comments: readAll<GateComment>(
        `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){issue(number:$number){
          comments(first:100,after:$cursor){totalCount pageInfo{hasNextPage endCursor} nodes{author{login} authorAssociation body isMinimized lastEditedAt}}}}}`,
        { owner, name, number: issue.number },
        (data) => data?.repository?.issue?.comments,
      ),
    }));
}

const decision = decideProductionGate({ owner: repoOwner, version, issues });
const lines = renderGateDecision(decision);
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      '## Production gate',
      '',
      `Release: \`${version}\``,
      '',
      ...lines,
      '',
    ].join('\n'),
  );
process.exit(
  decision.status === 'allow' ? 0 : decision.status === 'held' ? 1 : 2,
);
