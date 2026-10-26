/**
 * Pure decision logic for how `yarn ai:create-pr` pushes the current branch.
 *
 * The runner used to do one thing: `git push origin HEAD`. That is correct for a branch
 * that only ever grows, and wrong for every branch that has been rebased — which is the
 * normal state of a PR branch after its base moves. The push is rejected as a
 * non-fast-forward, and because the runner is the ONLY sanctioned way to push (AGENTS.md
 * forbids `git push` directly), there was no path forward inside the workflow at all.
 *
 * Forcing is the answer, but a bare `--force` — or even a bare `--force-with-lease` — is
 * not. A bare lease compares against the remote-tracking ref, which any background fetch
 * can quietly refresh, and at that point the lease protects nothing. So this module always
 * pins the lease to the SHA the runner actually observed.
 *
 * The second hazard is worse and a lease cannot see it: divergence does not prove a rebase.
 * Someone else — a teammate, another machine, a `claude/` or `copilot/` agent — may have
 * pushed real commits to the same branch, and forcing would destroy them. Upstream commits
 * that nothing here accounts for therefore refuse the push regardless of the flag.
 *
 * Deciding what "accounted for" means took two passes. Patch-id alone (`git cherry`) is the
 * obvious answer and it is wrong: a rebase that resolves a conflict rewrites the patch, so
 * the rebased commit no longer matches its own predecessor. This module's first version did
 * exactly that and then refused to push its OWN pull request, because the rebase that
 * prompted it had a conflict in `.husky/pre-commit`. Patch-id is therefore the fast path,
 * and identity — same author, same subject — is the fallback that recognises a commit the
 * rebase reshaped. A teammate's genuinely different commit matches neither.
 *
 * Run the tests with: yarn ai:create-pr:test
 */

/** What the runner should do about pushing, once the branch state is known. */
export const PUSH_ACTIONS = Object.freeze({
  /** Upstream is already at this commit. */
  upToDate: 'up-to-date',
  /** No upstream yet — publish the branch and set tracking. */
  setUpstream: 'set-upstream',
  /** Upstream is a strict ancestor — an ordinary push. */
  fastForward: 'fast-forward',
  /** Histories diverged by rebase only — a lease-pinned force. */
  forceWithLease: 'force-with-lease',
} as const);

/** The flag a caller passes to opt into rewriting a diverged remote branch. */
export const FORCE_FLAG = '--force-with-lease';

export type UnmatchedRemoteCommit = string | { sha: string; subject?: string };

export interface DecidePushPlanInput {
  /** Whether `@{u}` resolves. */
  hasUpstream: boolean;
  /** Commits on HEAD that upstream lacks. */
  ahead: number | undefined;
  /** Commits on upstream that HEAD lacks. */
  behind: number | undefined;
  /** Short branch name, for the lease ref. */
  branch: string;
  /** The observed upstream commit, for the lease. */
  remoteSha?: string;
  /** Whether the caller passed the flag. */
  forceWithLease?: boolean;
  /**
   * Upstream commits this branch does not account for, as returned by
   * `findOrphanedRemoteCommits`. Non-empty means forcing would destroy work.
   */
  unmatchedRemoteCommits?: UnmatchedRemoteCommit[];
  /** Branch name on the remote that `@{u}` points at. */
  upstreamBranch?: string;
  /** The PR's base branch, normally `main`. */
  baseBranch?: string;
}

export interface PushPlan {
  action?: (typeof PUSH_ACTIONS)[keyof typeof PUSH_ACTIONS];
  args?: string[];
  reason?: string;
  error?: string;
}

/**
 * Decide how to push, or refuse with a reason.
 *
 * Every input is a plain value so the whole decision is testable without a git repo; the
 * runner is responsible for measuring them.
 */
