/**
 * Decisions behind Staging's web deploy (issue #1138, ADR 0128).
 *
 * The Staging web app runs on a host where nothing automatic may open a shell:
 * the bundle arrives by FTP, the app restarts when `tmp/restart.txt` changes,
 * and an operator runs "Run NPM Install" by hand. This module makes the
 * decisions `deploy-staging.yml` needs, with every read of the host, of git
 * and of the Actions API injected so they run under test without any of them:
 *
 *   - whether the web address and the API address are on the same site;
 *   - whether the schedule should deploy at all, or would repeat or roll
 *     back what Staging already holds — its web app or its backend;
 *   - whether an upload may restart the app, or an install is owed first;
 *   - whether the build that answers is the build just uploaded.
 *
 * Two reads of the host mean different things, and the plan depends on the
 * difference. Files under the bundle's `public/` are served from disk, so
 * `/deploy-state.json` says what was last UPLOADED. The HTML of `/login` comes
 * from the Node process, so it says what is RUNNING. Neither needs a shell.
 * The second holds only while the root layout exports
 * `dynamic = 'force-dynamic'`: a prerendered `/login` would be read from disk
 * and say what was uploaded, not what is running.
 *
 * A host that does not answer is not a host that holds nothing. A missing
 * state file (404) is the first deploy; a state file that cannot be read is
 * unknown, and both the schedule and the plan stop on it rather than guess.
 *
 * No function here puts an origin in a message: both addresses are GitHub
 * Environment secrets (ADR 0056), and a message names the path only.
 *
 * Run the tests with: yarn staging-web:test
 */
import { createHash } from 'node:crypto';

import { UPLOAD_JOB, type JobRecord } from './staging-host-apply-guard.ts';

/** A page the Node process renders, so its HTML carries the running build id. */
export const RUNNING_BUILD_PATH = '/login';
/** A static file in the bundle's `public/`, so it reflects the last upload. */
export const DEPLOY_STATE_PATH = '/deploy-state.json';
export const SERVICE_WORKER_PATH = '/sw.js';

export const PLAN_RESTART = 'restart';
export const PLAN_INSTALL_OWED = 'install-owed';

/**
 * The two headers `/sw.js` must carry (ADR 0127), stated three times: here,
 * in `apps/web/next.config.js` for a host that renders through
 * Next.js, and in the snippet `apps/web/deploy/sw-headers.htaccess`,
 * which an operator appends once to the host's own `.htaccess` where
 * `public/` is served from disk. The test suite reads both files and fails
 * when either stops containing these exact values.
 */
export const SERVICE_WORKER_CACHE_CONTROL =
  'no-cache, no-store, must-revalidate';
export const SERVICE_WORKER_CSP = "default-src 'self'; script-src 'self'";

export const SCHEDULE_PROCEED = 'proceed';
export const SCHEDULE_SKIP_SERVING = 'skip-serving';
export const SCHEDULE_SKIP_NEWER = 'skip-newer';
export const SCHEDULE_SKIP_PREDATES = 'skip-predates';
export const SCHEDULE_FAIL_UPLOADED_NOT_RUNNING = 'fail-uploaded-not-running';
export const SCHEDULE_FAIL_UNREACHABLE = 'fail-unreachable';
export const SCHEDULE_FAIL_HEADERS = 'fail-headers';

/** What a scheduled run decided to do with the newest green commit. */
export type ScheduleDecision =
  | typeof SCHEDULE_PROCEED
  | typeof SCHEDULE_SKIP_SERVING
  | typeof SCHEDULE_SKIP_NEWER
  | typeof SCHEDULE_SKIP_PREDATES
  | typeof SCHEDULE_FAIL_UPLOADED_NOT_RUNNING
  | typeof SCHEDULE_FAIL_UNREACHABLE
  | typeof SCHEDULE_FAIL_HEADERS;

