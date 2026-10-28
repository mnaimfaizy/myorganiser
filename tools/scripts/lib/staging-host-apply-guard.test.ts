import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPLY_JOB,
  evaluateStagingHostApply,
  normalizeJobs,
  UPLOAD_JOB,
  type JobRecord,
  type StagingHostApplyResult,
} from './staging-host-apply-guard.ts';

/** Narrows a refusal's reason for assertions, after `result.ok` is checked false. */
function refusalReason(result: StagingHostApplyResult): string {
  return (result as { ok: false; reason: string }).reason;
}

const X = 'a'.repeat(40);
const Y = 'b'.repeat(40);

/** Minutes past a fixed instant, as the ISO strings the Actions API returns. */
function at(minute: number): string {
  return new Date(Date.UTC(2026, 8, 14, 9, minute)).toISOString();
}

/** A normalized job: five minutes long, starting at `startMinute`. */
function job(
  name: string,
  headSha: string | null,
  startMinute: number,
  conclusion: string | null = 'success',
): JobRecord {
  return {
    name,
    conclusion,
    headSha,
    startedAt: at(startMinute),
    completedAt: at(startMinute + 5),
  };
}

const upload = (
  headSha: string | null,
  startMinute: number,
  conclusion?: string | null,
): JobRecord => job(UPLOAD_JOB, headSha, startMinute, conclusion);
const apply = (
  headSha: string | null,
  startMinute: number,
  conclusion?: string | null,
): JobRecord => job(APPLY_JOB, headSha, startMinute, conclusion);

const evaluate = (cutSha: string, jobs: JobRecord[]) =>
  evaluateStagingHostApply({ cutSha, jobs, runsRead: 20 });

test('an upload and a green apply of the cut commit in one run is enough', () => {
  assert.equal(evaluate(X, [upload(X, 0), apply(X, 6)]).ok, true);
});

test('an automatic upload applied by a later apply_only dispatch is enough', () => {
  assert.equal(evaluate(X, [upload(X, 0), apply(X, 30)]).ok, true);
});

test('a green apply_only retry after a red apply is enough', () => {
  const result = evaluate(X, [
    upload(X, 0),
    apply(X, 6, 'failure'),
    apply(X, 20),
  ]);
  assert.equal(result.ok, true);
});

test('refuses when nothing has been uploaded, naming the window it read', () => {
  const result = evaluate(X, []);
  assert.equal(result.ok, false);
  assert.match(refusalReason(result), /no successful Staging upload/i);
  assert.match(refusalReason(result), /latest 20 `Deploy Staging` runs/);
  assert.match(refusalReason(result), new RegExp(`\`${UPLOAD_JOB}\``));
});

test('refuses when the cut commit was uploaded but never applied', () => {
  const result = evaluate(X, [upload(Y, 0), apply(Y, 6), upload(X, 20)]);
  assert.equal(result.ok, false);
  assert.match(refusalReason(result), /not been Host Applied/i);
  assert.match(refusalReason(result), /apply_only/);
  assert.match(refusalReason(result), new RegExp(`\`${APPLY_JOB}\``));
});

test('refuses when Staging last uploaded a different commit', () => {
  const result = evaluate(X, [upload(X, 0), apply(X, 6), upload(Y, 20)]);
  assert.equal(result.ok, false);
  assert.match(refusalReason(result), new RegExp(Y.slice(0, 7)));
});

test('refuses when the only green apply ran before another commit was uploaded over it', () => {
  const result = evaluate(X, [
    upload(X, 0),
    apply(X, 6),
    upload(Y, 20),
    upload(X, 40),
  ]);
  assert.equal(result.ok, false);
  assert.match(refusalReason(result), /not been Host Applied/i);
});

test('refuses an apply_only at the cut commit that ran before that commit was uploaded', () => {
  const result = evaluate(X, [upload(Y, 0), apply(X, 10), upload(X, 20)]);
  assert.equal(result.ok, false);
  assert.match(refusalReason(result), /not been Host Applied/i);
});

test('ignores failed uploads, and applies that were skipped or are still running', () => {
  const result = evaluate(X, [
    upload(X, 0),
    apply(X, 6, 'skipped'),
    apply(X, 12, null),
    upload(Y, 20, 'failure'),
  ]);
  assert.equal(result.ok, false);
  assert.match(refusalReason(result), /not been Host Applied/i);
});

test('refuses when Staging last uploaded from a run that did not record its commit', () => {
  const result = evaluate(X, [upload(X, 0), apply(X, 6), upload(null, 20)]);
  assert.equal(result.ok, false);
  assert.match(refusalReason(result), /did not record which commit/i);
});

/** An Actions API run and its jobs, as `gh api` returns them. */
function apiRun(displayTitle: string, jobHeadSha: string | null) {
  return {
    run: { display_title: displayTitle },
    jobs: [
      {
        name: UPLOAD_JOB,
        conclusion: 'success',
        head_sha: jobHeadSha,
        started_at: at(0),
        completed_at: at(5),
      },
      {
        name: 'Prepare Dependency Cache',
        conclusion: 'success',
        head_sha: jobHeadSha,
        started_at: at(0),
        completed_at: at(1),
      },
      {
        name: APPLY_JOB,
        conclusion: 'success',
        head_sha: jobHeadSha,
        started_at: at(6),
        completed_at: at(11),
      },
    ],
  };
}

test('normalizeJobs keeps only the two Staging jobs and reads the API field names', () => {
  const { run, jobs } = apiRun(`Deploy Staging ${X}`, X);
  const normalized = normalizeJobs(run, jobs);
  assert.deepEqual(
    normalized.map((j) => j.name),
    [UPLOAD_JOB, APPLY_JOB],
  );
  assert.equal(normalized[1].startedAt, at(6));
});

test('normalizeJobs takes the commit from the run name, not the job, when main moved during CI', () => {
  // CI tested X; by the time the workflow_run fired, main was at Y. The run
  // name records the commit that was checked out and uploaded.
  const { run, jobs } = apiRun(`Deploy Staging ${X}`, Y);
  const normalized = normalizeJobs(run, jobs);
  assert.deepEqual(
    normalized.map((j) => j.headSha),
    [X, X],
  );
});

test('normalizeJobs records no commit for a run whose name carries none', () => {
  const { run, jobs } = apiRun('Deploy Staging', X);
  assert.deepEqual(
    normalizeJobs(run, jobs).map((j) => j.headSha),
    [null, null],
  );
});