export function decidePushPlan({
  hasUpstream,
  ahead,
  behind,
  branch,
  remoteSha,
  forceWithLease = false,
  unmatchedRemoteCommits = [],
  upstreamBranch,
  baseBranch,
}: DecidePushPlanInput): PushPlan {
  // A feature branch tracking the base branch makes every measurement below
  // meaningless: `ahead`/`behind` describe this branch against *main*, not
  // against its own remote. That reads as a rebase-shaped divergence and
  // produces either a spurious `--force-with-lease` instruction or a refusal
  // naming main's commits as work a force would destroy. Neither is true, and
  // the second is alarming enough to stop a legitimate PR.
  //
  // The push target itself is safe — `git push origin HEAD` goes to the branch
  // of the same name, never to the upstream's — so this is a measurement bug,
  // not a route to clobbering main. Sandcastle created every PRD branch this
  // way until `--no-track`; git's `branch.autoSetupMerge` does it to anyone who
  // runs `git branch <name> origin/main`.
  if (
    hasUpstream &&
    typeof upstreamBranch === 'string' &&
    typeof baseBranch === 'string' &&
    upstreamBranch === baseBranch &&
    branch !== baseBranch
  ) {
    return {
      error:
        `This branch's upstream is '${upstreamBranch}', which is the PR's base branch.\n` +
        'Every ahead/behind count would be measured against the base rather than against\n' +
        "this branch's own remote, so nothing below can be trusted.\n" +
        `Fix the tracking, then re-run:\n  git branch --unset-upstream ${branch}`,
    };
  }

  if (!hasUpstream) {
    return {
      action: PUSH_ACTIONS.setUpstream,
      args: ['push', '-u', 'origin', 'HEAD'],
      reason: 'the branch has no upstream yet',
    };
  }

  if (!Number.isInteger(ahead) || !Number.isInteger(behind)) {
    return {
      error:
        'Could not count commits against the upstream branch. Fetch and try again.',
    };
  }
  // `Number.isInteger` above is not a type guard in the DOM lib typings, so
  // narrow explicitly: both are confirmed integers at this point.
  const aheadCount: number = ahead as number;
  const behindCount: number = behind as number;

  const diverged = aheadCount > 0 && behindCount > 0;

  if (!diverged) {
    if (aheadCount > 0) {
      return {
        action: PUSH_ACTIONS.fastForward,
        args: ['push', 'origin', 'HEAD'],
        reason: `${aheadCount} commit(s) ahead of the upstream branch`,
      };
    }
    if (behindCount > 0) {
      return {
        error:
          'The local branch is behind its upstream branch. Pull or rebase before creating the PR.',
      };
    }
    return {
      action: PUSH_ACTIONS.upToDate,
      reason: 'the upstream branch already points at this commit',
    };
  }

  // Diverged from here down.
  if (unmatchedRemoteCommits.length > 0) {
    const listed = unmatchedRemoteCommits
      .map((commit) =>
        typeof commit === 'string'
          ? `  ${commit}`
          : `  ${commit.sha}${commit.subject ? `  ${commit.subject}` : ''}`,
      )
      .join('\n');
    return {
      error:
        `The upstream branch has ${unmatchedRemoteCommits.length} commit(s) with no equivalent in this branch:\n` +
        `${listed}\n` +
        'Forcing would destroy them. Integrate them first (git pull --rebase), then push.',
    };
  }

  if (!forceWithLease) {
    return {
      error:
        `The local branch and its upstream have diverged (${aheadCount} local, ${behindCount} remote), but every ` +
        'upstream commit already has an equivalent here — the signature of a rebase.\n' +
        `Re-run with ${FORCE_FLAG} to replace the remote branch with this one.`,
    };
  }

  if (typeof remoteSha !== 'string' || remoteSha.trim() === '') {
    return {
      error:
        'Refusing to force: the current upstream commit could not be resolved, so the lease ' +
        'cannot be pinned to it.',
    };
  }

  // Pin the lease to the SHA we measured, never the bare form: a bare --force-with-lease
  // trusts the remote-tracking ref, which a concurrent `git fetch` can advance behind our
  // back, and the safety disappears exactly when it is needed.
  return {
    action: PUSH_ACTIONS.forceWithLease,
    args: [
      'push',
      `${FORCE_FLAG}=${branch}:${remoteSha.trim()}`,
      'origin',
      'HEAD',
    ],
    reason: `rebased onto a new base; replacing ${behindCount} superseded remote commit(s)`,
  };
}

export interface CherryOutput {
  unmatched: string[];
  equivalent: string[];
}

/**
 * Split the output of `git cherry <head> <upstream>` into the upstream commits that have
 * no patch-equivalent locally (`+`) and those that do (`-`).
 */
export function parseCherryOutput(
  stdout: string | null | undefined,
): CherryOutput {
  const unmatched: string[] = [];
  const equivalent: string[] = [];

  for (const line of String(stdout ?? '').split('\n')) {
    const match = /^([+-])\s+([0-9a-f]{7,40})$/.exec(line.trim());
    if (!match) continue;
    (match[1] === '+' ? unmatched : equivalent).push(match[2]);
  }

  return { unmatched, equivalent };
}

/** Unit separator, matching the `%x1f` in the `git log` format the runner uses. */
export const SEPARATOR = '\u001f';

export interface CommitRecord {
  sha: string;
  author: string;
  subject: string;
}

/** Parse `git log --format=%H%x1f%ae%x1f%s` into commit records. */
export function parseCommitRecords(
  stdout: string | null | undefined,
): CommitRecord[] {
  const records: CommitRecord[] = [];

  for (const line of String(stdout ?? '').split('\n')) {
    if (line.trim() === '') continue;
    const [sha, author, ...rest] = line.split(SEPARATOR);
    if (!sha) continue;
    records.push({
      sha: sha.trim(),
      author: (author ?? '').trim(),
      subject: rest.join(SEPARATOR).trim(),
    });
  }

  return records;
}

export interface LocalCommitRef {
  sha: string;
  author?: string;
  subject?: string;
}

export interface RemoteCommitRef extends LocalCommitRef {
  patchEquivalent?: boolean;
}

const identityOf = (commit: LocalCommitRef): string =>
  `${(commit.author ?? '').toLowerCase()}\u0000${(commit.subject ?? '').trim()}`;

export interface FindOrphanedRemoteCommitsInput {
  remoteOnly?: RemoteCommitRef[];
  localOnly?: LocalCommitRef[];
}

/**
 * Upstream commits that this branch does not account for — the ones a force would destroy
 * for good.
 *
 * An upstream commit is accounted for when it either has a patch-equivalent here (the
 * clean-rebase case, already decided by `git cherry`) or shares an author and subject with
 * a local commit that has not already claimed another (the conflict-resolved-rebase case,
 * where the patch necessarily changed). Matching is one-to-one so that two upstream commits
 * cannot both be excused by a single local one.
 *
 * A commit with no subject is never matched by identity: an empty subject would pair with
 * every other empty subject and quietly excuse real work.
 */
export function findOrphanedRemoteCommits({
  remoteOnly = [],
  localOnly = [],
}: FindOrphanedRemoteCommitsInput): RemoteCommitRef[] {
  const claimable = localOnly.map((commit) => ({ commit, claimed: false }));
  const orphans: RemoteCommitRef[] = [];

  for (const remote of remoteOnly) {
    if (remote.patchEquivalent) continue;

    const subject = (remote.subject ?? '').trim();
    if (subject !== '') {
      const match = claimable.find(
        (entry) =>
          !entry.claimed && identityOf(entry.commit) === identityOf(remote),
      );
      if (match) {
        match.claimed = true;
        continue;
      }
    }

    orphans.push(remote);
  }

  return orphans;
}