/** What a read of `/deploy-state.json` settled on. */
export const STATE_PRESENT = 'present';
/** 404: nothing was ever uploaded by this deploy. The first deploy. */
export const STATE_NONE = 'none';
/** No answer, a server error, or a body that is not a state file: unknown. */
export const STATE_UNREADABLE = 'unreadable';

/** What a read of `/deploy-state.json` settled on. */
export type StateStatus =
  | typeof STATE_PRESENT
  | typeof STATE_NONE
  | typeof STATE_UNREADABLE;

/**
 * The host as this module reads it: a `fetch`-shaped call, and only the three
 * parts of a response the decisions here turn on.
 */
export interface FetchedResponse {
  status: number;
  text: () => Promise<string>;
  headers: { get: (name: string) => string | null };
}

export type Fetcher = (
  url: URL,
  init: { headers: Record<string, string> },
) => Promise<FetchedResponse>;

/** A sleep, injected so a test never waits. */
export type Sleep = (ms: number) => Promise<unknown>;

/** The file a commit must carry to produce a build named after it. */
export const BUILD_ID_CONFIG = 'apps/web/next.config.js';
export const BUILD_ID_VARIABLE = 'WEB_BUILD_ID';

const COMMIT = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;

/** Refusal raised by a guard in this module. Never carries an origin. */
export class StagingWebDeployRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StagingWebDeployRefusal';
  }
}

/**
 * The last two DNS labels of an origin's hostname.
 *
 * A rule of thumb, not the Public Suffix List: it is wrong for a suffix that
 * is itself two labels (`example.co.uk` and `other.co.uk` both read as
 * `co.uk`), and for a shared-hosting suffix such as `vercel.app`, where two
 * different projects read as one site. It is right for the case it guards — a
 * web app and an API on subdomains of one domain the operator owns.
 */
export function siteOf(origin: string, label = 'origin'): string {
  let hostname: string;
  try {
    hostname = new URL(origin).hostname.toLowerCase();
  } catch {
    throw new StagingWebDeployRefusal(`${label} is not a valid URL`);
  }
  const labels = hostname.split('.').filter(Boolean);
  if (labels.length === 0) {
    throw new StagingWebDeployRefusal(`${label} has no hostname`);
  }
  return labels.slice(-2).join('.');
}

export function isSameSite(webOrigin: string, apiOrigin: string): boolean {
  return (
    siteOf(webOrigin, 'the web origin') === siteOf(apiOrigin, 'the API origin')
  );
}

/**
 * The commit named by Staging's latest successful backend upload, or null.
 *
 * `jobs` is what `normalizeJobs` in staging-host-apply-guard.ts returns for
 * recent `Deploy Staging` runs. Only a dispatched run names its commit, so
 * null means either that nothing was uploaded in the window read or that the
 * latest upload was a scheduled one — which the schedule may follow freely,
 * since it only ever uploads the newest green commit.
 */
export function latestBackendUploadSha(
  jobs: readonly JobRecord[],
): string | null {
  const latest = jobs
    .filter((job) => job.name === UPLOAD_JOB && job.conclusion === 'success')
    .sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt))
    .at(-1);
  return latest?.headSha ?? null;
}

/**
 * Decides what a scheduled run does with the newest green `main` commit.
 *
 * The schedule may only move Staging forward, and only once per commit. It
 * looks at both halves: what the web host holds, and what the latest backend
 * upload was. Reading the web host alone would miss a dispatch whose backend
 * landed and whose web job then failed; the schedule would upload the backend
 * again without naming a commit, which makes the Cut guard refuse the
 * dispatched commit, and could land an older backend over newer migrations.
 * In order:
 *
 *   - the commit cannot name its own build (it predates this deploy): stop,
 *     green, before the backend is uploaded for a web job that must fail;
 *   - the state file cannot be read: stop, red. Unknown is not "nothing";
 *   - the running process serves the commit: nothing to deploy — but red if
 *     `/sw.js` lacks its headers, or a run that failed only on them would be
 *     followed by green runs with nothing fixed;
 *   - the commit is already uploaded, as the web bundle or as the backend,
 *     and is not running: uploading again fixes nothing. Stop, red;
 *   - Staging holds a commit strictly newer than the green one, as either
 *     half: a dispatch put it there and the schedule does not roll it back;
 *   - otherwise deploy.
 *
 * The two ancestry inputs are git's answers, and false when git does not know
 * the other commit: an unknown commit is not evidence of a newer one.
 */
