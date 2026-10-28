#!/usr/bin/env node

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadGithubLabelCatalog,
  normalizeLabelArgs,
  rejectedPrLabels,
  surfaceLabelNames,
  syncSurfaceLabelChanges,
  type GithubLabelCatalog,
} from '../lib/github-labels.ts';
import {
  checkMergeBaseProof,
  isAgentDraftInvocation,
} from '../lib/pr-merge-base.ts';
import {
  FORCE_FLAG,
  PUSH_ACTIONS,
  decidePushPlan,
  findOrphanedRemoteCommits,
  parseCherryOutput,
  parseCommitRecords,
  type CommitRecord,
  type RemoteCommitRef,
} from '../lib/pr-push-plan.ts';

const usage = `Usage:
  corepack yarn ai:create-pr [options]

Options:
  --base <branch>         Base branch for the pull request. Defaults to origin/HEAD or main.
  --title <text>          Pull request title. Agent sessions pass the PrAuthor draft; falls back to commit-derived text when omitted.
  --body <text>           Pull request body text. Counts as an agent draft, so --merge-base is required with it.
  --body-file <path>      Read the pull request body from a file. Agent sessions pass the PrAuthor draft here.
  --merge-base <sha>      Merge-base SHA the draft was written from. Required whenever --title or --body-file is passed; it is the PrAuthor draft's MERGE-BASE line and must match this branch.
  --reviewer <login>      Reviewer to request. Repeat the flag or pass a comma-separated list.
  --label <name>          Surface Label (ADR 0025) or a Request Label from the triggers list in tools/config/github-labels.json to apply. Repeat the flag or pass a comma-separated list. Default: none.
  --force-with-lease      Replace a diverged remote branch after a rebase. The lease is pinned to the upstream commit this run observed, and the push is still refused if the remote carries any commit with no equivalent here.
  --draft                 Create the pull request as a draft.
  --help                  Show this help text.
`;

interface CreatePrOptions {
  base: string | null;
  body: string | null;
  bodyFile: string | null;
  draft: boolean;
  forceWithLease: boolean;
  help: boolean;
  labels: string[];
  mergeBase: string | null;
  reviewers: string[];
  title: string | null;
}

interface BranchCommit {
  subject: string;
  body: string;
}

interface SpawnedBodySource {
  bodyPath: string;
  tempDir: string;
}

interface PullRequestLabel {
  name?: string;
}

interface PullRequestReviewRequest {
  login?: string;
}

interface ExistingPullRequest {
  number: number;
  url: string;
  reviewRequests?: PullRequestReviewRequest[];
  labels?: PullRequestLabel[];
}

function fail(message: string, exitCode = 1): never {
  process.stderr.write(`${message}\n`);
  process.exit(exitCode);
}

function parseArgs(argv: string[]): CreatePrOptions {
  const options: CreatePrOptions = {
    base: null,
    body: null,
    bodyFile: null,
    draft: false,
    forceWithLease: false,
    help: false,
    labels: [],
    mergeBase: null,
    reviewers: [],
    title: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--base') {
      options.base = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === '--title') {
      options.title = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === '--body') {
      options.body = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === '--body-file') {
      options.bodyFile = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === '--merge-base') {
      options.mergeBase = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === '--reviewer') {
      options.reviewers.push(argv[index + 1] ?? '');
      index += 1;
      continue;
    }

    if (arg === '--label') {
      options.labels.push(argv[index + 1] ?? '');
      index += 1;
      continue;
    }

    if (arg === FORCE_FLAG) {
      options.forceWithLease = true;
      continue;
    }

    if (arg === '--draft') {
      options.draft = true;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return options;
}

function run(
  command: string,
  args: string[],
  options: { allowFailure?: boolean } = {},
): SpawnSyncReturns<string> {
  const { allowFailure = false } = options;
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true,
  });

  if (result.error) {
    fail(`Failed to run ${command}: ${result.error.message}`);
  }

  if (!allowFailure && result.status !== 0) {
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }

    if (result.stderr) {
      process.stderr.write(result.stderr);
    }

    process.exit(result.status ?? 1);
  }

  return result;
}

