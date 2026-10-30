#!/usr/bin/env node

/**
 * Deletes the GitHub Actions cache entries nothing can restore from any more.
 *
 *   node tools/scripts/ci/prune-actions-caches.ts --closed-pull-request <n>
 *   node tools/scripts/ci/prune-actions-caches.ts --prune-ref refs/heads/main \
 *     [--keep-key <key>]...
 *   … [--repository <owner/name>] [--dry-run]
 *
 * Which entries those are is decided by `planCacheCleanup` in
 * tools/scripts/lib/actions-cache-cleanup.ts, purely over the listing this
 * script fetches; everything here is the listing, the deleting, and the
 * report. `.github/workflows/cache-cleanup.yml` is the only caller.
 *
 * **The fallback is always to delete less.** A listing it cannot fetch or
 * cannot read exits 2 having deleted nothing: the cost of skipping a cleanup
 * is a cache run that happens tomorrow instead, and the cost of guessing is
 * a deleted baseline that every pull request then misses. The one failure
 * that is not an error is a token without `actions: write` — a pull request
 * closed from a fork, or by Dependabot, reaches this script with a read-only
 * token, and since `pull_request_target` is deliberately not used anywhere
 * in this repository (it would hand a fork's head the write token this
 * script wants), those entries are left to GitHub's own eviction and the run
 * passes with a warning rather than failing a pull request that has already
 * merged.
 *
 * Exit 0 = the plan was applied, was empty, or the token cannot delete.
 * Exit 1 = a deletion failed for any other reason, so the plan was applied
 *          only in part and the repository has already changed.
 * Exit 2 = the script could not run and deleted nothing: bad arguments, or a
 *          listing it could not fetch, could not read, or could not read whole.
 */

import { appendFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  formatCleanupSummary,
  planCacheCleanup,
  type ActionsCache,
  type CacheCleanupPlan,
} from '../lib/actions-cache-cleanup.ts';
import { errorMessage } from '../lib/error-message.ts';
import { gh, ghJson } from '../lib/gh.ts';

/** The API's maximum, and the page size the listing loop assumes. */
export const PAGE_SIZE = 100;

/**
 * A bound on the paging loop. 100 pages is 10,000 entries, far past the
 * number of entries 10 GB of cache can hold; the loop stops on a short page
 * long before this. It exists so a server that keeps answering with a full
 * page cannot spin forever.
 */
export const MAX_PAGES = 100;

export interface PruneOptions {
  repository: string;
  closedPullRequest?: number;
  pruneRef?: string;
  keepKeys?: readonly string[];
  dryRun?: boolean;
  ghJsonCall?: typeof ghJson;
  ghCall?: typeof gh;
  log?: (message: string) => void;
}

export interface PruneResult {
  plan: CacheCleanupPlan;
  deleted: number;
  /** Set when a deletion was refused for want of `actions: write`. */
  permissionDenied: boolean;
  summary: string;
}

/**
 * A failure that happened while the plan was still being made, so nothing has
 * been deleted.
 *
 * It exists so that `main` can tell the two exit codes apart while still
 * having exactly one entry point — `pruneActionsCaches` — for the CLI and the
 * Contract Suite both. An earlier shape gave `main` its own two-phase
 * sequence, which left the function the suite exercises on no production path
 * at all: dropping `keepKeys` from the real call site would have kept every
 * test green.
 */
export class CachePlanError extends Error {
  constructor(cause: unknown) {
    super(errorMessage(cause), { cause });
    this.name = 'CachePlanError';
  }
}

/**
 * Whether a `gh` failure is the token being read-only rather than something
 * worth failing the run over.
 *
 * Matched on the status line `gh` prints (`gh: ... (HTTP 403)`), and on the
 * message the Actions token itself returns, because the two reach us by
 * different paths depending on whether the endpoint 403s or the integration
 * is simply not allowed to call it.
 */
export function isPermissionDenied(error: unknown): boolean {
  const text = `${errorMessage(error)} ${
    (error as { stderr?: unknown } | null)?.stderr ?? ''
  }`;
  return /HTTP 403/.test(text) || /not accessible by integration/i.test(text);
}