export interface ScheduleFacts {
  greenSha: string;
  buildsNamedBundle: boolean;
  stateStatus: StateStatus;
  runningServesGreen: boolean;
  serviceWorkerHeadersOk: boolean;
  uploadedSha: string | null;
  backendSha: string | null;
  greenIsStrictAncestorOfUploaded: boolean;
  greenIsStrictAncestorOfBackend: boolean;
}

export function decideSchedule({
  greenSha,
  buildsNamedBundle,
  stateStatus,
  runningServesGreen,
  serviceWorkerHeadersOk,
  uploadedSha,
  backendSha,
  greenIsStrictAncestorOfUploaded,
  greenIsStrictAncestorOfBackend,
}: ScheduleFacts): ScheduleDecision {
  if (!buildsNamedBundle) return SCHEDULE_SKIP_PREDATES;
  if (stateStatus === STATE_UNREADABLE) return SCHEDULE_FAIL_UNREACHABLE;
  if (runningServesGreen) {
    return serviceWorkerHeadersOk
      ? SCHEDULE_SKIP_SERVING
      : SCHEDULE_FAIL_HEADERS;
  }
  if (uploadedSha === greenSha || backendSha === greenSha) {
    return SCHEDULE_FAIL_UPLOADED_NOT_RUNNING;
  }
  if (
    (uploadedSha !== null && greenIsStrictAncestorOfUploaded) ||
    (backendSha !== null && greenIsStrictAncestorOfBackend)
  ) {
    return SCHEDULE_SKIP_NEWER;
  }
  return SCHEDULE_PROCEED;
}

/** Whether a decision lets the later jobs run, and what the run's summary says. */
export interface ScheduleOutcome {
  proceed: boolean;
  failed: boolean;
  summary: string | null;
}

export const SCHEDULE_OUTCOMES = Object.freeze({
  [SCHEDULE_PROCEED]: { proceed: true, failed: false, summary: null },
  [SCHEDULE_SKIP_SERVING]: {
    proceed: false,
    failed: false,
    summary: 'Staging already serves that commit. Nothing was uploaded.',
  },
  [SCHEDULE_SKIP_NEWER]: {
    proceed: false,
    failed: false,
    summary:
      'Staging holds a newer commit (dispatched); the schedule does not roll it back. Nothing was uploaded.',
  },
  [SCHEDULE_SKIP_PREDATES]: {
    proceed: false,
    failed: false,
    summary:
      'The newest green commit predates the Staging web deploy; nothing was uploaded.',
  },
  [SCHEDULE_FAIL_UPLOADED_NOT_RUNNING]: {
    proceed: false,
    failed: true,
    summary:
      'That commit is already uploaded to Staging by an earlier run, but the web app is not serving it. ' +
      'If an install is owed, open the Staging web app under **Setup Node.js App** in cPanel, click **Run NPM Install**, then **Restart**. ' +
      'Otherwise dispatch `Deploy Staging` in full at that commit. Nothing was uploaded.',
  },
  [SCHEDULE_FAIL_UNREACHABLE]: {
    proceed: false,
    failed: true,
    summary: 'The Staging web address did not answer; nothing was uploaded.',
  },
  [SCHEDULE_FAIL_HEADERS]: {
    proceed: false,
    failed: true,
    summary:
      'Staging serves that commit, but `/sw.js` does not carry its two headers. ' +
      "Append the block from `apps/web/deploy/sw-headers.htaccess` to the host's `.htaccess`. Nothing was uploaded.",
  },
} as const satisfies Record<ScheduleDecision, ScheduleOutcome>);

