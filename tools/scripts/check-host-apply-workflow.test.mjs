/**
 * Contract for check-host-apply-workflow.mjs (ADR 0056, issue #567).
 *
 * The fixture is a copy of the real files rather than a hand-written miniature:
 * the checker's whole job is to read this repo's actual workflow shapes, and a
 * fixture that drifts from them would pass while the checker no longer reads
 * anything. Each negative case copies the real tree and then breaks one fact.
 */
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
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, 'check-host-apply-workflow.mjs');
const REPO = resolve(HERE, '..', '..');

const STAGING = '.github/workflows/deploy-staging.yml';
const PRODUCTION = '.github/workflows/deploy-production.yml';
const HOST_APPLY_LIB = 'tools/scripts/lib/host-apply.mjs';

const FIXTURE_FILES = [STAGING, PRODUCTION, HOST_APPLY_LIB];

function createWorkspace(t) {
  const workspace = mkdtempSync(join(tmpdir(), 'host-apply-workflow-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  for (const file of FIXTURE_FILES) {
    const target = join(workspace, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(REPO, file), target);
  }
  return workspace;
}

const readFixture = (workspace, file) =>
  readFileSync(join(workspace, file), 'utf8');

const writeFixture = (workspace, file, content) =>
  writeFileSync(join(workspace, file), content);

/** Replaces one occurrence, asserting it was there — a no-op edit would fake a pass. */
function edit(workspace, file, from, to) {
  const before = readFixture(workspace, file);
  assert.ok(before.includes(from), `fixture no longer contains: ${from}`);
  writeFixture(workspace, file, before.replace(from, to));
}

function runChecker(workspace) {
  return spawnSync(process.execPath, [CHECKER, workspace], {
    cwd: workspace,
    encoding: 'utf8',
  });
}

// ===== Happy Path =====

test('passes when the workflows match the contract', (t) => {
  const result = runChecker(createWorkspace(t));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /wiring in sync/);
});

// ===== Environment Checks =====

test('fails when staging host-apply lacks environment: staging', (t) => {
  const workspace = createWorkspace(t);

  // The staging workflow has several job-level `environment: staging` declarations.
  // Target only the host-apply job's occurrence by finding its block.
  const stagingContent = readFixture(workspace, STAGING);
  const lines = stagingContent.split('\n');
  const hostApplyLineStart = lines.findIndex((line) =>
    line.startsWith('  host-apply:'),
  );
  const hostApplyLineEndIndex = lines.findIndex(
    (line, idx) =>
      idx > hostApplyLineStart &&
      line.match(/^  {2}[a-z0-9][a-z0-9-]*:/) &&
      !line.startsWith('  host-apply:'),
  );
  const hostApplyLineEnd =
    hostApplyLineEndIndex === -1 ? lines.length : hostApplyLineEndIndex;

  // Find environment line in this block and remove it
  for (let i = hostApplyLineStart; i < hostApplyLineEnd; i++) {
    if (
      lines[i].includes('environment:') &&
      lines[i].includes('staging') &&
      !lines[i].includes('deploy-staging')
    ) {
      lines.splice(i, 1);
      break;
    }
  }

  writeFixture(workspace, STAGING, lines.join('\n'));

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /host-apply does not declare environment: staging/,
  );
});

test('fails when production host-apply lacks environment: production', (t) => {
  const workspace = createWorkspace(t);

  const prodContent = readFixture(workspace, PRODUCTION);
  const lines = prodContent.split('\n');
  const hostApplyLineStart = lines.findIndex((line) =>
    line.startsWith('  host-apply:'),
  );
  const hostApplyLineEndIndex = lines.findIndex(
    (line, idx) =>
      idx > hostApplyLineStart &&
      line.match(/^  {2}[a-z0-9][a-z0-9-]*:/) &&
      !line.startsWith('  host-apply:'),
  );
  const hostApplyLineEnd =
    hostApplyLineEndIndex === -1 ? lines.length : hostApplyLineEndIndex;

  // Find and remove environment line in host-apply block
  for (let i = hostApplyLineStart; i < hostApplyLineEnd; i++) {
    if (lines[i].includes('environment:') && lines[i].includes('production')) {
      lines.splice(i, 1);
      break;
    }
  }

  writeFixture(workspace, PRODUCTION, lines.join('\n'));

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /host-apply does not declare environment: production/,
  );
});

