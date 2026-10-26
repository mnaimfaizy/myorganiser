#!/usr/bin/env node
// Asserts the CI-owned Host Apply job (ADR 0056, issue #567) keeps the shape
// its acceptance criteria promise, read straight from the two workflow files
// rather than from a doc page: `host-apply` needs the backend upload job,
// runs under the right GitHub Environment, is reachable by an apply-only
// `workflow_dispatch` on which `deploy-backend` and `deploy-frontend` skip
// themselves, Staging's upload and apply share one concurrency group that
// never cancels in progress, Staging's apply requires a dispatch, and no
// `secrets.*` reference in the job falls outside the documented allowlist
// (`DATABASE_URL` is never one of them, anywhere in either file). It also
// pins the hardening the wiring depends on: ssh verifies the host against
// pinned keys, the SSH secrets are validated before use, the two HTTP probes
// keep their shape, and the captured output passes the redaction scrubber
// before anything prints it. In Production, Release marking (ADR 0133, issue
// #1215) runs only after both `host-apply` and `deploy-frontend` succeed: the
// `mark-feedback-release` job needs both, never uses `always()`, and runs the
// marking script.
//
// Direction: one way, workflow to contract. Each check reads a shape out of
// the workflow text and fails when it is gone; the secret allowlist alone
// runs both ways, against `HOST_APPLY_SECRET_NAMES`. Not asserted here: which
// events trigger the Staging workflow, and the concurrency group of
// `deploy-frontend` (check-deploy-pipeline.ts reads both); the concurrency
// of Production's jobs; and what any step outside `host-apply` does.
//
//   node tools/scripts/check-host-apply-workflow.ts [repoRoot]
//
// Exit 0 = every assertion holds. Exit 1 = a workflow drifted from the
// contract. Exit 2 = the check could not run.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { HOST_APPLY_SECRET_NAMES } from './lib/host-apply.ts';

const ROOT = resolve(process.argv[2] ?? '.');
const WORKFLOWS = join('.github', 'workflows');
const STAGING = join(WORKFLOWS, 'deploy-staging.yml');
const PRODUCTION = join(WORKFLOWS, 'deploy-production.yml');

const fail: (msg: string) => never = (msg) => {
  console.error(`host-apply-workflow: ${msg}`);
  process.exit(2);
};

const fileCache = new Map<string, string>();
const read = (path: string): string => {
  const cached = fileCache.get(path);
  if (cached !== undefined) return cached;
  const full = join(ROOT, path);
  if (!existsSync(full)) fail(`${path} not found`);
  const contents = readFileSync(full, 'utf8');
  fileCache.set(path, contents);
  return contents;
};

/** Slices one job out of a workflow (same approach as check-deploy-pipeline.ts). */
const jobBlock = (path: string, jobId: string): string => {
  const source = read(path);
  const jobsAt = source.search(/^jobs:\s*$/m);
  if (jobsAt === -1) fail(`${path} has no top-level jobs: key`);

  const body = source.slice(jobsAt);
  const start = body.search(new RegExp(`^ {2}${jobId}:\\s*$`, 'm'));
  if (start === -1) fail(`${path} has no job named ${jobId}`);

  const rest = body.slice(start + 1);
  const next = rest.search(/^ {2}[a-z0-9][a-z0-9-]*:\s*$/m);
  return next === -1 ? rest : rest.slice(0, next);
};

const findings: string[] = [];

function checkEnvironment(path: string, environment: string): void {
  const block = jobBlock(path, 'host-apply');
  if (
    !new RegExp(`^\\s*environment:\\s*${environment}\\s*$`, 'm').test(block)
  ) {
    findings.push(
      `${path}: host-apply does not declare environment: ${environment}`,
    );
  }
}

function checkNeedsBackendUpload(path: string): void {
  const block = jobBlock(path, 'host-apply');
  const match = block.match(/^\s*needs:\s*(.+)$/m);
  if (!match) {
    findings.push(`${path}: host-apply declares no needs:`);
    return;
  }
  if (!match[1].includes('deploy-backend')) {
    findings.push(
      `${path}: host-apply's needs (${match[1].trim()}) does not include deploy-backend`,
    );
  }
}

/** The `workflow_dispatch:` block only, so `apply_only` isn't confused with a same-named job step. */
function checkApplyOnlyDispatchInput(path: string): void {
  const source = read(path);
  const dispatchAt = source.search(/^\s*workflow_dispatch:\s*$/m);
  if (dispatchAt === -1) {
    findings.push(`${path}: declares no workflow_dispatch trigger`);
    return;
  }

  const body = source.slice(dispatchAt);
  const next = body.slice(1).search(/^\S/m);
  const dispatchBlock = next === -1 ? body : body.slice(0, next + 1);

  if (!/^\s*apply_only:\s*$/m.test(dispatchBlock)) {
    findings.push(`${path}: workflow_dispatch declares no apply_only input`);
  }
}

