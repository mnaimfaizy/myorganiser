#!/usr/bin/env node
// Asserts that docs/deployment/release-pipeline.html still describes the pipeline
// the workflows implement.
//
//   node tools/scripts/check-deploy-pipeline.mjs [repoRoot]
//   node tools/scripts/check-deploy-pipeline.mjs --print   # show what each extractor resolved
//
// The page is a hand-designed diagram, so its prose cannot be generated. What can
// be checked is the set of constants it asserts: the embedded
// #release-pipeline-manifest must agree with .github/workflows/*.yml, package.json
// and tools/scripts/release.mjs. A Staging schedule that moves, an approval gate
// removed from a deploy job, or a frontend that stops going to cPanel then fails
// here instead of leaving a confidently wrong deployment reference in docs/.
//
// Direction: both ways, between the manifest and the extractors. Every manifest
// key must match what its extractor reads from source, a manifest key with no
// extractor is a finding, and an extractor with no manifest key is a finding.
// Not asserted: the page's prose and diagrams. Nothing ties a sentence to the
// manifest value it restates, so a correct manifest under stale prose passes.
//
// Nothing here is an exported `const` — these are YAML keys, shell guards inside
// `run:` blocks, and a version string in a heredoc. Each value therefore gets a
// named extractor rather than a shared regex, and `--print` runs them all and
// shows what they resolved, which is how you check one after editing it.
//
// Two rules exist because of how this page is read rather than how it is written:
// the manifest is parsed out of raw source with no comment masking (its own values
// contain `/*`, and masking them is how the design-hygiene gate lost sight of this
// block entirely), and a manifest key with no extractor is a finding — a claim
// nobody checks is the unwired-gate defect one layer in (ADR 0043).
//
// Exit 0 = in sync. Exit 1 = drift (fix the page, or the value it asserts).
// Exit 2 = the check could not run.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const printMode = args.includes('--print');
const ROOT = resolve(args.find((a) => !a.startsWith('--')) ?? '.');

const PAGE = join('docs', 'deployment', 'release-pipeline.html');
const MANIFEST_ID = 'release-pipeline-manifest';

const WORKFLOWS = join('.github', 'workflows');
const CI = join(WORKFLOWS, 'ci.yml');
const STAGING = join(WORKFLOWS, 'deploy-staging.yml');
const PRODUCTION = join(WORKFLOWS, 'deploy-production.yml');
const DISPATCHER = join(WORKFLOWS, 'dispatch-production-deploy.yml');
const PUBLISH = join(WORKFLOWS, 'publish-github-release.yml');
const PACKAGE_JSON = 'package.json';
const RELEASE_SCRIPT = join('tools', 'scripts', 'release.mjs');
const STAGING_HOST_APPLY_GUARD = join(
  'tools',
  'scripts',
  'lib',
  'staging-host-apply-guard.ts',
);

/** The workflows whose runners the page claims share one Node pin. The monthly
 *  model audit also pins Node 22 and is deliberately not one of them: it is not
 *  part of the release pipeline, and counting it is how the brief said 15. */
const PIPELINE_NODE_FILES = [CI, STAGING, PRODUCTION];

const fail = (msg) => {
  console.error(`deploy-pipeline: ${msg}`);
  process.exit(2);
};

const fileCache = new Map();
const read = (path) => {
  if (!fileCache.has(path)) {
    const full = join(ROOT, path);
    if (!existsSync(full)) fail(`${path} not found`);
    fileCache.set(path, readFileSync(full, 'utf8'));
  }
  return fileCache.get(path);
};

/** Pulls one capture group out of a file, failing loudly rather than returning undefined. */
const capture = (path, pattern, label) => {
  const match = read(path).match(pattern);
  if (!match) fail(`could not read ${label} from ${path}`);
  return match[1];
};

/**
 * Slices one job out of a workflow. Job ids are the only two-space keys below
 * `jobs:`, but `on:` has two-space keys too (`push:`, `workflow_dispatch:`), so
 * the search starts after the `jobs:` line rather than at the top of the file.
 */
