/**
 * Which GitHub Actions cache entries a cleanup run may delete.
 *
 * The repository sits over GitHub's 10 GB per-repository cache limit, and the
 * eviction that limit causes is the reason the Nx computation cache barely
 * helps a pull request: useful entries are pushed out within days by entries
 * nothing can ever restore from. Three kinds of entry are dead the moment
 * they are written over:
 *
 *   1. **A closed pull request's entries.** Every cache a pull request run
 *      saved is scoped to `refs/pull/<n>/merge`. Once the pull request is
 *      closed, no run will ever restore from that scope again.
 *   2. **A superseded dependency cache.** `<os>-node-<major>-deps-<hash>` is
 *      restored by exact key only, so the moment the lockfile hash changes
 *      every older hash on that ref is unreachable.
 *   3. **A superseded Nx baseline.** `<os>-nx-<major>-<target>-<sha>` is
 *      saved per commit and restored through a prefix, so only the newest
 *      entry for a target is ever the one a run restores.
 *
 * Every rule here is the same rule — **keep the newest entry of each Cache
 * Family, delete the rest** — and the one invariant worth stating on its own
 * is the one a bug would break: *the newest entry of a family is never
 * selected*. Deleting it is not a slow cache, it is a cold one, and on `main`
 * it is the baseline every pull request restores from (the reason push-to-
 * `main` stopped cancelling itself at all).
 *
 * Everything in here is pure over a cache listing, so the Contract Suite
 * drives it on fixture listings rather than on a repository. The caller
 * (`tools/scripts/ci/prune-actions-caches.ts`) does the listing and the
 * deleting; the fallback on anything it cannot read is to delete *nothing*,
 * which is the opposite of the gate-trigger resolver's fallback and for the
 * same reason — in both, the safe direction is "do more work later".
 *
 * Run the tests with: node --test tools/scripts/lib/actions-cache-cleanup.test.ts
 */

/**
 * One entry of `GET /repos/{owner}/{repo}/actions/caches`.
 *
 * Field names are the API's own, so a fixture listing in the Contract Suite
 * is a verbatim copy of a real response rather than a translation of one.
 */
export interface ActionsCache {
  id: number;
  key: string;
  ref: string;
  created_at: string;
  size_in_bytes?: number;
}

/**
 * How a cache key splits into the family it belongs to and the variant that
 * makes this entry one copy of it.
 *
 * Written out rather than derived by "everything before the last dash",
 * because that shortcut groups `…-nx-22-lint` and `…-nx-22-test` into one
 * family the day a key loses its commit suffix — and the newest of that
 * merged family is one target's baseline standing in for every target's.
 * The Node and Nx majors are matched as digits so bumping either does not
 * silently make every key unrecognised (and therefore unprunable); a key
 * that matches nothing here is left alone, and the workflow-shape Contract
 * Suite fails if a key CI actually saves is one of them.
 */
const CACHE_FAMILY_PATTERNS: readonly RegExp[] = [
  // Linux-node-22-deps-<hashFiles digest>
  /^(?<family>.+-node-\d+-deps)-(?<variant>[0-9a-f]+)$/,
  // Linux-nx-22-<target>-<commit sha>
  /^(?<family>.+-nx-\d+-[a-z0-9-]+)-(?<variant>[0-9a-f]{40})$/,
];

/** A pull request run's cache scopes: `refs/pull/<n>/merge` and `/head`. */
const PULL_REQUEST_REF = /^refs\/pull\/(?<number>\d+)\/(?:merge|head)$/;

/**
 * The Cache Family `key` belongs to, or `undefined` when its shape is not one
 * this module recognises. An unrecognised key is never selected.
 */
export function cacheFamily(key: string): string | undefined {
  for (const pattern of CACHE_FAMILY_PATTERNS) {
    const family = pattern.exec(key)?.groups?.family;
    if (family) return family;
  }
  return undefined;
}

/** The pull request a cache ref is scoped to, if it is scoped to one. */
export function pullRequestOf(ref: string): number | undefined {
  const number = PULL_REQUEST_REF.exec(ref)?.groups?.number;
  return number === undefined ? undefined : Number(number);
}

function assertPullRequest(pullRequest: number): void {
  if (!Number.isInteger(pullRequest) || pullRequest <= 0) {
    throw new Error(
      `not a pull request number: ${JSON.stringify(pullRequest)}`,
    );
  }
}