function trimStdout(
  command: string,
  args: string[],
  options: { allowFailure?: boolean } = {},
): string {
  return run(command, args, options).stdout.trim();
}

function normalizeReviewers(reviewers: readonly string[]): string[] {
  return reviewers
    .flatMap((reviewer) => reviewer.split(','))
    .map((reviewer) => reviewer.trim())
    .filter(Boolean)
    .map((reviewer) => {
      if (reviewer.startsWith('@') && !/^@(copilot|me)$/i.test(reviewer)) {
        return reviewer.slice(1);
      }

      return reviewer;
    });
}

function validateReviewers(reviewers: readonly string[]): void {
  const unsupportedReviewers = reviewers.filter((reviewer) =>
    /^@(copilot|me)$/i.test(reviewer),
  );

  if (unsupportedReviewers.length === 0) {
    return;
  }

  fail(
    'GitHub review requests do not support @copilot or @me as reviewer handles through this workflow. Use a real GitHub login for --reviewer, or keep Copilot in the IDE/web review flow instead.',
  );
}

function validateLabels(
  labels: readonly string[],
  catalog: GithubLabelCatalog,
): void {
  const rejected = rejectedPrLabels(labels, catalog);

  if (rejected.length === 0) {
    return;
  }

  fail(
    `Not Surface Labels (ADR 0025) or Request Labels: ${rejected.join(', ')}. Use kind/area/trigger names from tools/config/github-labels.json.`,
  );
}

function ensureMergeBaseProof(
  options: CreatePrOptions,
  mergeBase: string,
): void {
  const result = checkMergeBaseProof({
    computedMergeBase: mergeBase,
    isAgentDraft: isAgentDraftInvocation(options),
    suppliedMergeBase: options.mergeBase,
  });

  if (!result.ok) {
    fail(result.message);
  }
}

function ensureGhAvailable(): void {
  run('gh', ['--version']);
}

function getCurrentBranch(): string {
  const branch = trimStdout('git', ['branch', '--show-current']);

  if (!branch) {
    fail('Unable to determine the current branch.');
  }

  return branch;
}

function getDefaultBaseBranch(): string {
  const result = run('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
    allowFailure: true,
  });

  if (result.status === 0) {
    return result.stdout.trim().replace(/^refs\/remotes\/origin\//, '');
  }

  return 'main';
}

function ensureNotBaseBranch(branch: string, baseBranch: string): void {
  if (branch === baseBranch) {
    fail(
      `Refusing to create a pull request from the base branch '${baseBranch}'.`,
    );
  }
}