const jobBlock = (path, jobId) => {
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

/** Every two-space job id in a workflow, in file order. */
const jobIds = (path) => {
  const source = read(path);
  const jobsAt = source.search(/^jobs:\s*$/m);
  if (jobsAt === -1) fail(`${path} has no top-level jobs: key`);
  return [
    ...source.slice(jobsAt).matchAll(/^ {2}([a-z0-9][a-z0-9-]*):\s*$/gm),
  ].map((m) => m[1]);
};

/**
 * Collapses repeated occurrences of a value that the page states once. A second
 * distinct value means the page cannot be right about both, so it fails here
 * rather than silently reporting whichever came first.
 */
const theOnly = (values, label) => {
  const distinct = [...new Set(values)];
  if (distinct.length === 0) fail(`found no ${label}`);
  if (distinct.length > 1) {
    fail(
      `${label} is not a single value any more: found ${distinct
        .map((v) => JSON.stringify(v))
        .join(', ')} — the page states one`,
    );
  }
  return distinct[0];
};

const allMatches = (path, pattern) =>
  [...read(path).matchAll(pattern)].map((m) => m[1]);

/**
 * Which host a deploy job ships a frontend to, read from what it actually calls.
 * cPanel over FTP is the only target either environment has (ADR 0128); a job
 * that stops calling the FTP action reads as `not-cpanel-ftp`, which no page
 * may claim, so it surfaces as drift naming the key.
 */
const frontendTarget = (path) =>
  /^\s*uses:\s*samkirkland\/ftp-deploy-action/m.test(
    jobBlock(path, 'deploy-frontend'),
  )
    ? 'cpanel-ftp'
    : 'not-cpanel-ftp';

/** The first `local-dir:` a job hands the FTP action: the bundle it ships. */
const artifactDir = (path, jobId) =>
  jobBlock(path, jobId).match(/^\s*local-dir:\s*(\S+)/m)?.[1] ??
  fail(`${path} ${jobId} declares no local-dir`);

/** The workflow's top-level `on:` block, up to the next top-level key. */
const triggerBlock = (path) => {
  const source = read(path);
  const on = source.match(/^on:\s*$/m);
  if (!on) fail(`${path} has no top-level on: key`);
  const body = source.slice(on.index + on[0].length);
  const next = body.search(/^\S/m);
  return next === -1 ? body : body.slice(0, next);
};

/** The events a workflow runs on: the two-space keys under `on:`, in file order. */
const triggers = (path) =>
  [...triggerBlock(path).matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);

const scheduleCrons = (path) =>
  [...triggerBlock(path).matchAll(/^\s*-\s*cron:\s*'([^']+)'/gm)].map(
    (m) => m[1],
  );

const timeoutMinutes = (path, jobId) =>
  Number(
    (jobBlock(path, jobId).match(/^\s*timeout-minutes:\s*(\d+)/m) ??
      fail(`${path} job ${jobId} declares no timeout-minutes`))[1],
  );

/** The Production job that marks a Release's Feedback Reports (ADR 0133). */
const RELEASE_MARK_JOB = 'mark-feedback-release';

/** A job's `needs: [a, b]` list, in the order the workflow states it. */
const jobNeeds = (path, jobId) => {
  const raw = (jobBlock(path, jobId).match(/^\s*needs:\s*\[([^\]]*)\]\s*$/m) ??
    fail(`${path} job ${jobId} declares no needs: [ … ] list`))[1];
  return raw
    .split(',')
    .map((need) => need.trim())
    .filter(Boolean);
};

/** Job ids in a workflow that declare a given `environment:`, in file order. */
const jobsInEnvironment = (path, environment) =>
  jobIds(path).filter((id) =>
    new RegExp(`^\\s*environment:\\s*${environment}\\s*$`, 'm').test(
      jobBlock(path, id),
    ),
  );