/**
 * Every entry scoped to one closed pull request.
 *
 * Matched on the whole ref, not a prefix: `refs/pull/7/merge` and
 * `refs/pull/70/merge` share one, and a prefix match on pull request 7 would
 * take pull request 70's live cache with it.
 */
export function selectClosedPullRequestCaches(
  caches: readonly ActionsCache[],
  pullRequest: number,
): ActionsCache[] {
  assertPullRequest(pullRequest);
  return sortForDeletion(
    caches.filter((cache) => pullRequestOf(cache.ref) === pullRequest),
  );
}

export interface SupersededOptions {
  /** The ref to prune. Only entries on exactly this ref are considered. */
  ref: string;
  /**
   * Keys to keep whatever their age — the keys a run on this ref would
   * restore right now. `main`'s current dependency key is passed here, so a
   * lockfile revert does not delete the very entry the next push needs just
   * because a newer hash was saved before the revert.
   */
  keepKeys?: readonly string[];
}

/**
 * The orderable Cache Families on one ref, each with its members.
 *
 * Two things are left out, and both are the same refusal to guess. A key
 * whose shape names no family is not grouped at all, so it is never pruned
 * and never reported as kept. A family holding a `created_at` this cannot
 * parse is dropped whole: not knowing which copy is newest is exactly the
 * state in which deleting one is unsafe, and it is also the state in which
 * claiming to have kept one would be a lie.
 *
 * Both callers read this, so "what gets pruned" and "what is reported as
 * kept" cannot disagree about which families exist.
 */
function orderableFamiliesOn(
  caches: readonly ActionsCache[],
  ref: string,
): Map<string, ActionsCache[]> {
  const families = new Map<string, ActionsCache[]>();
  for (const cache of caches) {
    if (cache.ref !== ref) continue;
    const family = cacheFamily(cache.key);
    if (family === undefined) continue;
    const members = families.get(family);
    if (members) members.push(cache);
    else families.set(family, [cache]);
  }
  for (const [family, members] of families) {
    if (members.some((cache) => Number.isNaN(Date.parse(cache.created_at)))) {
      families.delete(family);
    }
  }
  return families;
}

/**
 * The entries on one ref that a newer copy of their own Cache Family has
 * replaced.
 */
export function selectSupersededCaches(
  caches: readonly ActionsCache[],
  { ref, keepKeys = [] }: SupersededOptions,
): ActionsCache[] {
  const keep = new Set(keepKeys);
  const superseded: ActionsCache[] = [];

  for (const members of orderableFamiliesOn(caches, ref).values()) {
    const newest = newestOf(members);
    for (const cache of members) {
      if (cache.id === newest.id) continue;
      if (keep.has(cache.key)) continue;
      superseded.push(cache);
    }
  }

  return sortForDeletion(superseded);
}

/**
 * The newest of a non-empty group, by creation time and then by id.
 *
 * The id tie-break is not decoration: two caches saved in the same second by
 * two jobs of one run compare equal on `created_at`, and without a total
 * order "the newest" is whichever order the listing happened to arrive in —
 * which would make the one invariant this module has depend on the API's
 * pagination.
 */
export function newestOf(caches: readonly ActionsCache[]): ActionsCache {
  if (caches.length === 0) throw new Error('no caches to choose from');
  return caches.reduce((newest, cache) => {
    const by = Date.parse(cache.created_at) - Date.parse(newest.created_at);
    if (by > 0) return cache;
    if (by < 0) return newest;
    return cache.id > newest.id ? cache : newest;
  });
}

/** Stable, listing-order-independent: by ref, then key, then id. */
function sortForDeletion(caches: readonly ActionsCache[]): ActionsCache[] {
  return [...caches].sort(
    (a, b) =>
      a.ref.localeCompare(b.ref) || a.key.localeCompare(b.key) || a.id - b.id,
  );
}

/** One entry the plan deletes, with the sentence explaining why. */
export interface CacheDeletion {
  cache: ActionsCache;
  reason: string;
}

export interface CacheCleanupPlan {
  deletions: CacheDeletion[];
  /** The newest entry of each family the plan deliberately kept. */
  kept: ActionsCache[];
  freedBytes: number;
}

