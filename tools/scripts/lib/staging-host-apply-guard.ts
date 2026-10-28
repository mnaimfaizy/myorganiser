/**
 * Decides whether Staging holds the commit being Cut, Host Applied.
 *
 * Staging Host Apply is operator-dispatched while the backend upload also
 * runs on a daily schedule, so "a green apply exists" is not enough: a green
 * run on Monday says nothing about the commits uploaded on Tuesday. The Cut is
 * allowed only when Staging's latest upload is the cut commit and a green
 * `host-apply` at that commit started after it landed — with no upload of
 * another commit in between.
 *
 * What qualifies is a full dispatch, which uploads and applies one named
 * commit; an `apply_only` retry after that dispatch's upload qualifies too. A
 * scheduled upload never does: its run records no commit, so it can refuse a
 * Cut but not allow one, and an `apply_only` dispatch after it does not
 * change that. See ADR 0056, amendments 2026-09-14 and 2026-10-13; ADR 0128.
 */

export const UPLOAD_JOB = 'deploy-backend';
export const APPLY_JOB = 'host-apply';

// `deploy-staging.yml` puts the commit it uploads into `run-name`, when it can
// be sure of it. A dispatched run uploads `github.sha` and names it. A
// scheduled run uploads the newest green `main` commit, which it works out in
// a job and which need not be the run's own `head_sha` (the tip of `main`
// when the schedule fired) — so a job's `head_sha` cannot be trusted here, and
// a scheduled run's name carries no commit at all.
const RUN_NAME_COMMIT = /\b([0-9a-f]{40})\b/;

/** One Actions API run, as `gh api` returns it — only the field this guard reads. */
export interface ApiRun {
  display_title?: string | null;
}

/** One Actions API job, as `gh api` returns it — only the fields this guard reads. */
export interface ApiJob {
  name: string;
  conclusion: string | null;
  started_at: string;
  completed_at: string;
}

/** One of the guard's two named jobs, normalized to the shape it compares. */
export interface JobRecord {
  name: string;
  conclusion: string | null;
  headSha: string | null;
  startedAt: string;
  completedAt: string;
}

/**
 * Reads one Actions API run and its jobs into the shape the guard compares.
 * A run whose name carries no commit — every scheduled run — yields
 * `headSha: null`, which never matches a cut commit, so it can refuse a Cut
 * but never allow one.
 */
export function normalizeJobs(apiRun: ApiRun, apiJobs: ApiJob[]): JobRecord[] {
  const headSha = RUN_NAME_COMMIT.exec(apiRun.display_title ?? '')?.[1] ?? null;

  return apiJobs
    .filter((job) => job.name === UPLOAD_JOB || job.name === APPLY_JOB)
    .map((job) => ({
      name: job.name,
      conclusion: job.conclusion,
      headSha,
      startedAt: job.started_at,
      completedAt: job.completed_at,
    }));
}

const short = (sha: string): string => String(sha).slice(0, 7);
const toMillis = (iso: string): number => Date.parse(iso);

export type StagingHostApplyResult =
  | { ok: true }
  | { ok: false; reason: string };

export function evaluateStagingHostApply({
  cutSha,
  jobs,
  runsRead,
}: {
  cutSha: string;
  jobs: JobRecord[];
  runsRead: number;
}): StagingHostApplyResult {
  const green = jobs.filter((job) => job.conclusion === 'success');
  const uploads = green
    .filter((job) => job.name === UPLOAD_JOB)
    .sort((a, b) => toMillis(a.completedAt) - toMillis(b.completedAt));

  const latest = uploads.at(-1);
  if (!latest) {
    return {
      ok: false,
      reason:
        `Refusing to Cut: found no successful Staging upload (\`${UPLOAD_JOB}\`) in the latest ${runsRead} \`Deploy Staging\` runs. ` +
        `Upload and Host Apply this commit, or an older upload may simply be outside that window.`,
    };
  }

  if (latest.headSha === null) {
    return {
      ok: false,
      reason:
        `Refusing to Cut ${short(cutSha)}: Staging's latest upload came from a run that did not record which commit it uploaded. ` +
        'Dispatch `Deploy Staging` (full run, not apply_only) for this commit.',
    };
  }

  if (latest.headSha !== cutSha) {
    return {
      ok: false,
      reason:
        `Refusing to Cut ${short(cutSha)}: Staging's latest backend upload is ${short(latest.headSha)}, not the commit being cut. ` +
        'Dispatch `Deploy Staging` in full at this commit, then Cut once `host-apply` is green.',
    };
  }

  const lastOther = uploads.findLast((job) => job.headSha !== cutSha);
  // `latest` (above) is itself an upload whose headSha === cutSha, so this
  // find always matches at least `latest` — it cannot come back empty.
  const landed = uploads.find(
    (job) =>
      job.headSha === cutSha &&
      (!lastOther ||
        toMillis(job.completedAt) > toMillis(lastOther.completedAt)),
  )!;

  const applied = green.some(
    (job) =>
      job.name === APPLY_JOB &&
      job.headSha === cutSha &&
      toMillis(job.startedAt) >= toMillis(landed.completedAt),
  );

  if (!applied) {
    return {
      ok: false,
      reason:
        `Refusing to Cut ${short(cutSha)}: Staging uploaded it but it has not been Host Applied. ` +
        `Switch SSH shell access on and dispatch \`Deploy Staging\` with apply_only, then Cut once \`${APPLY_JOB}\` is green.`,
    };
  }

  return { ok: true };
}
