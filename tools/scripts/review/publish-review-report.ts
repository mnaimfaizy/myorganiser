#!/usr/bin/env node
// Posts a code review to its Pull Request (ADR 0071 item 8). This is the
// only review script that talks to GitHub, and it runs after the reviewer
// has exited: the token is in this step's environment and nowhere near the
// model.
//
//   node tools/scripts/review/publish-review-report.ts --pr <n> --repo <owner/name> \
//     --head <sha> --run-url <url> [--tier <review:label>] \
//     ( --normalized <normalized.json> --rendered <report.md> | --rejected <reason.txt> )
//     [--dry-run]
//
// What it does, all decided by publish.ts and only executed here:
//   - posts a new summary comment and marks the previous one outdated
//     (never deleted, never rewritten)
//   - posts an inline comment for each blocking finding with a location
//     whose thread is not already open
//   - resolves the threads of findings that are no longer reported
//   - relabels the Pull Request when the verdict or the effective tier says
//     it must be human
//
// Exit 0 = posted (even when the verdict is request-changes: the workflow
// reads the verdict from the normalized report and fails the check itself).
// Exit 2 = could not run or could not post.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  cannotRun,
  firstLine,
  gh,
  ghGraphql as graphql,
  ghJson,
  isMain,
  parseArgs,
  readJsonOr,
} from './cli.ts';
import type { ExistingComment, OpenThread } from './publish.ts';
import { STALE_MARKER, planPublication } from './publish.ts';
import type { NormalizedReport, ReviewTierLabel } from './schema.ts';

/** The Pull Request every query here is about. */
interface PullRequestTarget {
  owner: string;
  name: string;
  number: number;
}

/** One page of a GraphQL connection. */
interface GraphqlConnection<T> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: T[];
}

interface CommentNode {
  id: string;
  body?: string | null;
  isMinimized?: boolean;
}
interface ThreadCommentNode {
  body?: string | null;
  databaseId?: number;
}
interface ThreadNode {
  id: string;
  isResolved: boolean;
  comments: { nodes: ThreadCommentNode[] };
}
interface CommentsData {
  repository: { pullRequest: { comments: GraphqlConnection<CommentNode> } };
}
interface ThreadsData {
  repository: {
    pullRequest: { reviewThreads: GraphqlConnection<ThreadNode> };
  };
}

/**
 * An open thread, plus what the stale-reply fallback needs: the id of the
 * comment a reply goes under, and whether one is already there.
 */
interface PublisherThread extends OpenThread {
  firstCommentId?: number;
  alreadyNotified: boolean;
}

const THREADS_QUERY = `
  query($owner: String!, $name: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { id isResolved comments(first: 20) { nodes { body databaseId } } }
        }
      }
    }
  }`;
const COMMENTS_QUERY = `
  query($owner: String!, $name: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        comments(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { id body isMinimized }
        }
      }
    }
  }`;
const RESOLVE_THREAD = `
  mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { isResolved } } }`;
const MINIMIZE = `
  mutation($id: ID!) { minimizeComment(input: { subjectId: $id, classifier: OUTDATED }) { minimizedComment { isMinimized } } }`;

/** Walks one GraphQL connection on the pull request to the end. */
const paginate = <T>(
  query: string,
  pick: (data: unknown) => GraphqlConnection<T>,
  { owner, name, number }: PullRequestTarget,
): T[] => {
  const nodes: T[] = [];
  let after: string | null = null;
  for (;;) {
    const page = pick(
      (graphql(query, { owner, name, number, after }) as { data: unknown })
        .data,
    );
    nodes.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }
  return nodes;
};

const pullRequestCommentsOf = (pr: PullRequestTarget): ExistingComment[] =>
  paginate<CommentNode>(
    COMMENTS_QUERY,
    (d) => (d as CommentsData).repository.pullRequest.comments,
    pr,
  ).map((c) => ({
    nodeId: c.id,
    body: c.body ?? '',
    minimized: c.isMinimized,
  }));

