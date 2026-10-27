#!/usr/bin/env node
// Measures the escaped-defect rate (issue #721, PRD #713): of the Pull
// Requests the reviewer passed, what fraction a later fix names as root
// cause.
//
//   node tools/scripts/review/measure-escaped-defects.ts \
//     [--days 60 | --since <YYYY-MM-DD>] [--until <YYYY-MM-DD>] \
//     [--base main] [--reviewer-since <YYYY-MM-DD>] [--no-github] \
//     [--gathered <in.json>] [--save-gather <out.json>] \
//     [--out <report.md>] [--json <report.json>]
//
// Evidence comes from two places and the report says which of them it read.
// Git supplies the merged Pull Requests, their head branches, their merge
// dates, and their commit messages; `gh` supplies Pull Request bodies, the
// bodies of the issues they close, and the reviewer's summary comments. With
// no `gh` available the measurement still runs on git alone, and everything
// it could not look up is counted as unknown rather than assumed to have
// passed — see `escaped-defects.ts` for why that distinction is the whole
// measurement.
//
// Not a gate. It reports a rate over merged history, has no fact to fail on
// for the commit in front of it, and reaches the network; it carries a
// written opt-out in tools/config/gate-coverage-optout.json.
import { execFileSync } from 'node:child_process';

import {
  cannotRun,
  dateOnly,
  ghJsonOrNull,
  git,
  githubAvailable,
  isMain,
  parseArgs,
  readJsonOr,
  shiftDays,
  writeFile,
} from './cli.ts';
import type {
  ClassifiedFix,
  EscapedDefectSummary,
  MeasurementWindow,
  ReviewOutcome,
  RootCauseRef,
} from './escaped-defects.ts';
import {
  attributeFix,
  classifyFix,
  parseReviewOutcome,
  renderMeasurement,
  summarize,
} from './escaped-defects.ts';
import type { Verdict } from './schema.ts';

const bail = cannotRun('escaped-defects');

/** A Pull Request as git records its landing on `base`. */
export interface LoggedPullRequest {
  number: number;
  sha: string;
  parents: string[];
  mergedAt: string;
  branch: string | null;
  title: string;
  message: string | null;
  type: string | null;
}

/** A fix's attribution text, per source, as the gather records it. */
interface FixSources {
  commits: string;
  body?: string | null;
  issue?: string | null;
}

/** One fix in the gather. */
interface GatheredFix {
  number: number;
  mergedAt: string;
  title: string;
  sources: FixSources;
}

/** One Pull Request's review outcome, indexed by number. */
interface OutcomeRow {
  number: number;
  mergedAt: string;
  outcome: ReviewOutcome | null;
  verdict: Verdict | null;
}

/** A Pull Request as the gather keeps it, for resolving a reference. */
interface GatheredPullRequest {
  number: number;
  sha: string;
  mergedAt: string;
  branch: string | null;
  type: string | null;
}

/** Everything the pure pipeline needs: saved once, replayable offline. */
export interface Gathered {
  window: MeasurementWindow;
  base: string;
  reviewerSince: string | null;
  evidence: Record<string, string>;
  fixes: GatheredFix[];
  outcomes: OutcomeRow[];
  pullRequests: GatheredPullRequest[];
}

// ASCII record and field separators: a commit body contains newlines and
// anything else a friendlier delimiter would collide with. git emits them
// from the `%x..` escapes, which is the only way to ask for them here —
// node refuses to spawn a process carrying a NUL byte in its argument
// list, so a format with the separator written into it never reaches git.
const RECORD = '\u001e';
const FIELD = '\u0000';
const RECORD_FORMAT = '%x1e';
const FIELD_FORMAT = '%x00';

const gitLines = (args: readonly string[]) =>
  git(args)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

const MERGE_SUBJECT = /^Merge pull request #(\d+) from [^/\s]+\/(\S+)/;
const SQUASH_SUBJECT = /\(#(\d+)\)\s*$/;
const CONVENTIONAL = /^(\w+)(?:\([^)]*\))?!?:/;