/**
 * Gathers what `decideSchedule` needs, asking only for what the decision can
 * still turn on, and decides. Everything it reads is injected:
 *
 *   - `buildsNamedBundle(sha)`: whether that commit's Next.js config reads the
 *     build-id variable;
 *   - `readBackendJobs()`: normalized jobs of recent `Deploy Staging` runs;
 *   - `isStrictAncestor(a, b)`: git's answer, false for an unknown commit.
 *
 * An address that is unset or malformed is unreadable, like one that does
 * not answer.
 */
export interface PlanScheduleInput {
  fetcher: Fetcher;
  webOrigin: string;
  greenSha: string;
  /** Whether that commit's Next.js config reads the build-id variable. */
  buildsNamedBundle: (sha: string) => boolean | Promise<boolean>;
  /** Normalized jobs of recent `Deploy Staging` runs. */
  readBackendJobs: () => JobRecord[] | Promise<JobRecord[]>;
  /** git's answer, false for an unknown commit. */
  isStrictAncestor: (a: string, b: string) => boolean | Promise<boolean>;
  sleep?: Sleep;
}

export async function planSchedule({
  fetcher,
  webOrigin,
  greenSha,
  buildsNamedBundle,
  readBackendJobs,
  isStrictAncestor,
  sleep = realSleep,
}: PlanScheduleInput): Promise<ScheduleDecision> {
  if (!COMMIT.test(greenSha)) {
    throw new StagingWebDeployRefusal('the commit is not a 40-character SHA');
  }

  const facts: ScheduleFacts = {
    greenSha,
    buildsNamedBundle: Boolean(await buildsNamedBundle(greenSha)),
    stateStatus: STATE_UNREADABLE,
    runningServesGreen: false,
    serviceWorkerHeadersOk: false,
    uploadedSha: null,
    backendSha: null,
    greenIsStrictAncestorOfUploaded: false,
    greenIsStrictAncestorOfBackend: false,
  };
  if (!facts.buildsNamedBundle) return decideSchedule(facts);

  try {
    siteOf(webOrigin, 'the web origin');
  } catch {
    return decideSchedule(facts);
  }

  const [runningHtml, uploaded] = await Promise.all([
    readRunningHtml(fetcher, webOrigin, { sleep }),
    readUploadedState(fetcher, webOrigin, { sleep }),
  ]);
  facts.stateStatus = uploaded.status;
  facts.uploadedSha = uploaded.state?.sha ?? null;
  if (facts.stateStatus === STATE_UNREADABLE) return decideSchedule(facts);

  facts.runningServesGreen = (runningHtml ?? '').includes(greenSha);
  if (facts.runningServesGreen) {
    facts.serviceWorkerHeadersOk =
      (await readServiceWorkerProblems(fetcher, webOrigin)).length === 0;
    return decideSchedule(facts);
  }

  facts.backendSha = latestBackendUploadSha(await readBackendJobs());
  const newerThanGreen = async (sha: string | null) =>
    sha !== null && sha !== greenSha
      ? Boolean(await isStrictAncestor(greenSha, sha))
      : false;
  facts.greenIsStrictAncestorOfUploaded = await newerThanGreen(
    facts.uploadedSha,
  );
  facts.greenIsStrictAncestorOfBackend = await newerThanGreen(facts.backendSha);

  return decideSchedule(facts);
}

/** Where a bundle would carry an `.htaccess` into the host's document root. */
export const BUNDLE_HTACCESS = 'public/.htaccess';

/**
 * Refuses a bundle that would overwrite the host's own `.htaccess`.
 *
 * The web app's document root on the host is the bundle's `public/` folder,
 * and the host keeps its own `.htaccess` there: the configuration that starts
 * the app. An upload replaces a file of the same name, so a bundle carrying
 * one takes the app down. `bundleFiles` is the bundle's file list, relative
 * to its root, however the caller gathered it.
 */