const openThreadsOf = (pr: PullRequestTarget): PublisherThread[] =>
  paginate<ThreadNode>(
    THREADS_QUERY,
    (d) => (d as ThreadsData).repository.pullRequest.reviewThreads,
    pr,
  )
    .filter((t) => !t.isResolved)
    .map((t) => ({
      id: t.id,
      body: t.comments.nodes[0]?.body ?? '',
      firstCommentId: t.comments.nodes[0]?.databaseId,
      // The prefix also matches replies posted before the marker existed.
      alreadyNotified: t.comments.nodes.some(
        (c) =>
          (c.body ?? '').includes(STALE_MARKER) ||
          (c.body ?? '').startsWith('No longer reported as of'),
      ),
    }));

export const main = (argv: string[]): void => {
  const bail = cannotRun('review-publish');
  const { flags } = parseArgs(argv);
  for (const k of ['pr', 'repo', 'head', 'run-url'])
    if (!flags[k]) bail(`--${k} is required`);
  const dryRun = 'dry-run' in flags;
  // The loop above exits unless all four are present.
  const repo = flags.repo!;
  const [owner, name] = repo.split('/');
  const pr = flags.pr!;
  const headSha = flags.head!;
  const runUrl = flags['run-url']!;
  const number = Number(pr);

  let normalized: NormalizedReport | undefined;
  let rendered: string | undefined;
  let rejectedReason: string | undefined;
  if (flags.rejected) {
    rejectedReason =
      readFileSync(flags.rejected, 'utf8') || '(no reason recorded)';
  } else {
    if (!flags.normalized || !flags.rendered)
      bail(
        '--normalized and --rendered are required unless --rejected is given',
      );
    normalized = readJsonOr(flags.normalized!, bail) as NormalizedReport;
    rendered = readFileSync(flags.rendered!, 'utf8');
  }

  const prView = ghJson([
    'pr',
    'view',
    pr,
    '--repo',
    repo,
    '--json',
    'labels',
  ]) as { labels: { name: string }[] };
  const currentLabels = prView.labels.map((l) => l.name);
  const existingComments = pullRequestCommentsOf({ owner, name, number });
  const openThreads = openThreadsOf({ owner, name, number });

  const plan = planPublication({
    normalized,
    rendered,
    rejectedReason,
    tier: (flags.tier as ReviewTierLabel | null) ?? null,
    headSha,
    runUrl,
    currentLabels,
    existingComments,
    openThreads,
  });

  const say = (msg: string) =>
    console.log(`review-publish: ${dryRun ? '[dry-run] ' : ''}${msg}`);
  const act = <T>(description: string, fn: () => T): T | null => {
    if (dryRun) {
      say(`would ${description}`);
      return null;
    }
    const result = fn();
    say(description);
    return result;
  };
  // After the summary is up, nothing else may abort the run: a refused
  // thread resolution or relabel is reported and the verdict still stands.
  const warnings: string[] = [];
  const tryAct = <T>(
    description: string,
    fn: () => T,
    fallback?: () => unknown,
  ): T | null => {
    try {
      return act(description, fn);
    } catch (err) {
      const why = firstLine(err);
      warnings.push(`${description}: ${why}`);
      say(`could not ${description}: ${why}`);
      if (fallback && !dryRun) {
        try {
          fallback();
        } catch (inner) {
          say(`fallback failed too: ${firstLine(inner)}`);
        }
      }
      return null;
    }
  };

  for (const nodeId of plan.outdate)
    tryAct(`mark previous summary ${nodeId} outdated`, () =>
      graphql(MINIMIZE, { id: nodeId }),
    );

  act(`post a new summary comment (${plan.summary.length} chars)`, () =>
    ghJson(
      [
        'api',
        `repos/${repo}/issues/${pr}/comments`,
        '--method',
        'POST',
        '--input',
        '-',
      ],
      JSON.stringify({ body: plan.summary }),
    ),
  );

  if (plan.inline.length) {
    const comments = plan.inline.map((c) => ({
      path: c.path,
      line: c.line,
      side: 'RIGHT',
      ...(c.startLine ? { start_line: c.startLine, start_side: 'RIGHT' } : {}),
      body: c.body,
    }));
    const where = plan.inline.map((c) => `${c.path}:${c.line}`).join(', ');
    if (dryRun) {
      say(`would post ${comments.length} inline comment(s): ${where}`);
    } else {
      // One review with every comment; if GitHub refuses (a line outside the
      // diff), fall back to one comment at a time so the rest still land.
      try {
        gh(
          [
            'api',
            `repos/${repo}/pulls/${pr}/reviews`,
            '--method',
            'POST',
            '--input',
            '-',
          ],
          JSON.stringify({
            commit_id: headSha,
            event: 'COMMENT',
            body: '',
            comments,
          }),
        );
        say(`posted ${comments.length} inline comment(s): ${where}`);
      } catch (err) {
        say(
          `batched inline post refused (${firstLine(err)}); posting one at a time`,
        );
        let posted = 0;
        for (const c of comments) {
          try {
            gh(
              [
                'api',
                `repos/${repo}/pulls/${pr}/comments`,
                '--method',
                'POST',
                '--input',
                '-',
              ],
              JSON.stringify({ commit_id: headSha, ...c }),
            );
            posted += 1;
          } catch (inner) {
            say(`skipped ${c.path}:${c.line}: ${firstLine(inner)}`);
          }
        }
        say(`posted ${posted}/${comments.length} inline comment(s)`);
      }
    }
  }

  for (const threadId of plan.resolve) {
    const thread = openThreads.find((t) => t.id === threadId);
    tryAct(
      `resolve thread ${threadId} (finding no longer reported)`,
      () => graphql(RESOLVE_THREAD, { id: threadId }),
      // The fallback for when the mutation is refused. It was refused on
      // every run of a job holding `contents: read`; `resolveReviewThread`
      // is reported to require `contents: write` despite writing nothing,
      // so the publish job now holds it and this path should stop being
      // taken (docs/research/2026-09-07-resolve-review-thread-token.md,
      // issue #685). One reply in the thread says the same thing to a human
      // reader, and only one — a run that finds the reply already there
      // says nothing more.
      () =>
        thread?.firstCommentId &&
        !thread.alreadyNotified &&
        gh(
          [
            'api',
            `repos/${repo}/pulls/${pr}/comments/${thread.firstCommentId}/replies`,
            '--method',
            'POST',
            '--input',
            '-',
          ],
          JSON.stringify({
            body: `${STALE_MARKER}\nNo longer reported as of \`${headSha.slice(0, 7)}\`; this thread can be resolved.`,
          }),
        ),
    );
  }

  if (plan.relabel) {
    const args: string[] = ['pr', 'edit', pr, '--repo', repo];
    for (const l of plan.relabel.add) args.push('--add-label', l);
    for (const l of plan.relabel.remove) args.push('--remove-label', l);
    tryAct(`relabel: +${plan.relabel.add} -${plan.relabel.remove}`, () =>
      gh(args),
    );
  }
  if (warnings.length)
    say(
      `${warnings.length} action(s) could not be completed; the verdict stands`,
    );

  if (process.env.GITHUB_OUTPUT && !dryRun) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `outcome=${plan.outcome}\nverdict=${plan.verdict ?? ''}\nfail=${plan.failCheck}\n`,
    );
  }
  if (dryRun) {
    const p = join(tmpdir(), 'review-publish-plan.json');
    writeFileSync(p, JSON.stringify(plan, null, 2));
    say(`plan written to ${p}`);
  }
  say(
    `${plan.outcome}; verdict ${plan.verdict ?? 'none'}; check ${plan.failCheck ? 'fails' : 'passes'}`,
  );
};

if (isMain(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    cannotRun('review-publish')(firstLine(err));
  }
}