/**
 * The branch types AGENTS.md's label table can produce.
 *
 * A prefix outside this list does not name what the work does, so it loses to
 * the Conventional Commit title: `slice/`, `claude/` and `copilot/` are
 * written by agent tooling, `release/` is a release branch, and `dependabot/`
 * is somebody else's convention entirely. Reading any of them as a type is
 * how a fix written by an agent gets typed `claude` and vanishes from the
 * population — not into `unattributed`, where it would be counted, but out of
 * the measurement altogether, which is the silent drop this exists to avoid.
 */
const BRANCH_TYPES = ['fix', 'feat', 'docs', 'chore', 'ci'] as const;

/** A Pull Request's type: its branch prefix when that names one, else its title's. */
export const pullRequestType = ({
  branch,
  title,
}: {
  branch?: string | null;
  title?: string | null;
}): string | null => {
  const prefix = branch?.includes('/') ? branch.split('/')[0] : null;
  if (prefix && (BRANCH_TYPES as readonly string[]).includes(prefix))
    return prefix;
  const fromTitle = CONVENTIONAL.exec(title ?? '')?.[1] ?? null;
  return fromTitle ?? prefix ?? null;
};

/**
 * Every Pull Request in a `git log` record stream, as git records it.
 *
 * Both merge shapes this repository has are read. A merge commit carries the
 * Pull Request number and the head branch, which is where a `fix/` branch
 * announces itself; a squash merge carries the number in its subject and no
 * branch at all, so its type comes from the Conventional Commit title.
 *
 * Split from the git call so the parsing — which is where every shape
 * question lives — is testable without a repository.
 */
export const parsePullRequestLog = (raw: unknown): LoggedPullRequest[] => {
  const prs: LoggedPullRequest[] = [];
  for (const entry of String(raw).split(RECORD)) {
    const text = entry.replace(/^\n/, '');
    if (!text.trim()) continue;
    const [sha, parents, mergedAt, subject, body = ''] = text.split(FIELD);
    const merge = MERGE_SUBJECT.exec(subject);
    const squash = merge ? null : SQUASH_SUBJECT.exec(subject);
    const matched = merge ?? squash;
    if (!matched) continue;
    const number = Number(matched[1]);
    const branch = merge ? merge[2] : null;
    // A merge commit's body is the Pull Request title; a squash's title is
    // its own subject.
    const title = merge ? body.split('\n')[0].trim() : subject;
    prs.push({
      number,
      sha,
      parents: parents.split(' ').filter(Boolean),
      mergedAt,
      branch,
      title,
      // A squash folds the branch's commit messages into its own body, so it
      // is the only place a squashed fix's attribution line survives. A merge
      // commit's body is the title, and its commits are read from the range.
      message: merge ? null : `${subject}\n${body}`,
      type: pullRequestType({ branch, title }),
    });
  }
  return prs;
};

/** Every Pull Request that reached `base`. */
export const listPullRequests = ({
  base,
  since,
  until,
}: {
  base: string;
  since?: string;
  until?: string;
}): LoggedPullRequest[] => {
  const range = ['--first-parent', base];
  if (since) range.push(`--since=${since}`);
  if (until) range.push(`--until=${until}`);
  return parsePullRequestLog(
    git([
      'log',
      ...range,
      `--format=%H${FIELD_FORMAT}%P${FIELD_FORMAT}%aI${FIELD_FORMAT}%s${FIELD_FORMAT}%b${RECORD_FORMAT}`,
    ]),
  );
};

/**
 * A fix is a Pull Request whose branch type is `fix`, or — when the branch
 * name is gone or reserved — whose title is a `fix` Conventional Commit.
 * Branch naming maps `bug` and `security` issues onto `fix/` (AGENTS.md), so
 * this is the same population from either side.
 */