function ensureUpstreamBranch(
  options: CreatePrOptions,
  baseBranch: string,
): void {
  const upstreamResult = run(
    'git',
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
    { allowFailure: true },
  );
  const hasUpstream = upstreamResult.status === 0;
  // `origin/main` -> `main`. The remote name is not part of the comparison:
  // what matters is whether this branch tracks the base branch.
  const upstreamBranch = hasUpstream
    ? String(upstreamResult.stdout ?? '')
        .trim()
        .replace(/^[^/]+\//, '')
    : undefined;

  let ahead = 0;
  let behind = 0;
  let remoteSha: string | undefined;
  let unmatchedRemoteCommits: RemoteCommitRef[] = [];

  if (hasUpstream) {
    const aheadBehind = trimStdout('git', [
      'rev-list',
      '--left-right',
      '--count',
      '@{u}...HEAD',
    ]);
    const [behindCountText = '0', aheadCountText = '0'] =
      aheadBehind.split(/\s+/);
    behind = Number.parseInt(behindCountText, 10);
    ahead = Number.parseInt(aheadCountText, 10);
    remoteSha = trimStdout('git', ['rev-parse', '@{u}'], {
      allowFailure: true,
    });

    // Only work out which upstream commits are orphaned when it can matter: `git cherry`
    // diffs every commit on both sides, so it is not free on a long-lived branch.
    //
    // Patch-id is the fast path and it is not sufficient on its own. A rebase that resolved
    // a conflict rewrites the patch, so the rebased commit no longer matches the one it
    // replaced and `git cherry` reports the author's own superseded commit as unmatched.
    // Author and subject are carried through so identity can settle those cases.
    if (ahead > 0 && behind > 0) {
      const equivalent = new Set(
        parseCherryOutput(
          trimStdout('git', ['cherry', 'HEAD', '@{u}'], { allowFailure: true }),
        ).equivalent,
      );
      const format = '--format=%H%x1f%ae%x1f%s';
      const remoteOnly: RemoteCommitRef[] = parseCommitRecords(
        trimStdout('git', ['log', format, '@{u}', '^HEAD'], {
          allowFailure: true,
        }),
      ).map((commit: CommitRecord) => ({
        ...commit,
        patchEquivalent: equivalent.has(commit.sha),
      }));
      const localOnly = parseCommitRecords(
        trimStdout('git', ['log', format, 'HEAD', '^@{u}'], {
          allowFailure: true,
        }),
      );
      unmatchedRemoteCommits = findOrphanedRemoteCommits({
        remoteOnly,
        localOnly,
      });
    }
  }

  const branch = trimStdout('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const plan = decidePushPlan({
    hasUpstream,
    ahead,
    behind,
    branch,
    remoteSha,
    forceWithLease: options.forceWithLease,
    unmatchedRemoteCommits,
    upstreamBranch,
    baseBranch,
  });

  if (plan.error) {
    fail(plan.error);
  }

  if (plan.action === PUSH_ACTIONS.upToDate) {
    return;
  }

  if (plan.action === PUSH_ACTIONS.forceWithLease) {
    process.stdout.write(
      `Rewriting origin/${branch}: ${plan.reason}.
` +
        `  lease pinned to ${remoteSha}
`,
    );
  }

  run('git', plan.args ?? []);
}

function resolveBaseRef(baseBranch: string): string {
  const remoteRef = `refs/remotes/origin/${baseBranch}`;
  const remoteCheck = run('git', ['rev-parse', '--verify', remoteRef], {
    allowFailure: true,
  });

  if (remoteCheck.status === 0) {
    return `origin/${baseBranch}`;
  }

  return baseBranch;
}

function getMergeBase(baseBranch: string): string {
  // Soft-failed on purpose: a missing merge base is a case the proof gate has a
  // useful message for, and letting `run` exit here would replace it with raw git
  // stderr.
  return trimStdout('git', ['merge-base', resolveBaseRef(baseBranch), 'HEAD'], {
    allowFailure: true,
  });
}

function getBranchCommits(mergeBase: string): BranchCommit[] {
  const logOutput = trimStdout('git', [
    'log',
    '--format=%s%x1f%b%x1e',
    '--reverse',
    `${mergeBase}..HEAD`,
  ]);

  return logOutput
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [subject = '', body = ''] = record.split('\x1f');

      return {
        body: body.trim(),
        subject: subject.trim(),
      };
    })
    .filter((commit) => Boolean(commit.subject));
}

function stripConventionalPrefix(subject: string): string {
  return subject.replace(/^[a-z]+(?:\([^)]+\))?!?:\s*/i, '').trim();
}

function toSentence(text: string): string {
  if (!text) {
    return '';
  }

  const normalizedText = `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  return /[.!?]$/.test(normalizedText) ? normalizedText : `${normalizedText}.`;
}

function extractCommitBodyBullets(body: string): string[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);
}

function buildFallbackWhy(
  commits: BranchCommit[],
  branch: string,
  baseBranch: string,
): string {
  const primaryIntent = toSentence(stripConventionalPrefix(commits[0].subject));

  if (commits.length === 1) {
    return primaryIntent;
  }

  const followUpLabel =
    commits.length === 2 ? 'A follow-up commit' : 'Follow-up commits';

  return [
    primaryIntent,
    `${followUpLabel} refine the branch before merging \`${branch}\` into \`${baseBranch}\`.`,
  ].join(' ');
}

