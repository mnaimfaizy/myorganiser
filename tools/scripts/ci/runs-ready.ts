#!/usr/bin/env node
// Waits until finished Standalone Runs' Pull Requests are ready for QA, or
// one needs a decision (#1587; ADR 0142, as amended for the continuous run).
//
//   node tools/scripts/ci/runs-ready.ts <pr>… [--poll 60] [--timeout 60] \
//     [--repository <owner/name>]
//
// Each round reads every Pull Request's head, its required checks, the
// Agent Verdict and its conversation, and decides each one: ready, pending
// (with what it waits on) or needs a decision (with why). The decision is
// pure in tools/scripts/lib/runs-ready.ts and asserted offline there; this
// is the IO half: `gh` reads, the clock and the sleep. It writes nothing.
//
// Exit 0 when every Pull Request is ready, 1 when one needs a decision or
// the time limit passed with some still pending, 2 when it could not start.
//
// A comment from outside the repository is printed by author, association
// and link only. Not a gate: it runs only by hand, in a session.
import {
  readyExitCode,
  conversationFromNodes,
  parseReadyArgs,
  renderReadyResult,
  runReady,
  type CommentNode,
  type ReadyIo,
  type ReviewNode,
  type ThreadNode,
} from '../lib/runs-ready.ts';
import {
  cannotRun,
  ghGraphql,
  githubAvailable,
  isMain,
  parseArgs,
} from '../review/cli.ts';
import {
  currentRepository,
  githubAgentVerdict,
  githubTrainIo,
  viewerLogin,
} from './merge-train.ts';

const bail = cannotRun('runs-ready');

/** One page of a GraphQL connection. */
interface Connection<T> {
  pageInfo?: { hasNextPage?: boolean | null; endCursor?: string | null };
  nodes?: T[] | null;
}

/** The fields every comment, review and thread comment is read with. */
const COMMENT_FIELDS = 'author { login } authorAssociation createdAt url body';

const connectionQuery = (field: string, nodeFields: string): string => `
  query($owner: String!, $name: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        ${field}(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { ${nodeFields} }
        }
      }
    }
  }`;

const COMMENTS = connectionQuery('comments', `${COMMENT_FIELDS} isMinimized`);
const REVIEWS = connectionQuery(
  'reviews',
  `${COMMENT_FIELDS} isMinimized state submittedAt`,
);
const THREADS = connectionQuery(
  'reviewThreads',
  `isResolved comments(first: 100) { pageInfo { hasNextPage } nodes { ${COMMENT_FIELDS} isMinimized } }`,
);

/** Every node of one connection, read to its end; null when any page failed. */
function readAll<T>(
  repository: string,
  pr: number,
  query: string,
  field: string,
): T[] | null {
  const [owner, name] = repository.split('/');
  const nodes: T[] = [];
  let after: string | null = null;
  for (;;) {
    let page: Connection<T> | undefined;
    try {
      const data = ghGraphql(query, { owner, name, number: pr, after }) as {
        data?: {
          repository?: {
            pullRequest?: Record<string, Connection<T> | undefined>;
          };
        };
      };
      page = data.data?.repository?.pullRequest?.[field];
    } catch {
      return null;
    }
    if (!page?.nodes) return null;
    nodes.push(...page.nodes);
    if (!page.pageInfo?.hasNextPage) return nodes;
    after = page.pageInfo.endCursor ?? null;
    if (!after) return null;
  }
}

/** The `gh`-backed ReadyIo: the train's own reads, plus the conversation. */
export function githubReadyIo(repository: string): ReadyIo {
  const train = githubTrainIo(repository);
  return {
    requiredChecks: train.requiredChecks,
    read: train.read,
    agentVerdict: githubAgentVerdict(repository),
    sleep: train.sleep,
    now: train.now,
    log: (line) => console.log(`runs-ready: ${line}`),
    viewerLogin,
    conversation: (pr) =>
      conversationFromNodes({
        comments: readAll<CommentNode>(repository, pr, COMMENTS, 'comments'),
        reviews: readAll<ReviewNode>(repository, pr, REVIEWS, 'reviews'),
        threads: readAll<ThreadNode>(repository, pr, THREADS, 'reviewThreads'),
      }),
  };
}

async function main(argv: readonly string[]): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  const parsed = parseReadyArgs(positional, flags);
  if ('error' in parsed) return bail(parsed.error);
  if (!githubAvailable()) return bail('`gh` is not installed or not logged in');
  const repository = flags.repository ?? currentRepository();
  if (!repository) return bail('the repository could not be resolved');

  const result = await runReady(parsed, githubReadyIo(repository));
  console.log(renderReadyResult(result));
  return readyExitCode(result);
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