export function assertBundleKeepsHostHtaccess(
  bundleFiles: readonly string[],
): void {
  const normalized = bundleFiles.map((file) => file.replaceAll('\\', '/'));
  if (normalized.includes(BUNDLE_HTACCESS)) {
    throw new StagingWebDeployRefusal(
      `the bundle contains ${BUNDLE_HTACCESS}. The host's document root is that folder and holds the host's own .htaccess; uploading this one would overwrite it and take the app down. ` +
        'Remove it from apps/web/public. Nothing was uploaded.',
    );
  }
}

/** sha256 over the bundle's `dependencies`, keys sorted so order never matters. */
export function hashDependencies(packageJson: {
  dependencies?: Record<string, unknown>;
}): string {
  const dependencies = packageJson?.dependencies ?? {};
  const sorted = Object.keys(dependencies)
    .sort()
    .map((name) => [name, String(dependencies[name])]);
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

/** The state file this module writes to the bundle's `public/`. */
export interface DeployState {
  sha: string;
  depsHash: string;
  installedDepsHash: string | null;
}

/** A state file this module wrote, or null for anything else. */
export function parseDeployState(parsed: unknown): DeployState | null {
  if (parsed === null || typeof parsed !== 'object') return null;
  // The body comes off the host: every field is read through its own guard.
  const value = parsed as {
    sha?: unknown;
    depsHash?: unknown;
    installedDepsHash?: unknown;
  };
  if (typeof value.sha !== 'string' || !COMMIT.test(value.sha)) return null;
  if (typeof value.depsHash !== 'string' || !HASH.test(value.depsHash)) {
    return null;
  }
  const installed = value.installedDepsHash;
  return {
    sha: value.sha,
    depsHash: value.depsHash,
    installedDepsHash:
      typeof installed === 'string' && HASH.test(installed) ? installed : null,
  };
}

/**
 * Decides whether this upload may restart the app.
 *
 * The host cannot be asked what is in its `node_modules`, so "installed" is
 * an inference, not a proof: when the running process serves the build that
 * was last uploaded, that build's dependency list is taken as installed. It
 * can be wrong — an app may start on an older patch version of a package, and
 * an operator may install without restarting — and the probe after the
 * restart is what catches a build that does not come up. When the process
 * serves an older build, the last list an earlier run inferred is carried
 * forward unchanged. With no state at all, nothing is known and an install is
 * owed — which is the first deploy.
 */
export interface DecidePlanInput {
  sha: string;
  depsHash: string;
  runningHtml: string | null;
  uploadedState: DeployState | null;
}

/** Whether this upload may restart the app, and the state to write with it. */
export interface DeployPlan {
  action: typeof PLAN_RESTART | typeof PLAN_INSTALL_OWED;
  state: DeployState;
}

export function decidePlan({
  sha,
  depsHash,
  runningHtml,
  uploadedState,
}: DecidePlanInput): DeployPlan {
  let installed: string | null = null;
  if (uploadedState) {
    installed = (runningHtml ?? '').includes(uploadedState.sha)
      ? uploadedState.depsHash
      : uploadedState.installedDepsHash;
  }

  return {
    action: installed === depsHash ? PLAN_RESTART : PLAN_INSTALL_OWED,
    state: { sha, depsHash, installedDepsHash: installed },
  };
}

const NO_CACHE = { 'cache-control': 'no-cache' };

async function get(fetcher: Fetcher, origin: string, path: string) {
  return fetcher(new URL(path, origin), { headers: NO_CACHE });
}

const realSleep: Sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Reads settle after this many tries: one slow answer is not an outage. */
export const READ_ATTEMPTS = 3;
const READ_BACKOFF_MS = 2000;

/** Runs `read` until it returns something other than `retry`, or tries run out. */
async function settle<T>(
  read: () => Promise<T>,
  retry: T,
  { attempts, sleep }: { attempts: number; sleep: Sleep },
): Promise<T> {
  let result = retry;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    result = await read();
    if (result !== retry) return result;
    if (attempt < attempts) await sleep(READ_BACKOFF_MS * attempt);
  }
  return result;
}