// ===== Needs Checks =====

test('fails when staging host-apply needs does not include deploy-backend', (t) => {
  const workspace = createWorkspace(t);

  edit(
    workspace,
    STAGING,
    '  host-apply:\n    needs: deploy-backend',
    '  host-apply:\n    needs: deploy-frontend',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not include deploy-backend/);
});

test('fails when production host-apply needs does not include deploy-backend', (t) => {
  const workspace = createWorkspace(t);

  const prodContent = readFixture(workspace, PRODUCTION);
  const lines = prodContent.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (
      lines[i].includes('host-apply:') &&
      lines[i + 1] &&
      lines[i + 1].includes('needs:')
    ) {
      // Found the host-apply needs line, change it
      lines[i + 1] = lines[i + 1].replace(/deploy-backend/, 'deploy-frontend');
      break;
    }
  }
  writeFixture(workspace, PRODUCTION, lines.join('\n'));

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not include deploy-backend/);
});

// ===== Dispatch Input Checks =====

test('fails when staging workflow_dispatch lacks apply_only input', (t) => {
  const workspace = createWorkspace(t);

  const stagingContent = readFixture(workspace, STAGING);
  const lines = stagingContent.split('\n');

  // Find and remove the apply_only input block
  let inDispatch = false;
  let applyOnlyStart = -1;
  let applyOnlyEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('workflow_dispatch:')) {
      inDispatch = true;
    } else if (inDispatch && lines[i].includes('apply_only:')) {
      applyOnlyStart = i;
      // Find the end of this input block (next input or end of dispatch)
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].match(/^\s{6,8}[a-z_]+:\s*$/) || !lines[j].trim()) {
          applyOnlyEnd = j;
          break;
        }
      }
      break;
    }
  }

  if (applyOnlyStart !== -1) {
    // Remove the block
    if (applyOnlyEnd === -1) applyOnlyEnd = applyOnlyStart + 1;
    lines.splice(applyOnlyStart, applyOnlyEnd - applyOnlyStart);
  }

  writeFixture(workspace, STAGING, lines.join('\n'));

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /declares no apply_only input/);
});

test('fails when production workflow_dispatch lacks apply_only input', (t) => {
  const workspace = createWorkspace(t);

  const prodContent = readFixture(workspace, PRODUCTION);
  const lines = prodContent.split('\n');

  let inDispatch = false;
  let applyOnlyStart = -1;
  let applyOnlyEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('workflow_dispatch:')) {
      inDispatch = true;
    } else if (inDispatch && lines[i].includes('apply_only:')) {
      applyOnlyStart = i;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].match(/^\s{6,8}[a-z_]+:\s*$/) || !lines[j].trim()) {
          applyOnlyEnd = j;
          break;
        }
      }
      break;
    }
  }

  if (applyOnlyStart !== -1) {
    if (applyOnlyEnd === -1) applyOnlyEnd = applyOnlyStart + 1;
    lines.splice(applyOnlyStart, applyOnlyEnd - applyOnlyStart);
  }

  writeFixture(workspace, PRODUCTION, lines.join('\n'));

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /declares no apply_only input/);
});

// ===== Apply-Only Re-run Checks =====

test('fails when staging deploy-backend no longer skips on apply_only', (t) => {
  const workspace = createWorkspace(t);

  edit(
    workspace,
    STAGING,
    "  deploy-backend:\n    if: ${{ needs.select.outputs.proceed == 'true' && (github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && !inputs.apply_only)) }}",
    "  deploy-backend:\n    if: ${{ needs.select.outputs.proceed == 'true' && (github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch')) }}",
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /deploy-backend's if: does not skip on apply_only re-run/,
  );
});