const cancelInProgress = (path) => {
  const raw = capture(
    path,
    /^concurrency:[\s\S]*?^\s*cancel-in-progress:\s*(true|false)/m,
    'top-level concurrency cancel-in-progress',
  );
  return raw === 'true';
};

/**
 * Staging moved `cancel-in-progress` to job-level `concurrency:` blocks (issue
 * #567): a workflow-level group would have covered Host Apply too, and a newer
 * `main` push cancelling an in-flight `prisma migrate deploy` is the one
 * behavior ADR 0056 rules out. The page asserts both deploy groups, and since
 * ADR 0128 neither cancels: `deploy-staging-apply` (deploy-backend and
 * host-apply, the jobs that touch `APP_ROOT`) queues, and so does
 * `deploy-staging-web` (deploy-frontend), which writes the web app's tree over
 * FTP and must not be cut off halfway. Production keeps its cancel-in-progress
 * at the top level (`cancelInProgress` above), so only staging needs this
 * job-scoped variant.
 */
const jobCancelInProgress = (path, jobId) => {
  const block = jobBlock(path, jobId);
  const match = block.match(
    /concurrency:[\s\S]*?cancel-in-progress:\s*(true|false)/,
  );
  if (!match) {
    fail(`${path} job ${jobId} declares no concurrency cancel-in-progress`);
  }
  return match[1] === 'true';
};