/** The job's own `if:` line, or null when the job has none. */
function ifLineOf(path: string, jobId: string): string | null {
  const block = jobBlock(path, jobId);
  const match = block.match(/^\s*if:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

/**
 * #567's acceptance criteria: an apply-only `workflow_dispatch` "re-runs Host
 * Apply without a second upload." The upload jobs must therefore skip
 * themselves on that dispatch — asserted here as a negated `apply_only`
 * reference in the job's own `if:`, since that's the only place the behavior
 * lives (nothing else in the file pins it).
 */
function checkNoApplyOnlyReRun(path: string, jobId: string): void {
  const ifLine = ifLineOf(path, jobId);
  if (ifLine === null) return;
  if (!/!\s*inputs\.apply_only/.test(ifLine)) {
    findings.push(`${path}: ${jobId}'s if: does not skip on apply_only re-run`);
  }
}

/**
 * The other half of the same acceptance criterion: `host-apply` must still
 * be reachable on an apply-only dispatch even though the upload jobs it
 * `needs:` are skipped. Strip every negated `apply_only` reference out of the
 * `if:` line and confirm a positive one survives.
 */
function checkHostApplyRunsOnApplyOnly(path: string): void {
  const ifLine = ifLineOf(path, 'host-apply');
  if (ifLine === null) {
    findings.push(`${path}: host-apply declares no if: condition`);
    return;
  }
  const withoutNegated = ifLine.replace(/!\s*inputs\.apply_only/g, '');
  if (!/inputs\.apply_only/.test(withoutNegated)) {
    findings.push(
      `${path}: host-apply's if: has no path that runs on an apply_only-only dispatch`,
    );
  }
}

/** A job's own `concurrency:` block as `{ group, cancel }`, or null. */
interface JobConcurrency {
  group: string;
  cancel: boolean;
}

function concurrencyOf(path: string, jobId: string): JobConcurrency | null {
  const block = jobBlock(path, jobId);
  const match = block.match(
    /concurrency:\s*\n\s*group:\s*(\S+)\s*\n\s*cancel-in-progress:\s*(true|false)/,
  );
  if (!match) {
    findings.push(
      `${path}: ${jobId} declares no concurrency group with a cancel-in-progress`,
    );
    return null;
  }
  return { group: match[1], cancel: match[2] === 'true' };
}

/**
 * Staging's upload and apply must share one group that never cancels.
 *
 * ADR 0056 rules out cancelling an in-flight `prisma migrate deploy`, which a
 * non-cancelling group for `host-apply` alone achieves — but leaves the other
 * half open: with the upload in a separate group, a newer `main` run's
 * `deploy-backend` starts immediately and FTPs a new bundle into the same
 * `APP_ROOT` that the older run's `npm ci` and `prisma migrate deploy` are
 * still working in. One shared, queueing group closes both.
 *
 * `deploy-frontend` is deliberately outside this group: the web app has its
 * own root on the host and the job never touches `APP_ROOT`, so it may run
 * beside an apply. It holds its own `deploy-staging-web` group, which also
 * never cancels (an FTP upload cut off halfway leaves a half-written tree);
 * check-deploy-pipeline.ts asserts that, not this checker.
 */
/**
 * Staging's apply is operator-triggered, never automatic.
 *
 * SSH shell access on the hosting account is a manual toggle that reverts, so
 * an apply chained to the automatic trigger — the daily `schedule` since
 * ADR 0128, the `workflow_run` after a green `main` before it — would go red
 * every time the shell happened to be off, and a red apply that nobody reads
 * is how unapplied migrations shipped in the first place. Uploads still land
 * automatically; applying them is a deliberate act. Amends PRD #565 user
 * story 3, recorded on that issue.
 *
 * The guard has to be a *required* conjunct, so a substring match will not do:
 * an earlier condition mentioned `workflow_dispatch` too, inside an `||` that
 * let the automatic trigger through. Parenthesised groups are stripped first,
 * so what remains is the top level, and the guard must survive there with no
 * top-level `||` able to route around it.
 */
function checkStagingApplyIsDispatchOnly() {
  const ifLine = ifLineOf(STAGING, 'host-apply');
  if (ifLine === null) {
    findings.push(`${STAGING}: host-apply declares no if: condition`);
    return;
  }

  let topLevel = ifLine;
  let previous;
  do {
    previous = topLevel;
    topLevel = topLevel.replace(/\([^()]*\)/g, ' ');
  } while (topLevel !== previous);

  if (!/github\.event_name == 'workflow_dispatch'/.test(topLevel)) {
    findings.push(
      `${STAGING}: host-apply's if: does not require github.event_name == 'workflow_dispatch' at the top level - Staging must not apply automatically while shell access is a manual toggle`,
    );
  }
  if (topLevel.includes('||')) {
    findings.push(
      `${STAGING}: host-apply's if: has a top-level || that can route around the workflow_dispatch guard`,
    );
  }
}

function checkStagingApplyGroup() {
  const upload = concurrencyOf(STAGING, 'deploy-backend');
  const apply = concurrencyOf(STAGING, 'host-apply');
  if (!upload || !apply) return;

  if (upload.group !== apply.group) {
    findings.push(
      `${STAGING}: deploy-backend (${upload.group}) and host-apply (${apply.group}) hold different concurrency groups - an upload could land in APP_ROOT while an apply is still running there`,
    );
  }

  const declared: [string, JobConcurrency][] = [
    ['deploy-backend', upload],
    ['host-apply', apply],
  ];
  for (const [jobId, concurrency] of declared) {
    if (concurrency.cancel) {
      findings.push(
        `${STAGING}: ${jobId}'s cancel-in-progress is true, expected false - a newer run must queue behind an in-flight apply, never cancel it`,
      );
    }
  }
}

/**
 * The runner is ephemeral, so `StrictHostKeyChecking=accept-new` would trust
 * whatever key answered on every single run — trust-on-first-use with no
 * memory is not trust at all. The host keys are pinned as `SSH_KNOWN_HOSTS`.
 */
function checkSshHostKeyPinning(path: string): void {
  const block = jobBlock(path, 'host-apply');
  if (/StrictHostKeyChecking=(?!yes\b)/.test(block)) {
    findings.push(
      `${path}: host-apply's ssh does not set StrictHostKeyChecking=yes`,
    );
  }
  if (!/UserKnownHostsFile=/.test(block)) {
    findings.push(
      `${path}: host-apply's ssh sets no UserKnownHostsFile, so SSH_KNOWN_HOSTS is never consulted`,
    );
  }
}

/**
 * PRD #565 user story 30: a public Actions log is not a secret store. The SSH
 * step must capture its output to a file rather than stream it, and the job
 * must hand that file to the scrubber, which is what decides whether it prints.
 * Streaming would put a leaked value in the log before anything could grade it.
 */
/**
 * A malformed `SSH_PRIVATE_KEY` reaches the operator as `error in libcrypto`
 * and then `Permission denied (publickey,...)`, which reads as "the host
 * rejected our key" when in fact ssh never parsed one. That cost a live CI run
 * during #569 setup, on an environment where every other secret was correct.
 * The job must say which secret is wrong before it tries to connect.
 */
function checkSecretsAreValidatedBeforeUse(path: string): void {
  const block = jobBlock(path, 'host-apply');
  if (!/ssh-keygen -y -f "\$key_file"/.test(block)) {
    findings.push(
      `${path}: host-apply does not check that SSH_PRIVATE_KEY parses before connecting`,
    );
  }
  if (!/wc -c < "\$key_file"/.test(block)) {
    findings.push(
      `${path}: host-apply does not check that SSH_PRIVATE_KEY is non-empty`,
    );
  }
  if (!/wc -c < "\$known_hosts"/.test(block)) {
    findings.push(
      `${path}: host-apply does not check that SSH_KNOWN_HOSTS is non-empty`,
    );
  }
}

/**
 * The two verify probes must ask the question they claim to ask.
 *
 * Both got this wrong on the first live run (#569). `/docs` answers 301 to
 * `/docs/`, so without `-L` a healthy app reports a redirect. And LiteSpeed
 * rejects a bodyless, typeless POST with its own HTML 403 on every path, so
 * without a Content-Type the cron probe reports the host's opinion rather than
 * the API's — the exact "HTML 403" the PRD said must not be mistaken for the
 * API's own auth rejection.
 */
function checkProbeShapes(path: string): void {
  const block = jobBlock(path, 'host-apply');
  if (!/curl [^\n]*-L\b/.test(block)) {
    findings.push(
      `${path}: the /docs probe does not follow redirects, so a healthy app reports 301`,
    );
  }
  if (!/-H 'Content-Type: application\/json'/.test(block)) {
    findings.push(
      `${path}: the cron probe sends no Content-Type, so the host answers 403 before Node sees it`,
    );
  }
}

function checkLogIsScrubbedBeforePrinting(path: string): void {
  const block = jobBlock(path, 'host-apply');
  // Both stdout and stderr must land in the file. Matching the redirect alone
  // would also match the `: >` line that truncates it, which redirects nothing.
  if (!/>\s*"\$RUNNER_TEMP\/host-apply\.log"\s*2>&1/.test(block)) {
    findings.push(
      `${path}: host-apply's ssh step streams its output instead of capturing it to host-apply.log`,
    );
  }
  if (!/scrub-host-apply-log\.mjs/.test(block)) {
    findings.push(
      `${path}: host-apply never runs scrub-host-apply-log.mjs over the captured output`,
    );
  }
}

const secretNamesIn = (text: string): string[] =>
  [...text.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]);

/**
 * Checks both directions of the allowlist (PRD #565 Testing Decisions:
 * "extra or missing secrets.* names fail"): a name the job references that
 * isn't in `HOST_APPLY_SECRET_NAMES`, and a name in `HOST_APPLY_SECRET_NAMES`
 * the job never references at all — the latter catches a step accidentally
 * dropping, say, `API_ORIGIN` and silently losing the verify step's target.
 */
function checkSecretAllowlist(path: string): void {
  const block = jobBlock(path, 'host-apply');
  const referenced = new Set(secretNamesIn(block));
  const allowed = new Set(HOST_APPLY_SECRET_NAMES);

  for (const name of referenced) {
    if (!allowed.has(name)) {
      findings.push(
        `${path}: host-apply references secrets.${name}, which is not in HOST_APPLY_SECRET_NAMES`,
      );
    }
  }

  for (const name of allowed) {
    if (!referenced.has(name)) {
      findings.push(
        `${path}: host-apply never references secrets.${name}, which HOST_APPLY_SECRET_NAMES requires`,
      );
    }
  }
}

function checkNoDatabaseUrlSecret(path: string): void {
  if (/secrets\.DATABASE_URL\b/.test(read(path))) {
    findings.push(
      `${path}: references secrets.DATABASE_URL - DATABASE_URL must never be a GitHub secret`,
    );
  }
}

/**
 * ADR 0133: reports are marked Fixed only once the Release is live, so the
 * marking job waits for Host Apply and the frontend deploy. `always()` would
 * run it after either failed or was skipped.
 */
function checkReleaseMarkJob(path: string): void {
  const job = 'mark-feedback-release';
  if (!new RegExp(`^ {2}${job}:\\s*$`, 'm').test(read(path))) {
    findings.push(`${path}: has no ${job} job (ADR 0133 Release marking)`);
    return;
  }
  const block = jobBlock(path, job);
  const needs = block.match(/^\s*needs:\s*(.+)$/m)?.[1] ?? '';
  const needed = needs
    .replace(/[[\]]/g, '')
    .split(',')
    .map((id) => id.trim());
  for (const upstream of ['host-apply', 'deploy-frontend']) {
    if (!needed.includes(upstream)) {
      findings.push(
        `${path}: ${job}'s needs (${needs.trim() || 'none'}) does not include ${upstream}`,
      );
    }
  }
  if (/always\(\)/.test(ifLineOf(path, job) ?? '')) {
    findings.push(
      `${path}: ${job}'s if: uses always(), so it could mark after a failed deploy`,
    );
  }
  if (
    !/^\s*run:\s*node tools\/scripts\/mark-feedback-release\.mjs\s*$/m.test(
      block,
    )
  ) {
    findings.push(
      `${path}: ${job} does not run node tools/scripts/mark-feedback-release.mjs`,
    );
  }
}

checkEnvironment(STAGING, 'staging');
checkEnvironment(PRODUCTION, 'production');
checkNeedsBackendUpload(STAGING);
checkNeedsBackendUpload(PRODUCTION);
checkApplyOnlyDispatchInput(STAGING);
checkApplyOnlyDispatchInput(PRODUCTION);
checkNoApplyOnlyReRun(STAGING, 'deploy-backend');
checkNoApplyOnlyReRun(STAGING, 'deploy-frontend');
checkNoApplyOnlyReRun(PRODUCTION, 'deploy-backend');
checkNoApplyOnlyReRun(PRODUCTION, 'deploy-frontend');
checkHostApplyRunsOnApplyOnly(STAGING);
checkHostApplyRunsOnApplyOnly(PRODUCTION);
checkStagingApplyGroup();
checkStagingApplyIsDispatchOnly();
checkSshHostKeyPinning(STAGING);
checkSshHostKeyPinning(PRODUCTION);
checkSecretsAreValidatedBeforeUse(STAGING);
checkSecretsAreValidatedBeforeUse(PRODUCTION);
checkProbeShapes(STAGING);
checkProbeShapes(PRODUCTION);
checkLogIsScrubbedBeforePrinting(STAGING);
checkLogIsScrubbedBeforePrinting(PRODUCTION);
checkSecretAllowlist(STAGING);
checkSecretAllowlist(PRODUCTION);
checkNoDatabaseUrlSecret(STAGING);
checkNoDatabaseUrlSecret(PRODUCTION);
checkReleaseMarkJob(PRODUCTION);

if (findings.length > 0) {
  console.error(
    `host-apply-workflow: ${findings.length} finding(s) — the Host Apply wiring drifted from its contract\n`,
  );
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}

console.log(
  'host-apply-workflow: staging and production Host Apply wiring in sync',
);
