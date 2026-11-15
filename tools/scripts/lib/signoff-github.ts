/**
 * The `gh` and `git` half of the Sign-off Issue's reads and writes: the
 * production gate's GraphQL reads (`tools/scripts/ci/signoff-gate.ts`) and
 * the Cut's IO (`release:cut`, `release:signoff-close`). Every decision is
 * pure in `signoff-gate.ts`, `signoff-issue.ts` and `signoff-cut.ts`, and
 * their tests cover it; the calls here are untested, like the Merge Train's.
 */
import { execFileSync, spawnSync } from 'node:child_process';

import {
  isCandidate,
  type ContentEdit,
  type GateComment,
  type GateIssue,
} from './signoff-gate.ts';
import { SIGNOFF_ISSUE_LABEL } from './signoff-issue.ts';
import type { SignOffCutIo, SignOffRead } from './signoff-cut.ts';

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

/**
 * The repository's owner, and the owner's open and closed Sign-off Issue
 * candidates with their edit history and comments; `issues` is null when the
 * list could not be read whole.
 */
export function readSignOffIssues(
  owner: string,
  name: string,
): Pick<SignOffRead, 'owner' | 'issues'> {
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
  return { owner: repoOwner, issues };
}

const gh = (
  args: readonly string[],
): { status: number; stdout: string; stderr: string } => {
  const run = spawnSync('gh', args, { encoding: 'utf8' });
  return {
    status: run.status ?? 1,
    stdout: run.stdout ?? '',
    stderr: run.stderr ?? '',
  };
};

/** The `gh` login the writes run as; null when it could not be read. */
function viewerLogin(): string | null {
  const run = gh(['api', 'user', '-q', '.login']);
  return run.status === 0 && run.stdout.trim() ? run.stdout.trim() : null;
}

/** The `<owner>/<name>` of the repository `gh` is pointed at; null when unreadable. */
export function currentRepository(): string | null {
  const run = gh([
    'repo',
    'view',
    '--json',
    'nameWithOwner',
    '-q',
    '.nameWithOwner',
  ]);
  return run.status === 0 && run.stdout.trim() ? run.stdout.trim() : null;
}

/** The Cut's IO against `repository` (`<owner>/<name>`), through `gh` and `git`. */
export function ghSignOffCutIo(repository: string): SignOffCutIo {
  const [owner, name] = repository.split('/');
  const fail = (what: string, run: { stderr: string }): false => {
    console.error(`signoff: ${what}: ${run.stderr.trim()}`);
    return false;
  };
  return {
    read: () => ({ ...readSignOffIssues(owner, name), viewer: viewerLogin() }),
    readTitle: (number) => {
      const run = gh([
        'api',
        `repos/${repository}/issues/${number}`,
        '-q',
        '.title',
      ]);
      return run.status === 0 ? run.stdout.replace(/\n$/, '') : null;
    },
    isReleased: (version) => {
      try {
        const out = execFileSync(
          'git',
          ['ls-remote', '--tags', 'origin', `refs/tags/${version}`],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        );
        return out.trim() !== '';
      } catch {
        return null;
      }
    },
    // A blind replace, like the train's: GitHub has no conditional body update.
    updateIssue: (number, { title, body }) => {
      const run = gh([
        'api',
        '--method',
        'PATCH',
        `repos/${repository}/issues/${number}`,
        '-f',
        `title=${title}`,
        '-f',
        `body=${body}`,
      ]);
      return run.status === 0 || fail('Sign-off Issue edit', run);
    },
    createIssue: ({ title, body }) => {
      const run = gh([
        'issue',
        'create',
        '--repo',
        repository,
        '--title',
        title,
        '--label',
        SIGNOFF_ISSUE_LABEL,
        '--body',
        body,
      ]);
      if (run.status !== 0) {
        fail('Sign-off Issue create', run);
        return null;
      }
      const created = /\/issues\/([1-9]\d*)\s*$/.exec(run.stdout);
      return created ? Number(created[1]) : null;
    },
    comment: (number, body) => {
      const run = gh([
        'issue',
        'comment',
        String(number),
        '--repo',
        repository,
        '--body',
        body,
      ]);
      return run.status === 0 || fail('Sign-off Issue comment', run);
    },
    close: (number) => {
      const run = gh(['issue', 'close', String(number), '--repo', repository]);
      return run.status === 0 || fail('Sign-off Issue close', run);
    },
  };
}