test('fails when staging deploy-frontend no longer skips on apply_only', (t) => {
  const workspace = createWorkspace(t);

  edit(
    workspace,
    STAGING,
    "  deploy-frontend:\n    if: ${{ needs.select.outputs.proceed == 'true' && (github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && !inputs.apply_only)) }}",
    "  deploy-frontend:\n    if: ${{ needs.select.outputs.proceed == 'true' && (github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch')) }}",
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /deploy-frontend's if: does not skip on apply_only re-run/,
  );
});

test('fails when staging host-apply loses its apply_only-only path', (t) => {
  const workspace = createWorkspace(t);

  edit(
    workspace,
    STAGING,
    "    if: ${{ always() && github.event_name == 'workflow_dispatch' && (needs.deploy-backend.result == 'success' || inputs.apply_only) }}",
    "    if: ${{ always() && github.event_name == 'workflow_dispatch' && (needs.deploy-backend.result == 'success') }}",
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /host-apply's if: has no path that runs on an apply_only-only dispatch/,
  );
});

test('fails when production deploy-backend no longer skips on apply_only', (t) => {
  const workspace = createWorkspace(t);

  edit(
    workspace,
    PRODUCTION,
    "  deploy-backend:\n    if: ${{ startsWith(github.ref, 'refs/heads/release/') && !inputs.apply_only }}",
    "  deploy-backend:\n    if: ${{ startsWith(github.ref, 'refs/heads/release/') }}",
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /deploy-backend's if: does not skip on apply_only re-run/,
  );
});

test('fails when production deploy-frontend no longer skips on apply_only', (t) => {
  const workspace = createWorkspace(t);

  edit(
    workspace,
    PRODUCTION,
    "  deploy-frontend:\n    if: ${{ startsWith(github.ref, 'refs/heads/release/') && !inputs.apply_only }}",
    "  deploy-frontend:\n    if: ${{ startsWith(github.ref, 'refs/heads/release/') }}",
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /deploy-frontend's if: does not skip on apply_only re-run/,
  );
});

test('fails when production host-apply loses its apply_only-only path', (t) => {
  const workspace = createWorkspace(t);

  edit(
    workspace,
    PRODUCTION,
    "    if: ${{ always() && needs.validate.result == 'success' && startsWith(github.ref, 'refs/heads/release/') && (needs.deploy-backend.result == 'success' || inputs.apply_only) }}",
    "    if: ${{ always() && needs.validate.result == 'success' && startsWith(github.ref, 'refs/heads/release/') && (needs.deploy-backend.result == 'success') }}",
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /host-apply's if: has no path that runs on an apply_only-only dispatch/,
  );
});

// ===== Concurrency Checks =====

test('fails when staging host-apply cancel-in-progress is true', (t) => {
  const workspace = createWorkspace(t);

  edit(
    workspace,
    STAGING,
    `    concurrency:
      group: deploy-staging-apply
      cancel-in-progress: false

    steps:
      - name: Checkout
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          # Dispatch only, so this is the commit \`select\` chose as well; it is
          # read directly because an apply_only dispatch must not depend on
          # the upload chain.
          ref: \${{ github.sha }}

      - name: Setup Node.js 22
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: '22'

      - name: Build Host Apply script`,
    `    concurrency:
      group: deploy-staging-apply
      cancel-in-progress: true

    steps:
      - name: Checkout
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          # Dispatch only, so this is the commit \`select\` chose as well; it is
          # read directly because an apply_only dispatch must not depend on
          # the upload chain.
          ref: \${{ github.sha }}

      - name: Setup Node.js 22
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: '22'

      - name: Build Host Apply script`,
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /host-apply's cancel-in-progress is true, expected false/,
  );
});