/**
 * The running process's HTML, or null when it does not answer with a page.
 * Not answering is not an error here: with a readable state file it means
 * "not serving", which is what a stopped or restarting app looks like.
 */
export interface ReadOptions {
  attempts?: number;
  sleep?: Sleep;
}

export async function readRunningHtml(
  fetcher: Fetcher,
  webOrigin: string,
  { attempts = READ_ATTEMPTS, sleep = realSleep }: ReadOptions = {},
): Promise<string | null> {
  return settle(
    async () => {
      try {
        const response = await get(fetcher, webOrigin, RUNNING_BUILD_PATH);
        return response.status === 200 ? await response.text() : null;
      } catch {
        return null;
      }
    },
    null,
    { attempts, sleep },
  );
}

/** One read of `/deploy-state.json`: which of the three outcomes, and what it held. */
export interface UploadedState {
  status: StateStatus;
  state: DeployState | null;
}

const UNREADABLE: UploadedState = Object.freeze({
  status: STATE_UNREADABLE,
  state: null,
});

/**
 * The last uploaded state, as one of three outcomes that must not be
 * confused: present, none (404 — the first deploy), or unreadable (no
 * answer, a timeout, a server error, or a 200 whose body is not a state
 * file). Only unreadable is retried.
 */
export async function readUploadedState(
  fetcher: Fetcher,
  webOrigin: string,
  { attempts = READ_ATTEMPTS, sleep = realSleep }: ReadOptions = {},
): Promise<UploadedState> {
  return settle(
    async () => {
      try {
        const response = await get(fetcher, webOrigin, DEPLOY_STATE_PATH);
        if (response.status === 404) return { status: STATE_NONE, state: null };
        if (response.status !== 200) return UNREADABLE;
        const state = parseDeployState(JSON.parse(await response.text()));
        return state ? { status: STATE_PRESENT, state } : UNREADABLE;
      } catch {
        return UNREADABLE;
      }
    },
    UNREADABLE,
    { attempts, sleep },
  );
}

/** Refuses before any request, so a bad input never reads as "host is down". */
function assertDeployInputs(webOrigin: string, sha: string): void {
  siteOf(webOrigin, 'the web origin');
  if (!COMMIT.test(sha)) {
    throw new StagingWebDeployRefusal('the commit is not a 40-character SHA');
  }
}

/**
 * Reads the host and decides the plan. Refuses when the state file cannot be
 * read: writing a fresh state over an unknown one would forget which
 * dependency list is installed, and restart or withhold on a guess.
 */
export interface PlanDeployInput {
  fetcher: Fetcher;
  webOrigin: string;
  sha: string;
  packageJson: { dependencies?: Record<string, unknown> };
  sleep?: Sleep;
}

export async function planDeploy({
  fetcher,
  webOrigin,
  sha,
  packageJson,
  sleep = realSleep,
}: PlanDeployInput): Promise<DeployPlan> {
  assertDeployInputs(webOrigin, sha);
  const [runningHtml, uploaded] = await Promise.all([
    readRunningHtml(fetcher, webOrigin, { sleep }),
    readUploadedState(fetcher, webOrigin, { sleep }),
  ]);
  if (uploaded.status === STATE_UNREADABLE) {
    throw new StagingWebDeployRefusal(
      `the Staging web address did not answer for ${DEPLOY_STATE_PATH}, so what is installed there is unknown. Nothing was uploaded.`,
    );
  }
  return decidePlan({
    sha,
    depsHash: hashDependencies(packageJson),
    runningHtml,
    uploadedState: uploaded.state,
  });
}