/** One page of `GET /repos/{owner}/{repo}/actions/caches`, validated. */
function readPage(payload: unknown, page: number): ActionsCache[] {
  const caches = (payload as { actions_caches?: unknown } | null)
    ?.actions_caches;
  if (!Array.isArray(caches)) {
    throw new Error(`page ${page} of the cache listing has no actions_caches`);
  }
  return caches.map((entry, index) => {
    const cache = entry as Partial<ActionsCache> | null;
    if (
      typeof cache?.id !== 'number' ||
      typeof cache.key !== 'string' ||
      typeof cache.ref !== 'string' ||
      typeof cache.created_at !== 'string'
    ) {
      throw new Error(
        `page ${page} entry ${index} is not a cache entry: ${JSON.stringify(entry)}`,
      );
    }
    return {
      id: cache.id,
      key: cache.key,
      ref: cache.ref,
      created_at: cache.created_at,
      size_in_bytes:
        typeof cache.size_in_bytes === 'number'
          ? cache.size_in_bytes
          : undefined,
    };
  });
}

/**
 * Every cache entry in the repository.
 *
 * Paged by hand rather than with `gh api --paginate`, which concatenates one
 * JSON object per page and so needs a flag to re-wrap; an explicit `page=`
 * loop reads the same on every `gh` version and is what the Contract Suite
 * can drive with a stub.
 *
 * Running out of pages throws rather than returning what it has. A *partial*
 * listing is the one input that turns the selection's invariant inside out:
 * with the newest copy of a family left on an unread page, the newest copy
 * this script can see is an older one, and the entry it deletes as superseded
 * is the baseline. A listing that cannot be read whole must delete nothing.
 */
export function listCaches(
  repository: string,
  ghJsonCall: typeof ghJson = ghJson,
): ActionsCache[] {
  const byId = new Map<number, ActionsCache>();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const entries = readPage(
      ghJsonCall([
        'api',
        '-H',
        'Accept: application/vnd.github+json',
        `repos/${repository}/actions/caches?per_page=${PAGE_SIZE}&page=${page}`,
      ]),
      page,
    );
    for (const cache of entries) byId.set(cache.id, cache);
    if (entries.length < PAGE_SIZE) return [...byId.values()];
  }
  throw new Error(
    `the cache listing is still full at page ${MAX_PAGES} (${PAGE_SIZE} per page); ` +
      'refusing to prune from a listing that may be missing the newest entry of a family',
  );
}

/**
 * What this run would delete, read from the repository.
 *
 * Separate from applying it because the two failures mean different things to
 * an operator and carry different exit codes: a plan that cannot be made
 * deleted nothing, while a plan that fails halfway deleted some of it.
 */
export function planFromRepository(
  {
    repository,
    closedPullRequest,
    pruneRef,
    keepKeys,
  }: Pick<
    PruneOptions,
    'repository' | 'closedPullRequest' | 'pruneRef' | 'keepKeys'
  >,
  ghJsonCall: typeof ghJson = ghJson,
): CacheCleanupPlan {
  return planCacheCleanup(listCaches(repository, ghJsonCall), {
    closedPullRequest,
    supersededOn: pruneRef,
    keepKeys,
  });
}

/** Applies a plan, one `DELETE` per entry. */
export function applyCleanupPlan(
  repository: string,
  plan: CacheCleanupPlan,
  {
    dryRun = false,
    ghCall = gh,
    log = (message: string) => process.stderr.write(`${message}\n`),
  }: Pick<PruneOptions, 'dryRun' | 'ghCall' | 'log'> = {},
): { deleted: number; permissionDenied: boolean } {
  let deleted = 0;
  let permissionDenied = false;

  for (const { cache, reason } of plan.deletions) {
    if (dryRun) {
      log(`would delete ${cache.key} (${cache.ref}): ${reason}`);
      continue;
    }
    try {
      ghCall([
        'api',
        '--method',
        'DELETE',
        '-H',
        'Accept: application/vnd.github+json',
        `repos/${repository}/actions/caches/${cache.id}`,
      ]);
      deleted += 1;
      log(`deleted ${cache.key} (${cache.ref}): ${reason}`);
    } catch (error) {
      if (!isPermissionDenied(error)) throw error;
      // Read-only token: stop, rather than repeating the same refusal once
      // per entry in a log nobody will read to the end.
      permissionDenied = true;
      break;
    }
  }

  return { deleted, permissionDenied };
}

/**
 * Plan and apply, in the one function both the CLI and the Contract Suite go
 * through.
 *
 * A planning failure is re-thrown as a `CachePlanError` — the only thing
 * `main` needs in order to exit 2 for "deleted nothing" and 1 for "applied in
 * part" without duplicating this sequence beside it.
 */