// One extractor per manifest key. A key with no entry here is a finding, so this
// map is also the list of claims the page is allowed to make.
const EXTRACTORS = {
  // Node: three scopes, one floor. The runners pin an exact major, the repo
  // declares a range, and release.mjs refuses to run below one. Collapsing them
  // into a single "node version" is the mistake the manifest's key names prevent.
  ciRunnerNodeMajor: () =>
    theOnly(
      PIPELINE_NODE_FILES.flatMap((file) =>
        allMatches(file, /^\s*node-version:\s*'([^']+)'/gm),
      ),
      'pinned node-version across the pipeline workflows',
    ),
  repoEnginesNodeRange: () =>
    JSON.parse(read(PACKAGE_JSON)).engines?.node ??
    fail(`${PACKAGE_JSON} declares no engines.node`),
  releaseScriptMinNodeMajor: () =>
    Number(
      capture(
        RELEASE_SCRIPT,
        /major\s*<\s*(\d+)/,
        'the minimum Node major release.mjs enforces',
      ),
    ),

  // Staging and Production both ship the web app to cPanel over FTP, so the
  // web app sits beside its API on one site (ADR 0128). Both are read from the
  // jobs: a second kind of host on either environment is the defect of #1138.
  stagingFrontendTarget: () => frontendTarget(STAGING),
  productionFrontendTarget: () => frontendTarget(PRODUCTION),

  // Staging deploys once a day and on dispatch, never on a push to `main`
  // (ADR 0128). The trigger list is asserted whole, so a `push` or
  // `workflow_run` that comes back fails here as loudly as a moved cron.
  stagingTriggers: () => triggers(STAGING),
  stagingScheduleCron: () =>
    theOnly(scheduleCrons(STAGING), 'cron in the staging schedule'),

  // The session needs the web app and its API on one site, and on Staging one
  // step is what refuses a deploy that breaks that (ADR 0128). True only while
  // the frontend job still runs it: a deleted step leaves every other line of
  // the workflow reading exactly as before.
  stagingAssertsSameSite: () =>
    /^\s*run:.*\bstaging-web-deploy\.mjs same-site\b/m.test(
      jobBlock(STAGING, 'deploy-frontend'),
    ),

  // The web app's document root on the host is the bundle's public/ folder,
  // which holds the host's own .htaccess: the file that starts the app. True
  // only while the step that uploads the bundle excludes every .htaccess.
  stagingWebUploadExcludesHtaccess: () => {
    const upload = jobBlock(STAGING, 'deploy-frontend')
      .split(/^ {6}- /m)
      .find((step) =>
        step.includes(`local-dir: ${artifactDir(STAGING, 'deploy-frontend')}`),
      );
    const excluded = upload?.match(/^( +)exclude:\s*\|\n((?:\1 +\S.*\n?)+)/m);
    return Boolean(
      excluded?.[2].split('\n').some((line) => line.trim() === '**/.htaccess'),
    );
  },

  // The approval gate is the page's hero: it exists only because these jobs name
  // an environment. A job that loses `environment: production` loses the gate
  // while every other line of the workflow reads exactly as before (ADR 0028).
  stagingEnvironmentName: () =>
    theOnly(
      allMatches(STAGING, /^\s*environment:\s*(\S+)\s*$/gm),
      'environment declared in the staging workflow',
    ),
  productionEnvironmentName: () =>
    theOnly(
      allMatches(PRODUCTION, /^\s*environment:\s*(\S+)\s*$/gm),
      'environment declared in the production workflow',
    ),
  productionApprovalGatedJobs: () =>
    jobsInEnvironment(PRODUCTION, 'production'),

  // Reversing any of these is a behaviour change the page would otherwise keep
  // describing the old way. Every job that writes to the host queues: the
  // staging jobs that write to `APP_ROOT`, the staging frontend job, which
  // writes the web app's own root over FTP (ADR 0128), and production wholesale.
  stagingApplyCancelInProgress: () =>
    jobCancelInProgress(STAGING, 'deploy-backend'),
  stagingFrontendCancelInProgress: () =>
    jobCancelInProgress(STAGING, 'deploy-frontend'),
  productionConcurrencyCancelInProgress: () => cancelInProgress(PRODUCTION),

  productionValidateTimeoutMinutes: () =>
    timeoutMinutes(PRODUCTION, 'validate'),
  // Release marking (ADR 0133) is approval-gated for its secrets but is one
  // HTTP call, not a deploy, so it carries its own timeout.
  productionDeployTimeoutMinutes: () =>
    theOnly(
      jobsInEnvironment(PRODUCTION, 'production')
        .filter((id) => id !== RELEASE_MARK_JOB)
        .map((id) => timeoutMinutes(PRODUCTION, id)),
      'timeout-minutes across the approval-gated production deploy jobs',
    ),
  productionReleaseMarkTimeoutMinutes: () =>
    timeoutMinutes(PRODUCTION, RELEASE_MARK_JOB),
  productionReleaseMarkNeeds: () => jobNeeds(PRODUCTION, RELEASE_MARK_JOB),
  stagingDeployTimeoutMinutes: () =>
    theOnly(
      jobsInEnvironment(STAGING, 'staging').map((id) =>
        timeoutMinutes(STAGING, id),
      ),
      'timeout-minutes across the staging deploy jobs',
    ),
  ftpDeployTimeoutMs: () =>
    Number(
      theOnly(
        [STAGING, PRODUCTION].flatMap((file) =>
          allMatches(file, /^\s*timeout:\s*(\d+)\s*$/gm),
        ),
        'FTP transfer timeout across the deploy workflows',
      ),
    ),

  // Four gates, four different strictnesses. The production guard accepts any
  // release/* suffix while everything downstream demands semver; the page states
  // that as a fact, so all of them are read rather than assumed to agree.
  productionRefGuardPattern: () =>
    capture(
      PRODUCTION,
      /"\$GITHUB_REF"\s*==\s*(\S+)\s*\]\]/,
      'the release-branch guard in the validate job',
    ),
  dispatcherReleaseBranchPattern: () =>
    capture(
      DISPATCHER,
      /"\$\{CREATED_REF\}"\s*=~\s*(\S+)\s*\]\]/,
      'the release-branch pattern in the dispatcher',
    ),
  publishReleaseTagPattern: () =>
    capture(
      PUBLISH,
      /"\$tag"\s*=~\s*(\S+)\s*\]\]/,
      'the release-tag pattern in the publish workflow',
    ),

  backendArtifactDir: () =>
    theOnly(
      [STAGING, PRODUCTION].map((file) => artifactDir(file, 'deploy-backend')),
      'backend artifact directory across staging and production',
    ),
  // Read per environment rather than collapsed: Staging's job has a second
  // FTP upload (the restart file), so "the" local-dir means the first one.
  stagingFrontendArtifactDir: () => artifactDir(STAGING, 'deploy-frontend'),
  productionFrontendArtifactDir: () =>
    artifactDir(PRODUCTION, 'deploy-frontend'),

  // The publish workflow reads the notes from the tagged commit; release.mjs
  // writes them at cut. Two scopes, and the release breaks if they disagree.
  releaseNotesFileName: () =>
    theOnly(
      [
        capture(
          PUBLISH,
          /notesPath\s*=\s*'([^']+)'/,
          'the release-notes filename the publish workflow reads',
        ),
        capture(
          RELEASE_SCRIPT,
          /notesFile\s*=\s*'([^']+)'/,
          'the release-notes filename release.mjs writes',
        ),
      ],
      'release-notes filename across the publish workflow and release.mjs',
    ),

  // `release:cut` refuses a commit Staging has not both uploaded and Host
  // Applied (ADR 0056, amendment 2026-09-14). The guard names the two jobs it
  // reads from the Deploy Staging run rather than the page assuming them.
  cutGuardUploadJob: () =>
    capture(
      STAGING_HOST_APPLY_GUARD,
      /export const UPLOAD_JOB = '([^']+)'/,
      'the job the Cut guard reads as Staging’s upload',
    ),
  cutGuardApplyJob: () =>
    capture(
      STAGING_HOST_APPLY_GUARD,
      /export const APPLY_JOB = '([^']+)'/,
      'the job the Cut guard reads as Staging’s Host Apply',
    ),
};