function buildFallbackTitle(commits: BranchCommit[], branch: string): string {
  const commitSubjects = commits.map((commit) => commit.subject);

  if (commitSubjects.length >= 1) {
    return commitSubjects[0];
  }

  const normalizedBranch = branch.replace(/[/_-]+/g, ' ').trim();
  return normalizedBranch ? `Update ${normalizedBranch}` : commitSubjects[0];
}

function buildFallbackBody(
  commits: BranchCommit[],
  branch: string,
  baseBranch: string,
): string {
  const detailBullets = commits.flatMap((commit) =>
    extractCommitBodyBullets(commit.body),
  );

  const changeLines =
    detailBullets.length > 0
      ? detailBullets.map((detail) => `- ${detail}`)
      : commits.map((commit) => `- ${commit.subject}`);

  return [
    '## Why',
    buildFallbackWhy(commits, branch, baseBranch),
    '',
    '## Changes',
    ...changeLines,
    '',
    '## Validation',
    `- Generated from ${commits.length} commit(s) on \`${branch}\`.`,
    `- Compared against base branch \`${baseBranch}\`.`,
  ].join('\n');
}

function readBody(
  options: CreatePrOptions,
  commits: BranchCommit[],
  branch: string,
  baseBranch: string,
): string | SpawnedBodySource {
  if (options.body && options.bodyFile) {
    fail('Provide either --body or --body-file, not both.');
  }

  if (options.bodyFile) {
    return options.bodyFile;
  }

  const bodyText =
    options.body ?? buildFallbackBody(commits, branch, baseBranch);
  const tempDir = mkdtempSync(join(tmpdir(), 'myorganiser-ai-pr-'));
  const bodyPath = join(
    tempDir,
    `${branch.replace(/[^a-zA-Z0-9_-]/g, '-')}-body.md`,
  );

  writeFileSync(bodyPath, `${bodyText.trimEnd()}\n`, 'utf8');

  return { bodyPath, tempDir };
}

function getAuthenticatedLogin(): string {
  const login = trimStdout('gh', ['api', 'user', '--jq', '.login']);

  if (!login) {
    fail('Unable to resolve the authenticated GitHub user.');
  }

  return login;
}

function findExistingPullRequest(
  branch: string,
  baseBranch: string,
): ExistingPullRequest | null {
  const response = trimStdout('gh', [
    'pr',
    'list',
    '--head',
    branch,
    '--base',
    baseBranch,
    '--state',
    'open',
    '--json',
    'number,url,reviewRequests,labels',
  ]);

  if (!response) {
    return null;
  }

  const pullRequests: ExistingPullRequest[] = JSON.parse(response);
  return pullRequests[0] ?? null;
}

function updateExistingPullRequest(
  pullRequest: ExistingPullRequest,
  assignee: string,
  reviewers: string[],
  labels: string[],
  surfaceNames: Set<string>,
  title: string,
  bodyPath: string,
): void {
  const existingReviewers = (pullRequest.reviewRequests ?? [])
    .map((reviewRequest) => reviewRequest.login)
    .filter((login): login is string => Boolean(login));
  const reviewersToAdd = reviewers.filter(
    (reviewer) => !existingReviewers.includes(reviewer),
  );
  const reviewersToRemove = existingReviewers.filter(
    (reviewer) => !reviewers.includes(reviewer),
  );
  const currentLabelNames = (pullRequest.labels ?? [])
    .map((label) => label.name)
    .filter((name): name is string => Boolean(name));
  const { toAdd: labelsToAdd, toRemove: labelsToRemove } =
    syncSurfaceLabelChanges({
      currentNames: currentLabelNames,
      desiredNames: labels,
      surfaceNames,
    });
  const editArgs = [
    'pr',
    'edit',
    String(pullRequest.number),
    '--title',
    title,
    '--body-file',
    bodyPath,
    '--add-assignee',
    assignee,
  ];

  reviewersToAdd.forEach((reviewer) => {
    editArgs.push('--add-reviewer', reviewer);
  });

  reviewersToRemove.forEach((reviewer) => {
    editArgs.push('--remove-reviewer', reviewer);
  });

  labelsToAdd.forEach((label) => {
    editArgs.push('--add-label', label);
  });

  labelsToRemove.forEach((label) => {
    editArgs.push('--remove-label', label);
  });

  run('gh', editArgs);
}