/**
 * What is wrong with the headers `/sw.js` came back with, as messages.
 *
 * The service worker is a file in `public/`, so on a host that serves that
 * folder from disk the `headers()` rule in `next.config.js` never runs and
 * a block in the host's own `.htaccess`, taken from the snippet, is what sets
 * these (ADR 0127). The values are compared
 * with the expected ones, not merely required to be present: a permissive
 * policy is a header too.
 */
export function findServiceWorkerHeaderProblems(headers: {
  get: (name: string) => string | null;
}): string[] {
  const problems: string[] = [];
  for (const [name, expected] of [
    ['Cache-Control', SERVICE_WORKER_CACHE_CONTROL],
    ['Content-Security-Policy', SERVICE_WORKER_CSP],
  ]) {
    const actual = headers.get(name);
    if (actual === null) {
      problems.push(`${SERVICE_WORKER_PATH} has no ${name}`);
    } else if (normalizeHeader(actual) !== normalizeHeader(expected)) {
      // The value the host sent is never repeated: a host-level policy can
      // name hostnames, and only exact secrets are masked in a log (ADR 0056).
      problems.push(
        `${SERVICE_WORKER_PATH} ${name} differs from the expected value`,
      );
    }
  }
  return problems;
}

/** Fetches `/sw.js` and returns what is wrong with it; empty when nothing is. */
export async function readServiceWorkerProblems(
  fetcher: Fetcher,
  webOrigin: string,
): Promise<string[]> {
  try {
    const response = await get(fetcher, webOrigin, SERVICE_WORKER_PATH);
    if (response.status !== 200) {
      return [`${SERVICE_WORKER_PATH} answered ${response.status}`];
    }
    return findServiceWorkerHeaderProblems(response.headers);
  } catch {
    return [`${SERVICE_WORKER_PATH} could not be fetched`];
  }
}

/**
 * Exact but for what a server may change without changing the meaning:
 * surrounding and repeated spaces, and letter case (directive names and CSP
 * keywords such as 'self' are case-insensitive). An added or missing directive
 * is a different value.
 */
const normalizeHeader = (value: string) =>
  value.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Waits for the uploaded build to answer, then checks the service worker's
 * headers. Only the running process counts: a static file would say the build
 * is uploaded, which the FTP step already knows.
 */
export interface ProbeDeployInput {
  fetcher: Fetcher;
  webOrigin: string;
  sha: string;
  timeoutSeconds?: number;
  intervalSeconds?: number;
  sleep?: Sleep;
  now?: () => number;
}

export type ProbeResult =
  | { ok: true; attempts: number }
  | { ok: false; reason: string };

export async function probeDeploy({
  fetcher,
  webOrigin,
  sha,
  timeoutSeconds = 300,
  intervalSeconds = 10,
  sleep = realSleep,
  now = Date.now,
}: ProbeDeployInput): Promise<ProbeResult> {
  assertDeployInputs(webOrigin, sha);

  const deadline = now() + timeoutSeconds * 1000;
  let attempts = 0;
  let live = false;
  for (;;) {
    attempts += 1;
    // One try per poll: the loop is the retry.
    const html = await readRunningHtml(fetcher, webOrigin, { attempts: 1 });
    if (html?.includes(sha)) {
      live = true;
      break;
    }
    if (now() + intervalSeconds * 1000 > deadline) break;
    await sleep(intervalSeconds * 1000);
  }

  if (!live) {
    return {
      ok: false,
      reason:
        `${RUNNING_BUILD_PATH} did not answer from build ${sha.slice(0, 7)} within ${timeoutSeconds}s ` +
        `(${attempts} attempt(s)). The bundle is uploaded but the running process is not serving it.`,
    };
  }

  const problems = await readServiceWorkerProblems(fetcher, webOrigin);
  if (problems.length > 0) {
    return { ok: false, reason: problems.join('; ') };
  }
  return { ok: true, attempts };
}
