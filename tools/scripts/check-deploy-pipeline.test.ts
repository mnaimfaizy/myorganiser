// Contract for check-deploy-pipeline.ts.
//
// The fixture is a copy of the real files rather than a hand-written miniature:
// the checker's whole job is to read this repo's actual workflow shapes, and a
// fixture that drifts from them would pass while the checker no longer reads
// anything. Each negative case copies the real tree and then breaks one fact.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, 'check-deploy-pipeline.ts');
const REPO = resolve(HERE, '..', '..');

const PAGE = 'docs/deployment/release-pipeline.html';
const STAGING = '.github/workflows/deploy-staging.yml';
const PRODUCTION = '.github/workflows/deploy-production.yml';
const CUT_GUARD = 'tools/scripts/lib/staging-host-apply-guard.ts';

const FIXTURE_FILES = [
  PAGE,
  STAGING,
  PRODUCTION,
  '.github/workflows/ci.yml',
  '.github/workflows/dispatch-production-deploy.yml',
  '.github/workflows/publish-github-release.yml',
  'package.json',
  'tools/scripts/release.mjs',
  'tools/scripts/lib/staging-host-apply-guard.ts',
];

function createWorkspace(t: TestContext): string {
  const workspace = mkdtempSync(join(tmpdir(), 'deploy-pipeline-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  for (const file of FIXTURE_FILES) {
    const target = join(workspace, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(REPO, file), target);
  }
  return workspace;
}

const readFixture = (workspace: string, file: string): string =>
  readFileSync(join(workspace, file), 'utf8');

const writeFixture = (workspace: string, file: string, content: string): void =>
  writeFileSync(join(workspace, file), content);

/** Replaces one occurrence, asserting it was there — a no-op edit would fake a pass. */
function edit(workspace: string, file: string, from: string, to: string): void {
  const before = readFixture(workspace, file);
  assert.ok(before.includes(from), `fixture no longer contains: ${from}`);
  writeFixture(workspace, file, before.replace(from, to));
}

/** Replaces the LAST occurrence — the deploy workflows do most things twice. */
function editLast(
  workspace: string,
  file: string,
  from: string,
  to: string,
): void {
  const before = readFixture(workspace, file);
  const at = before.lastIndexOf(from);
  assert.notEqual(at, -1, `fixture no longer contains: ${from}`);
  writeFixture(
    workspace,
    file,
    before.slice(0, at) + to + before.slice(at + from.length),
  );
}

function runChecker(workspace: string, extraArgs: string[] = []) {
  return spawnSync(process.execPath, [CHECKER, workspace, ...extraArgs], {
    cwd: workspace,
    encoding: 'utf8',
  });
}

/** Rewrites one key inside the page's embedded manifest. */
function editManifest(
  workspace: string,
  mutate: (manifest: Record<string, unknown>) => void,
): void {
  const page = readFixture(workspace, PAGE);
  const pattern =
    /(<script type="application\/json" id="release-pipeline-manifest">)([\s\S]*?)(<\/script>)/;
  const match = page.match(pattern);
  assert.ok(match, 'fixture page has no manifest block');

  const manifest = JSON.parse(match[2]) as Record<string, unknown>;
  mutate(manifest);
  writeFixture(
    workspace,
    PAGE,
    page.replace(pattern, `$1${JSON.stringify(manifest, null, 2)}$3`),
  );
}

test('passes when the page matches the workflows', (t) => {
  const result = runChecker(createWorkspace(t));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /assertions in sync/);
});

test('--print resolves every extractor without reading the page', (t) => {
  const workspace = createWorkspace(t);
  rmSync(join(workspace, PAGE));

  const result = runChecker(workspace, ['--print']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /productionApprovalGatedJobs/);
});

test('fails when a value on the page drifts from source', (t) => {
  const workspace = createWorkspace(t);
  editManifest(workspace, (m) => {
    m.stagingScheduleCron = '0 4 * * *';
  });

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /stagingScheduleCron/);
  assert.match(result.stderr, /0 16 \* \* \*/);
});

test('fails when the staging schedule moves in the workflow', (t) => {
  const workspace = createWorkspace(t);
  edit(workspace, STAGING, "- cron: '0 16 * * *'", "- cron: '30 2 * * *'");

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /stagingScheduleCron/);
  assert.match(result.stderr, /30 2 \* \* \*/);
});