export const isFix = (pr: { type?: string | null }) => pr.type === 'fix';

/**
 * The commit messages a Pull Request brought in, as one blob of text.
 *
 * A single-parent landing is a squash: its own message is the whole record,
 * and reading only its title would drop the `Introduced in` line the fix gate
 * (ADR 0100) required on the branch.
 */
export const commitTextOf = (pr: LoggedPullRequest): string => {
  if (pr.parents.length < 2) return `${pr.message ?? pr.title}\n`;
  try {
    return git([
      'log',
      `${pr.parents[0]}..${pr.parents[1]}`,
      '--format=%s%n%b%n',
    ]);
  } catch {
    return `${pr.title}\n`;
  }
};

/**
 * The commit that brought `sha` onto `base` — the merge whose Pull Request
 * owns it, or the commit itself when it was squashed or pushed straight to
 * `base`.
 *
 * The answer is the **oldest ancestry-path descendant that sits on `base`'s
 * own first-parent chain**, and every part of that sentence was a wrong
 * answer first:
 *
 *   - `--ancestry-path --first-parent` returns nothing at all. A commit
 *     written on a side branch is not on the first-parent chain, so the
 *     ancestry constraint can never be met and every lookup returns null
 *     while appearing to work.
 *   - the oldest `--merges` descendant is the wrong merge whenever the branch
 *     took a back-merge. `Merge branch 'main' into <branch>` is a merge and a
 *     descendant, and it is on the side branch, not on `base` — which is how
 *     a reference to a commit in Pull Request #705 resolved to no Pull
 *     Request at all.
 *   - without the ancestry check, `rev-list a..b` between two unrelated
 *     commits still prints a range, so a reference to something never merged
 *     would resolve to whatever happens to be newest.
 */
const landingCommit = (
  sha: string,
  base: string,
  onBase: Set<string>,
): string | null => {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sha, base], {
      stdio: 'ignore',
    });
  } catch {
    return null;
  }
  try {
    const full = git(['rev-parse', `${sha}^{commit}`]).trim();
    if (onBase.has(full)) return full;
    const path = gitLines(['rev-list', '--ancestry-path', `${sha}..${base}`]);
    return path.filter((commit) => onBase.has(commit)).at(-1) ?? null;
  } catch {
    return null;
  }
};

/** Every commit on `base`'s first-parent chain, read once per measurement. */
const firstParentCommits = (base: string): Set<string> => {
  try {
    return new Set(gitLines(['rev-list', '--first-parent', base]));
  } catch {
    return new Set<string>();
  }
};

/** The date the reviewer could first have seen anything: when its workflow landed. */
export const reviewerSinceFromGit = (): string | null => {
  const added = gitLines([
    'log',
    '--diff-filter=A',
    '--format=%aI',
    '--',
    '.github/workflows/code-review.yml',
  ]);
  return added.at(-1) ?? null;
};

/**
 * Reads every input the pure pipeline needs. Separated from the measurement
 * so a gather can be saved and re-measured without touching git or the
 * network.
 */