test('fails when the staging upload leaves the apply group', (t) => {
  const workspace = createWorkspace(t);

  // The regression this guards: a group covering only host-apply keeps migrate
  // from being cancelled, but lets a newer run FTP a bundle into APP_ROOT while
  // that migrate is still running.
  edit(
    workspace,
    STAGING,
    `    concurrency:
      group: deploy-staging-apply
      cancel-in-progress: false

    steps:
      - name: Checkout`,
    `    concurrency:
      group: deploy-staging
      cancel-in-progress: true

    steps:
      - name: Checkout`,
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /hold different concurrency groups - an upload could land in APP_ROOT while an apply is still running there/,
  );
  assert.match(
    result.stderr,
    /deploy-backend's cancel-in-progress is true, expected false/,
  );
});

test('fails when staging host-apply can run without a dispatch', (t) => {
  const workspace = createWorkspace(t);

  // The regression: chaining apply back onto the automatic trigger (the daily
  // schedule), on a host whose SSH shell is a manual toggle that reverts.
  edit(
    workspace,
    STAGING,
    "    if: ${{ always() && github.event_name == 'workflow_dispatch' && (needs.deploy-backend.result == 'success' || inputs.apply_only) }}",
    "    if: ${{ always() && (needs.deploy-backend.result == 'success' || (github.event_name == 'workflow_dispatch' && inputs.apply_only)) }}",
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /does not require github\.event_name == 'workflow_dispatch'/,
  );
});

// ===== SSH and log-redaction hardening =====

test('fails when host-apply stops pinning the host keys', (t) => {
  const workspace = createWorkspace(t);

  edit(
    workspace,
    STAGING,
    '-o StrictHostKeyChecking=yes',
    '-o StrictHostKeyChecking=accept-new',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not set StrictHostKeyChecking=yes/);
});

test('fails when host-apply consults no known-hosts file', (t) => {
  const workspace = createWorkspace(t);

  edit(
    workspace,
    PRODUCTION,
    '            -o UserKnownHostsFile="$known_hosts" \\\n',
    '',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /sets no UserKnownHostsFile/);
});

test('fails when the key is used without checking that it parses', (t) => {
  const workspace = createWorkspace(t);

  edit(
    workspace,
    STAGING,
    '          if ! ssh-keygen -y -f "$key_file" >/dev/null 2>&1; then',
    '          if false; then',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /does not check that SSH_PRIVATE_KEY parses before connecting/,
  );
});

test('fails when an empty SSH_KNOWN_HOSTS is not caught', (t) => {
  const workspace = createWorkspace(t);

  edit(
    workspace,
    PRODUCTION,
    '          if [ "$(wc -c < "$known_hosts")" -le 1 ]; then',
    '          if false; then',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /does not check that SSH_KNOWN_HOSTS is non-empty/,
  );
});

test('fails when the ssh step streams its output instead of capturing it', (t) => {
  const workspace = createWorkspace(t);

  edit(
    workspace,
    STAGING,
    '            > "$RUNNER_TEMP/host-apply.log" 2>&1 || status=$?',
    '            2>&1 || status=$?',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /streams its output instead of capturing it to host-apply\.log/,
  );
});

test('fails when the captured output never reaches the scrubber', (t) => {
  const workspace = createWorkspace(t);

  edit(
    workspace,
    PRODUCTION,
    'run: node tools/scripts/scrub-host-apply-log.mjs "$RUNNER_TEMP/host-apply.log"',
    'run: cat "$RUNNER_TEMP/host-apply.log"',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /never runs scrub-host-apply-log\.mjs over the captured output/,
  );
});

// ===== Secret Allowlist Checks =====

test('fails when host-apply references a secret outside the allowlist', (t) => {
  const workspace = createWorkspace(t);

  const stagingContent = readFixture(workspace, STAGING);
  const lines = stagingContent.split('\n');

  // Find the host-apply job's env section and add a disallowed secret
  let hostApplyStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('host-apply:')) {
      hostApplyStart = i;
      break;
    }
  }

  if (hostApplyStart !== -1) {
    // Find a step within host-apply and add env with disallowed secret
    for (let i = hostApplyStart; i < lines.length; i++) {
      if (lines[i].includes('run:') || lines[i].match(/^\s{8}run:/)) {
        // Insert env before this run statement
        lines.splice(
          i,
          0,
          '        env:',
          '          DISALLOWED_SECRET: ${{ secrets.NOT_IN_ALLOWLIST }}',
        );
        break;
      }
    }
  }

  writeFixture(workspace, STAGING, lines.join('\n'));

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /references secrets\.NOT_IN_ALLOWLIST.*not in HOST_APPLY_SECRET_NAMES/,
  );
});