function createPullRequest(
  branch: string,
  baseBranch: string,
  assignee: string,
  reviewers: string[],
  labels: string[],
  title: string,
  bodyPath: string,
  draft: boolean,
): string {
  const args = [
    'pr',
    'create',
    '--base',
    baseBranch,
    '--head',
    branch,
    '--title',
    title,
    '--body-file',
    bodyPath,
    '--assignee',
    assignee,
  ];

  if (draft) {
    args.push('--draft');
  }

  reviewers.forEach((reviewer) => {
    args.push('--reviewer', reviewer);
  });

  labels.forEach((label) => {
    args.push('--label', label);
  });

  const result = run('gh', args);
  const urls = result.stdout.match(/https?:\/\/\S+/g) ?? [];
  const pullRequestUrl = urls.at(-1)?.trim();

  if (!pullRequestUrl) {
    fail(
      'Pull request creation succeeded, but no pull request URL was returned.',
    );
  }

  return pullRequestUrl;
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  process.stdout.write(usage);
  process.exit(0);
}

ensureGhAvailable();

const branch = getCurrentBranch();
const baseBranch = options.base ?? getDefaultBaseBranch();
const reviewers = normalizeReviewers(options.reviewers);
const catalog = loadGithubLabelCatalog();
const labels = normalizeLabelArgs(options.labels);
const surfaceNames = surfaceLabelNames(catalog);
const mergeBase = getMergeBase(baseBranch);

ensureNotBaseBranch(branch, baseBranch);
ensureMergeBaseProof(options, mergeBase);

if (!mergeBase) {
  fail(
    `Unable to resolve a merge base between '${baseBranch}' and '${branch}'. Fetch the base branch and retry.`,
  );
}

const commits = getBranchCommits(mergeBase);

validateReviewers(reviewers);
validateLabels(labels, catalog);
ensureUpstreamBranch(options, baseBranch);

if (commits.length === 0) {
  fail(`No commits found between ${baseBranch} and ${branch}.`);
}

const title = options.title ?? buildFallbackTitle(commits, branch);
const bodySource = readBody(options, commits, branch, baseBranch);

const assignee = getAuthenticatedLogin();
const existingPullRequest = findExistingPullRequest(branch, baseBranch);

if (existingPullRequest) {
  if (typeof bodySource === 'string') {
    updateExistingPullRequest(
      existingPullRequest,
      assignee,
      reviewers,
      labels,
      surfaceNames,
      title,
      bodySource,
    );
    process.stdout.write(`${existingPullRequest.url}\n`);
    process.exit(0);
  }

  try {
    updateExistingPullRequest(
      existingPullRequest,
      assignee,
      reviewers,
      labels,
      surfaceNames,
      title,
      bodySource.bodyPath,
    );
  } finally {
    rmSync(bodySource.tempDir, { force: true, recursive: true });
  }

  process.stdout.write(`${existingPullRequest.url}\n`);
  process.exit(0);
}

if (typeof bodySource === 'string') {
  const pullRequestUrl = createPullRequest(
    branch,
    baseBranch,
    assignee,
    reviewers,
    labels,
    title,
    bodySource,
    options.draft,
  );
  process.stdout.write(`${pullRequestUrl}\n`);
  process.exit(0);
}

try {
  const pullRequestUrl = createPullRequest(
    branch,
    baseBranch,
    assignee,
    reviewers,
    labels,
    title,
    bodySource.bodyPath,
    options.draft,
  );
  process.stdout.write(`${pullRequestUrl}\n`);
} finally {
  rmSync(bodySource.tempDir, { force: true, recursive: true });
}