export const gather = ({
  base,
  since,
  until,
  reviewerSince,
  useGithub,
}: {
  base: string;
  since: string;
  until: string;
  reviewerSince: string | null;
  useGithub: boolean;
}): Gathered => {
  // Indexed over all of history, not just the window: a root cause is older
  // than the fix that names it, usually by more than the window is wide.
  const all = listPullRequests({ base });
  const inWindow = all.filter(
    (pr) => dateOnly(pr.mergedAt) >= since && dateOnly(pr.mergedAt) <= until,
  );
  const fixes = inWindow.filter(isFix);

  const evidence = {
    'merged pull requests (git)': `${all.length} on \`${base}\`, ${inWindow.length} in the window`,
    'commit messages (git)': 'read',
    'pull request bodies (gh)': useGithub ? 'read' : 'not read — no `gh`',
    'issue bodies (gh)': useGithub ? 'read' : 'not read — no `gh`',
    'review summary comments (gh)': useGithub ? 'read' : 'not read — no `gh`',
    'reviewer live since': reviewerSince ?? 'unknown',
  };

  const gatheredFixes = fixes.map((pr): GatheredFix => {
    const sources: FixSources = { commits: commitTextOf(pr) };
    if (useGithub) {
      const view = ghJsonOrNull([
        'pr',
        'view',
        String(pr.number),
        '--json',
        'body,closingIssuesReferences',
      ]) as {
        body?: string | null;
        closingIssuesReferences?: { number: number }[];
      } | null;
      sources.body = view?.body ?? null;
      const issueBodies = (view?.closingIssuesReferences ?? [])
        .map(
          (ref) =>
            (
              ghJsonOrNull([
                'issue',
                'view',
                String(ref.number),
                '--json',
                'body',
              ]) as { body?: string | null } | null
            )?.body ?? '',
        )
        .filter(Boolean);
      sources.issue = issueBodies.join('\n\n') || null;
    }
    return {
      number: pr.number,
      mergedAt: pr.mergedAt,
      title: pr.title,
      sources,
    };
  });

  // Anything merged before the reviewer's workflow landed is `unreviewed` by
  // a fact about the repository rather than by a failed lookup, and costs no
  // network call to establish.
  const couldHaveBeenReviewed = (pr: LoggedPullRequest) =>
    Boolean(reviewerSince) && dateOnly(pr.mergedAt) >= reviewerSince!;

  const outcomeOf = (
    pr: LoggedPullRequest,
  ): { outcome: ReviewOutcome | null; verdict: Verdict | null } => {
    if (!couldHaveBeenReviewed(pr))
      return { outcome: 'unreviewed', verdict: null };
    if (!useGithub) return { outcome: null, verdict: null };
    const view = ghJsonOrNull([
      'pr',
      'view',
      String(pr.number),
      '--json',
      'comments',
    ]);
    if (!view) return { outcome: null, verdict: null };
    return parseReviewOutcome(
      (view as { comments?: { body?: string | null }[] }).comments ?? [],
    );
  };

  // An outcome for every Pull Request up to the end of the window, not only
  // for the ones inside it: a root cause is older than the fix that names it,
  // so restricting this to the window would report the review status of a
  // root cause as unknown whenever the defect took longer than the window to
  // surface. The denominator is windowed; this index is not.
  const outcomes = all
    .filter((pr) => dateOnly(pr.mergedAt) <= until)
    .map((pr) => ({
      number: pr.number,
      mergedAt: pr.mergedAt,
      ...outcomeOf(pr),
    }));

  return {
    window: { since, until },
    base,
    reviewerSince,
    evidence,
    fixes: gatheredFixes,
    outcomes,
    pullRequests: all.map((pr) => ({
      number: pr.number,
      sha: pr.sha,
      mergedAt: pr.mergedAt,
      branch: pr.branch,
      type: pr.type,
    })),
  };
};

/**
 * Turns a gather into the measurement. Pure apart from the one git call that
 * maps a commit reference onto the Pull Request that landed it — which runs
 * on a replayed gather too, because a reference git cannot place resolves to
 * nothing and lands in `unresolved`, where it is counted.
 */