test('fails when host-apply never references a required secret in the allowlist', (t) => {
  const workspace = createWorkspace(t);

  edit(
    workspace,
    STAGING,
    '          SELECTOR_APP_KEY: ${{ secrets.SELECTOR_APP_KEY }}\n',
    '',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /host-apply never references secrets\.SELECTOR_APP_KEY, which HOST_APPLY_SECRET_NAMES requires/,
  );
});

// ===== DATABASE_URL Secret Check =====

test('fails when DATABASE_URL appears as a secret anywhere in the file', (t) => {
  const workspace = createWorkspace(t);

  // Add a reference to secrets.DATABASE_URL anywhere in the file
  const stagingContent = readFixture(workspace, STAGING);
  const insertPoint = stagingContent.indexOf('workflow_dispatch:');
  const beforeInsert = stagingContent.slice(0, insertPoint);
  const afterInsert = stagingContent.slice(insertPoint);

  const modified =
    beforeInsert +
    'env:\n  DATABASE_SAFETY_CHECK: ${{ secrets.DATABASE_URL }}\n' +
    afterInsert;

  writeFixture(workspace, STAGING, modified);

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /references secrets\.DATABASE_URL.*must never be a GitHub secret/,
  );
});

// ===== mark-feedback-release Job Checks =====

// The job is appended last in the production workflow. Its `needs:` line is
// unique in the file, and anchoring the `if:` edit on that line keeps it off
// deploy-backend, whose `if:` text is identical.
const MARK_NEEDS = '    needs: [validate, host-apply, deploy-frontend]\n';

test('fails when mark-feedback-release drops host-apply from its needs', (t) => {
  const workspace = createWorkspace(t);

  // Without host-apply in needs, the mark can run before the apply it reports on.
  edit(
    workspace,
    PRODUCTION,
    MARK_NEEDS,
    '    needs: [validate, deploy-frontend]\n',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /mark-feedback-release.*host-apply/);
});

test('fails when mark-feedback-release drops deploy-frontend from its needs', (t) => {
  const workspace = createWorkspace(t);

  edit(
    workspace,
    PRODUCTION,
    MARK_NEEDS,
    '    needs: [validate, host-apply]\n',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /mark-feedback-release.*deploy-frontend/);
});

test('fails when mark-feedback-release can run after a failed deploy', (t) => {
  const workspace = createWorkspace(t);

  // always() would let the mark run after a failed or skipped deploy and
  // report fixes that never reached the host.
  edit(
    workspace,
    PRODUCTION,
    MARK_NEEDS + '    if: ',
    MARK_NEEDS + '    if: always() && ',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /mark-feedback-release.*always\(\)/);
});

test('fails when mark-feedback-release does not run the marking script', (t) => {
  const workspace = createWorkspace(t);

  edit(
    workspace,
    PRODUCTION,
    'run: node tools/scripts/mark-feedback-release.mjs',
    'run: echo skip',
  );

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /mark-feedback-release\.mjs/);
});

test('fails when the production workflow has no mark-feedback-release job', (t) => {
  const workspace = createWorkspace(t);

  // The job is the last one in the file, so removing it means cutting from its
  // header to the end of the file.
  const before = readFixture(workspace, PRODUCTION);
  const at = before.indexOf('\n  mark-feedback-release:\n');
  assert.notEqual(at, -1, 'fixture has no mark-feedback-release job');
  writeFixture(workspace, PRODUCTION, before.slice(0, at) + '\n');

  const result = runChecker(workspace);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /mark-feedback-release/);
});