/** Keys that are prose rather than a claim about source, and so are not asserted. */
const NOT_A_FACT = new Set(['note']);

const show = (value) => JSON.stringify(value);

const sameValue = (expected, claimed) =>
  Array.isArray(expected) || Array.isArray(claimed)
    ? JSON.stringify(expected) === JSON.stringify(claimed)
    : expected === claimed;

if (printMode) {
  for (const [key, extract] of Object.entries(EXTRACTORS)) {
    console.log(`  ${key}: ${show(extract())}`);
  }
  process.exit(0);
}

const page = read(PAGE);
const block = page.match(
  new RegExp(
    `<script type="application/json" id="${MANIFEST_ID}">([\\s\\S]*?)</script>`,
  ),
);
if (!block) fail(`no #${MANIFEST_ID} block in ${PAGE}`);

let manifest;
try {
  manifest = JSON.parse(block[1]);
} catch (err) {
  fail(`#${MANIFEST_ID} is not valid JSON: ${err.message}`);
}

const findings = [];
let asserted = 0;

for (const [key, claimed] of Object.entries(manifest)) {
  if (NOT_A_FACT.has(key)) continue;

  const extract = EXTRACTORS[key];
  if (!extract) {
    findings.push(
      `${key}: the page asserts this but no extractor reads it from source — ` +
        `add one to ${join('tools', 'scripts', 'check-deploy-pipeline.mjs')} or drop the key`,
    );
    continue;
  }

  asserted += 1;
  const expected = extract();
  if (!sameValue(expected, claimed)) {
    findings.push(
      `${key}: page says ${show(claimed)}, source says ${show(expected)}`,
    );
  }
}

for (const key of Object.keys(EXTRACTORS)) {
  if (!(key in manifest)) {
    findings.push(`${key}: missing from the page's manifest`);
  }
}

if (asserted === 0)
  fail(`#${MANIFEST_ID} declared none of the known constants`);

if (findings.length > 0) {
  console.error(
    `deploy-pipeline: ${findings.length} finding(s) — ${PAGE} no longer matches the workflows\n`,
  );
  for (const finding of findings) console.error(`  - ${finding}`);
  console.error(
    '\nFix the page, or the value it asserts. `--print` shows what each extractor resolved.',
  );
  process.exit(1);
}

console.log(`deploy-pipeline: ${asserted} assertions in sync`);