export const measure = (
  gathered: Gathered,
  { base }: { base?: string } = {},
): EscapedDefectSummary => {
  const prByNumber = new Map(
    gathered.pullRequests.map((pr) => [pr.number, pr]),
  );
  const reviewByNumber = new Map(gathered.outcomes.map((r) => [r.number, r]));
  const { since, until } = gathered.window;
  // The gather's own base wins over the flag. A gather recorded against one
  // branch and replayed under another would resolve its commit references
  // against a history that never contained them, and report the mismatch as
  // `unresolved` — a class that is supposed to mean the reference names no
  // merged Pull Request, not that the replay looked in the wrong place.
  const resolveBase = gathered.base ?? base ?? 'main';

  let onBase: Set<string> | null = null;
  const resolve = (ref: RootCauseRef): GatheredPullRequest | null => {
    if (ref.kind === 'pull-request') return prByNumber.get(ref.number) ?? null;
    onBase ??= firstParentCommits(resolveBase);
    const landing = landingCommit(ref.sha, resolveBase, onBase);
    if (!landing) return null;
    // A commit resolves only to a Pull Request git can name. One that landed
    // outside a Pull Request stays `unresolved`, which is counted.
    return gathered.pullRequests.find((pr) => pr.sha === landing) ?? null;
  };

  const rows = gathered.fixes.map((fix): ClassifiedFix => {
    const attribution = attributeFix(fix.sources);
    const target = attribution?.ref ? resolve(attribution.ref) : null;
    const review = target ? reviewByNumber.get(target.number) : null;
    const rootCause = target
      ? {
          number: target.number,
          mergedAt: target.mergedAt,
          outcome: review?.outcome,
          // The verdict, not only the bucket it falls in: `approve` and
          // `comment` are both `passed`, and which one the reviewer wrote is
          // what the issue asks the measurement to report.
          verdict: review?.verdict ?? null,
        }
      : null;
    return classifyFix({
      fix: { number: fix.number, mergedAt: fix.mergedAt, title: fix.title },
      attribution,
      rootCause,
    });
  });

  // The denominator is the window's own passes. A Pull Request the reviewer
  // passed before the window opened can still be named as a root cause — that
  // shows up in `outsideDenominator`, not silently inside the rate.
  const passed = gathered.outcomes.filter(
    (r) =>
      r.outcome === 'passed' &&
      r.mergedAt.slice(0, 10) >= since &&
      r.mergedAt.slice(0, 10) <= until,
  );

  const unreadable = gathered.outcomes.filter(
    (r) =>
      !r.outcome &&
      r.mergedAt.slice(0, 10) >= since &&
      r.mergedAt.slice(0, 10) <= until,
  ).length;

  return summarize({
    window: gathered.window,
    fixes: rows,
    passed,
    unreadable,
    evidence: gathered.evidence,
  });
};

export const main = (argv: string[]): number => {
  const { flags } = parseArgs(argv);
  const base = flags.base ?? 'main';
  const until = flags.until ?? new Date().toISOString().slice(0, 10);
  const since = flags.since ?? shiftDays(until, Number(flags.days ?? 60));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until))
    bail(`--since and --until must be YYYY-MM-DD (got ${since}, ${until})`);

  const replayed = flags.gathered
    ? (readJsonOr(flags.gathered, bail) as Gathered)
    : null;
  const gathered =
    replayed ??
    gather({
      base,
      since,
      until,
      reviewerSince:
        flags['reviewer-since'] ?? dateOnly(reviewerSinceFromGit()) ?? null,
      useGithub: !('no-github' in flags) && githubAvailable(),
    });
  if (flags['save-gather'])
    writeFile(flags['save-gather'], `${JSON.stringify(gathered, null, 2)}\n`);

  const summary = measure(gathered, { base });
  const markdown = renderMeasurement(summary);
  if (flags.out) writeFile(flags.out, markdown);
  if (flags.json)
    writeFile(flags.json, `${JSON.stringify(summary, null, 2)}\n`);
  if (!flags.out) process.stdout.write(markdown);
  console.error(
    `escaped-defects: ${summary.sample.fixes} fixes ${summary.window.since}..${summary.window.until}, ` +
      `${summary.sample.attributed} attributed, denominator ${summary.denominator}, ` +
      `rate ${summary.rate === null ? 'not measurable' : `${(100 * summary.rate).toFixed(1)}%`}`,
  );
  return 0;
};

if (isMain(import.meta.url)) process.exit(main(process.argv.slice(2)));