test('fails when staging deploys on a push to main again', (t) => {
  const workspace = createWorkspace(t);
  // The regression ADR 0128 rules out: Staging is daily and on dispatch. A
  // trigger added beside the schedule leaves the cron line exactly as it was.
  edit(
    workspace,
    STAGING,
    '  workflow_dispatch:\n',
    "  workflow_run:\n    workflows: ['CI']\n    types: [completed]\n  workflow_dispatch:\n",
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /stagingTriggers/);
  assert.match(result.stderr, /workflow_run/);
});

test('fails when the staging same-site assertion is removed', (t) => {
  const workspace = createWorkspace(t);
  // The step is one line of `run:`; without it a web address on another site
  // deploys green and sign-in stops surviving a restart (#1138).
  edit(
    workspace,
    STAGING,
    'run: node .deploy-tools/tools/scripts/staging-web-deploy.mjs same-site "$WEB_ORIGIN" "$API_ORIGIN"',
    "run: echo 'skipped'",
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /stagingAssertsSameSite/);
  assert.match(result.stderr, /page says true, source says false/);
});

test('fails when the staging web upload stops excluding .htaccess', (t) => {
  const workspace = createWorkspace(t);
  // The host keeps its own .htaccess in the folder the bundle's public/ is
  // uploaded to. One deleted line and an upload may overwrite it.
  edit(workspace, STAGING, '            **/.htaccess\n', '');

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /stagingWebUploadExcludesHtaccess/);
  assert.match(result.stderr, /page says true, source says false/);
});

test('an .htaccess exclude on another step does not count for the web upload', (t) => {
  const workspace = createWorkspace(t);
  // Move the line from the bundle upload to the restart upload below it.
  edit(workspace, STAGING, '            **/.htaccess\n', '');
  edit(
    workspace,
    STAGING,
    '          server-dir: ${{ secrets.FTP_FRONTEND_DIR }}tmp/\n          timeout: 300000\n',
    '          server-dir: ${{ secrets.FTP_FRONTEND_DIR }}tmp/\n          timeout: 300000\n          exclude: |\n            **/.htaccess\n',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /stagingWebUploadExcludesHtaccess/);
});

test('fails when the staging frontend upload becomes cancellable again', (t) => {
  const workspace = createWorkspace(t);
  // A run cancelled mid-FTP leaves a half-written web bundle on the host.
  edit(
    workspace,
    STAGING,
    '      group: deploy-staging-web\n      cancel-in-progress: false',
    '      group: deploy-staging-web\n      cancel-in-progress: true',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /stagingFrontendCancelInProgress/);
});

test('fails when the staging frontend stops going to cPanel', (t) => {
  const workspace = createWorkspace(t);
  // Staging's web app on a different kind of host from its API is the defect
  // of #1138. The job calls the FTP action twice (bundle, then restart file),
  // so both are replaced: one surviving call would still read as cPanel.
  const before = readFixture(workspace, STAGING);
  const at = before.indexOf('  deploy-frontend:\n');
  assert.notEqual(at, -1, 'fixture has no staging deploy-frontend job');
  const job = before.slice(at);
  assert.ok(job.includes('uses: samkirkland/ftp-deploy-action'));
  writeFixture(
    workspace,
    STAGING,
    before.slice(0, at) +
      job.replaceAll(
        'uses: samkirkland/ftp-deploy-action',
        'run: some-other-host deploy #',
      ),
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /stagingFrontendTarget/);
  assert.match(result.stderr, /not-cpanel-ftp/);
});

test('fails when a deploy job loses its production environment', (t) => {
  const workspace = createWorkspace(t);
  // The approval gate is the page's hero and lives in one line of YAML. Removing
  // it from deploy-frontend leaves every other line of the workflow unchanged.
  // Anchored on deploy-frontend's own block: the mark job is now the last job
  // that declares `environment: production`, so editLast would miss it.
  edit(
    workspace,
    PRODUCTION,
    '    needs: [validate, prepare-dependencies, deploy-backend]\n' +
      '    runs-on: ubuntu-24.04\n' +
      '    timeout-minutes: 45\n' +
      '    environment: production\n',
    '    needs: [validate, prepare-dependencies, deploy-backend]\n' +
      '    runs-on: ubuntu-24.04\n' +
      '    timeout-minutes: 45\n',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /productionApprovalGatedJobs/);
});