export function pruneActionsCaches({
  repository,
  closedPullRequest,
  pruneRef,
  keepKeys,
  dryRun = false,
  ghJsonCall = ghJson,
  ghCall = gh,
  log,
}: PruneOptions): PruneResult {
  let plan: CacheCleanupPlan;
  try {
    plan = planFromRepository(
      { repository, closedPullRequest, pruneRef, keepKeys },
      ghJsonCall,
    );
  } catch (error) {
    throw new CachePlanError(error);
  }

  const applied = applyCleanupPlan(repository, plan, { dryRun, ghCall, log });
  return {
    plan,
    ...applied,
    // The count, not the refusal flag, decides how the summary reads. A
    // read-only token normally refuses the first `DELETE` and every one
    // after it, but a token that loses the permission partway through — or
    // one entry it may not touch — leaves some deleted and some not, and
    // that run must not report either extreme.
    summary: formatCleanupSummary(plan, { dryRun, deleted: applied.deleted }),
  };
}

function usage(): never {
  process.stderr.write(
    'Usage: prune-actions-caches.ts --closed-pull-request <n>\n' +
      '       prune-actions-caches.ts --prune-ref <ref> [--keep-key <key>]...\n' +
      '       … [--repository <owner/name>] [--dry-run]\n',
  );
  process.exit(2);
}

/** `--flag value` pairs and bare `--flag` switches; nothing positional. */
export function parseArgs(argv: readonly string[]): {
  repository?: string;
  closedPullRequest?: number;
  pruneRef?: string;
  keepKeys: string[];
  dryRun: boolean;
} {
  const keepKeys: string[] = [];
  let repository: string | undefined;
  let closedPullRequest: number | undefined;
  let pruneRef: string | undefined;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    const takeValue = (): string => {
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${flag} needs a value`);
      }
      index += 1;
      return value;
    };
    switch (flag) {
      case '--dry-run':
        dryRun = true;
        break;
      case '--repository':
        repository = takeValue();
        break;
      case '--prune-ref':
        pruneRef = takeValue();
        break;
      case '--keep-key':
        keepKeys.push(takeValue());
        break;
      case '--closed-pull-request': {
        const raw = takeValue();
        closedPullRequest = Number(raw);
        if (!Number.isInteger(closedPullRequest) || closedPullRequest <= 0) {
          throw new Error(`--closed-pull-request needs a number, got ${raw}`);
        }
        break;
      }
      default:
        throw new Error(`unknown argument ${flag}`);
    }
  }

  return { repository, closedPullRequest, pruneRef, keepKeys, dryRun };
}

function main(): void {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`prune-actions-caches: ${errorMessage(error)}\n`);
    usage();
  }

  const repository = args.repository ?? process.env.GITHUB_REPOSITORY;
  if (!repository) {
    process.stderr.write(
      'prune-actions-caches: no --repository and no GITHUB_REPOSITORY\n',
    );
    usage();
  }

  // One call, two exit codes. Nothing has been deleted while the plan is
  // being made, so a failure there is "could not run" (2); once deletions are
  // under way a failure has already changed the repository, which is a
  // different thing for an operator to read (1).
  let result: PruneResult;
  try {
    result = pruneActionsCaches({
      repository,
      closedPullRequest: args.closedPullRequest,
      pruneRef: args.pruneRef,
      keepKeys: args.keepKeys,
      dryRun: args.dryRun,
    });
  } catch (error) {
    process.stderr.write(`prune-actions-caches: ${errorMessage(error)}\n`);
    if (error instanceof CachePlanError) process.exit(2);
    process.stderr.write(
      'prune-actions-caches: the plan was applied only in part.\n',
    );
    process.exit(1);
  }

  // Written here rather than piped through `tee` in the workflow: a pipeline
  // puts the script's exit code behind `pipefail`, and these exit codes are
  // the whole point of the two phases above.
  process.stdout.write(result.summary);
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) appendFileSync(summaryFile, result.summary);

  if (result.permissionDenied) {
    process.stderr.write(
      "::warning title=Cache cleanup skipped::This run's token cannot delete cache entries (actions: write). " +
        'A pull request closed from a fork or by Dependabot gets a read-only token; its entries are left to GitHub eviction.\n',
    );
  }
}

// Guarded through `pathToFileURL` so the Contract Suite can import the
// functions above without the CLI running itself, and so a checkout under a
// path `import.meta.url` percent-encodes still compares equal — the bug
// tools/scripts/ci/resolve-gate-triggers.ts records in its own guard.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