export interface CleanupScope {
  /** A pull request that has just closed; every entry in its scope is dead. */
  closedPullRequest?: number;
  /** A ref whose superseded entries to prune, normally `refs/heads/main`. */
  supersededOn?: string;
  keepKeys?: readonly string[];
}

/**
 * The deletions one cleanup run should make.
 *
 * A scope is required. A call that names neither a closed pull request nor a
 * ref to prune would delete nothing and report success, which is how a
 * mistyped workflow input becomes a cache that silently grows for months.
 */
export function planCacheCleanup(
  caches: readonly ActionsCache[],
  { closedPullRequest, supersededOn, keepKeys }: CleanupScope,
): CacheCleanupPlan {
  if (closedPullRequest === undefined && supersededOn === undefined) {
    throw new Error(
      'nothing to clean up: name a closed pull request, a ref to prune, or both',
    );
  }

  const deletions: CacheDeletion[] = [];
  const seen = new Set<number>();
  const add = (cache: ActionsCache, reason: string): void => {
    if (seen.has(cache.id)) return;
    seen.add(cache.id);
    deletions.push({ cache, reason });
  };

  if (closedPullRequest !== undefined) {
    for (const cache of selectClosedPullRequestCaches(
      caches,
      closedPullRequest,
    )) {
      add(cache, `pull request #${closedPullRequest} is closed`);
    }
  }

  const kept: ActionsCache[] = [];
  if (supersededOn !== undefined) {
    for (const cache of selectSupersededCaches(caches, {
      ref: supersededOn,
      keepKeys,
    })) {
      const family = cacheFamily(cache.key) ?? cache.key;
      add(cache, `superseded on ${supersededOn} by a newer ${family} entry`);
    }
    kept.push(...keptNewest(caches, supersededOn));
  }

  return {
    deletions,
    kept,
    freedBytes: deletions.reduce(
      (total, { cache }) => total + (cache.size_in_bytes ?? 0),
      0,
    ),
  };
}

/** The newest entry of every orderable family on one ref. */
function keptNewest(
  caches: readonly ActionsCache[],
  ref: string,
): ActionsCache[] {
  return sortForDeletion(
    [...orderableFamiliesOn(caches, ref).values()].map((members) =>
      newestOf(members),
    ),
  );
}

/** Bytes, as a human reads them in a step summary. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * The plan as a GitHub step summary.
 *
 * What it kept is printed beside what it deleted on purpose: "deleted 11
 * entries" is unreadable as evidence, while "kept Linux-nx-22-test @ <sha>"
 * is the line that shows the baseline survived.
 *
 * `deleted` is how many of the plan's entries the run actually removed, and
 * it is what decides the headline's voice. Leaving it out means "all of
 * them", for a caller that only has a plan. The three-way split exists
 * because a run can stop partway — a token refused halfway through is not a
 * dry run and not a completed one, and a summary that called it either would
 * be naming entries as deleted that are still there, or the reverse.
 */
export function formatCleanupSummary(
  plan: CacheCleanupPlan,
  { dryRun = false, deleted }: { dryRun?: boolean; deleted?: number } = {},
): string {
  const lines = ['## Actions cache cleanup', ''];
  const planned = plan.deletions.length;
  const done = dryRun ? 0 : (deleted ?? planned);

  if (planned === 0) {
    lines.push('Nothing to delete.');
  } else {
    const noun = planned === 1 ? 'entry' : 'entries';
    if (dryRun) {
      lines.push(
        `Would delete ${planned} cache ${noun}, freeing ${formatBytes(plan.freedBytes)}:`,
        '',
      );
    } else if (done === 0) {
      lines.push(`Deleted none of the ${planned} cache ${noun} planned:`, '');
    } else if (done < planned) {
      lines.push(
        `Deleted ${done} of ${planned} planned cache entries, then stopped:`,
        '',
      );
    } else {
      lines.push(
        `Deleted ${planned} cache ${noun}, freeing ${formatBytes(plan.freedBytes)}:`,
        '',
      );
    }
    for (const { cache, reason } of plan.deletions) {
      lines.push(`- \`${cache.key}\` (${cache.ref}) — ${reason}`);
    }
  }

  if (plan.kept.length > 0) {
    lines.push('', 'Kept as the newest entry of its family:', '');
    for (const cache of plan.kept) {
      lines.push(`- \`${cache.key}\` (${cache.ref})`);
    }
  }

  return `${lines.join('\n')}\n`;
}