test('fails when the production frontend stops going to cPanel', (t) => {
  const workspace = createWorkspace(t);
  // Both deploy jobs call the FTP action; the frontend's is the second, so a
  // first-occurrence replace would edit the backend and prove nothing.
  editLast(
    workspace,
    PRODUCTION,
    'uses: samkirkland/ftp-deploy-action',
    'run: some-other-host deploy #',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /productionFrontendTarget/);
});

test('fails when staging and production disagree on a value stated once', (t) => {
  const workspace = createWorkspace(t);
  edit(workspace, STAGING, 'timeout: 300000', 'timeout: 120000');

  const result = runChecker(workspace);

  // A value the page states once cannot describe two different numbers, so this
  // is a hard stop rather than a drift finding.
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not a single value/);
});

test('fails when the page asserts a key no extractor reads', (t) => {
  const workspace = createWorkspace(t);
  editManifest(workspace, (m) => {
    m.productionSmokeTestUrl = 'https://example.invalid';
  });

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /productionSmokeTestUrl/);
  assert.match(result.stderr, /no extractor/);
});

test('fails when the page drops a key the checker knows about', (t) => {
  const workspace = createWorkspace(t);
  editManifest(workspace, (m) => {
    delete m.productionRefGuardPattern;
  });

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /productionRefGuardPattern.*missing/s);
});

test('fails when the Cut guard reads its upload job from a different job name', (t) => {
  const workspace = createWorkspace(t);
  // The guard, not the page, is the source of truth for which job Staging's
  // upload is read from — the page must follow it, not assert it independently.
  edit(
    workspace,
    CUT_GUARD,
    "export const UPLOAD_JOB = 'deploy-backend';",
    "export const UPLOAD_JOB = 'deploy-backend-legacy';",
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /cutGuardUploadJob/);
  assert.match(result.stderr, /deploy-backend-legacy/);
});

test('reads manifest values containing /* without masking them away', (t) => {
  const workspace = createWorkspace(t);

  const result = runChecker(workspace);

  // productionRefGuardPattern is `refs/heads/release/*` and the note names
  // `.github/workflows/*.yml`. Masking `/* … */` document-wide is what blinded
  // the design-hygiene gate to this very block, so this checker must not.
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFixture(workspace, PAGE), /refs\/heads\/release\/\*/);
});

// ===== mark-feedback-release Job =====

// The job is appended last in the production workflow. Its `needs:` line is
// unique in the file, and so is its `timeout-minutes: 10`.
const MARK_NEEDS = '    needs: [validate, host-apply, deploy-frontend]\n';
const MARK_TIMEOUT = '    timeout-minutes: 10\n';

test('fails when the mark-feedback-release job skips deploy-frontend in its needs', (t) => {
  const workspace = createWorkspace(t);
  edit(
    workspace,
    PRODUCTION,
    MARK_NEEDS,
    '    needs: [validate, host-apply]\n',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /productionReleaseMarkNeeds/);
});

test('fails when the page drops deploy-frontend from the mark job needs', (t) => {
  const workspace = createWorkspace(t);
  editManifest(workspace, (m) => {
    // Without this check a missing key would still "fail" below and prove
    // nothing about the needs list, so the key is asserted present first.
    assert.deepEqual(m.productionReleaseMarkNeeds, [
      'validate',
      'host-apply',
      'deploy-frontend',
    ]);
    m.productionReleaseMarkNeeds = ['validate', 'host-apply'];
  });

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /productionReleaseMarkNeeds/);
});

test('fails when the mark job timeout moves, without touching the deploy timeout', (t) => {
  const workspace = createWorkspace(t);
  edit(workspace, PRODUCTION, MARK_TIMEOUT, '    timeout-minutes: 15\n');

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /productionReleaseMarkTimeoutMinutes/);
  // The mark job is approval-gated but is not a deploy job, so the 45-minute
  // deploy-timeout key must not read it.
  assert.doesNotMatch(result.stderr, /productionDeployTimeoutMinutes/);
});
