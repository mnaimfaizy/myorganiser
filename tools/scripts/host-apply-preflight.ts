#!/usr/bin/env node
// Read-only rehearsal of CI-owned Host Apply against a real host (ADR 0056,
// issue #569). Run it from a laptop with the same values you are about to put
// in a GitHub Environment; it answers "will the CI job work?" without pushing
// anything, and without changing a byte on the host.
//
//   APP_ROOT=... COUNTERPART_APP_ROOT=... NODEVENV_ACTIVATE=... \
//   SELECTOR_APP_KEY=... API_ORIGIN=... \
//   SSH_HOST=... SSH_PORT=... SSH_USER=... SSH_KEY_FILE=~/.ssh/id_ed25519_myorg_deploy \
//   node tools/scripts/host-apply-preflight.ts staging
//
// What it does NOT do, on purpose: no `npm ci`, no `prisma migrate deploy`, no
// `prisma generate`, no restart. Every remote command here reads. The first
// mutation of the host should be a real Host Apply run, not a rehearsal that
// half-applied and left you guessing which half.
//
// Secrets: `DATABASE_URL` is never fetched, printed, or compared — only its
// presence is reported. All remote output passes the same redaction scrubber
// CI uses before any of it reaches your terminal.
//
// Exit 0 = every check passed, the environment is ready. Exit 1 = at least one
// check failed (each one prints why). Exit 2 = bad invocation.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  HostApplyRefusal,
  REQUIRED_PACKAGER_PRISMA_SCRIPTS,
  SELECTOR_ENV_FIELD,
  SELECTOR_STORE_PATH,
  assertAppRootGuard,
  assertHostApplyProbesHealthy,
  buildActivateCommand,
  buildSelectorProbeScript,
  findHostApplyLogLeaks,
} from './lib/host-apply.ts';

const [, , environment] = process.argv;

if (environment !== 'staging' && environment !== 'production') {
  console.error(
    `host-apply-preflight: expected staging or production, got ${JSON.stringify(environment)}`,
  );
  process.exit(2);
}

const env = (name: string): string | undefined => process.env[name];

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  kind: 'readiness' | 'health';
}

/**
 * Two kinds of check, and only one of them is a gate.
 *
 * `readiness` is what must hold before an apply can safely run: the secrets,
 * the guard, the connection, the tree, the store. `health` describes the state
 * an apply is supposed to *produce* — a live API answering its probes. On a
 * backend that has never been applied, health cannot pass: `npm ci` has not run
 * there, so Passenger cannot boot the app, so `/docs` is a 503. Gating on that
 * would tell the operator to fix the exact thing they are about to run Host
 * Apply to fix.
 */
const results: CheckResult[] = [];
const pass = (
  name: string,
  detail: string,
  kind: 'readiness' | 'health' = 'readiness',
): void => {
  results.push({ name, ok: true, detail, kind });
};
const fail = (
  name: string,
  detail: string,
  kind: 'readiness' | 'health' = 'readiness',
): void => {
  results.push({ name, ok: false, detail, kind });
};

// ---------------------------------------------------------------------------
// SSH plumbing
// ---------------------------------------------------------------------------

const workdir = mkdtempSync(join(tmpdir(), 'host-apply-preflight-'));
let keyFile = env('SSH_KEY_FILE');

const privateKey = env('SSH_PRIVATE_KEY');
if (!keyFile && privateKey) {
  keyFile = join(workdir, 'key');
  writeFileSync(keyFile, `${privateKey.trimEnd()}\n`);
  chmodSync(keyFile, 0o600);
}

let knownHostsFile: string | null = null;
const knownHosts = env('SSH_KNOWN_HOSTS');
if (knownHosts) {
  knownHostsFile = join(workdir, 'known_hosts');
  writeFileSync(knownHostsFile, `${knownHosts.trimEnd()}\n`);
  chmodSync(knownHostsFile, 0o600);
}

const cleanup = () => rmSync(workdir, { recursive: true, force: true });

/**
 * Runs one command on the host and returns `{ status, stdout, stderr }`.
 * Output is scrubbed before it is handed back, so a host that echoes a
 * connection string cannot paint it across the operator's scrollback.
 */
interface RemoteResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function remote(command: string): RemoteResult {
  const args: string[] = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15'];
  if (keyFile) args.push('-i', keyFile);
  const sshPort = env('SSH_PORT');
  if (sshPort) args.push('-p', sshPort);
  if (knownHostsFile) {
    args.push('-o', 'StrictHostKeyChecking=yes');
    args.push('-o', `UserKnownHostsFile=${knownHostsFile}`);
  } else {
    // No pin supplied yet — this run is how the operator discovers the keys.
    args.push('-o', 'StrictHostKeyChecking=accept-new');
  }
  args.push(`${env('SSH_USER')}@${env('SSH_HOST')}`, 'bash -s');

  const proc = spawnSync('ssh', args, { input: command, encoding: 'utf8' });
  const scrub = (text: string | null | undefined): string =>
    findHostApplyLogLeaks(text ?? '').length > 0
      ? '<withheld: output matched a redaction rule>'
      : (text ?? '');

  return {
    status: proc.status,
    stdout: scrub(proc.stdout).trim(),
    stderr: scrub(proc.stderr).trim(),
  };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function checkRequiredVars(): boolean {
  const required = [
    'SSH_HOST',
    'SSH_USER',
    'APP_ROOT',
    'COUNTERPART_APP_ROOT',
    'NODEVENV_ACTIVATE',
    'SELECTOR_APP_KEY',
    'API_ORIGIN',
  ];
  const missing = required.filter((n) => !env(n));
  if (missing.length > 0) {
    fail('required values present', `missing: ${missing.join(', ')}`);
    return false;
  }
  if (!keyFile) {
    fail(
      'required values present',
      'set SSH_KEY_FILE (a path) or SSH_PRIVATE_KEY (the key itself)',
    );
    return false;
  }
  pass('required values present', `${required.length} names + an SSH key`);
  return true;
}

/**
 * The key CI will actually use must parse.
 *
 * A preflight run with `SSH_KEY_FILE` points at the real file on disk and so
 * never exercises the path CI takes — writing the secret's *contents* to a file
 * and reading them back. That gap let a malformed `SSH_PRIVATE_KEY` through to
 * a live run during #569, where it surfaced as `error in libcrypto`. Passing
 * `SSH_PRIVATE_KEY` instead of `SSH_KEY_FILE` rehearses the real path.
 */
function checkKeyParses(): boolean {
  const source = env('SSH_KEY_FILE') ? 'SSH_KEY_FILE' : 'SSH_PRIVATE_KEY';
  const result = spawnSync('ssh-keygen', ['-y', '-f', keyFile ?? ''], {
    encoding: 'utf8',
  });

  if (result.status === 0) {
    pass('SSH key parses', `${source} is a usable private key`);
    return true;
  }

  fail(
    'SSH key parses',
    [
      `${source} did not parse as a private key.`,
      '',
      source === 'SSH_KEY_FILE'
        ? 'Check the path points at the private half, not the .pub.'
        : 'It is empty, truncated, or lost its line breaks. Copy the file\nverbatim (macOS: pbcopy < ~/.ssh/<key>) rather than selecting text.',
      '',
      'Note that a preflight run with SSH_KEY_FILE does not exercise what CI',
      'does. To rehearse the real path, unset it and export SSH_PRIVATE_KEY',
      'with the same value the GitHub secret holds.',
    ].join('\n'),
  );
  return false;
}

/** The same guard the CI job runs, so a bad pin fails here rather than in CI. */
function checkAppRootGuard(): void {
  try {
    assertAppRootGuard({
      environment,
      appRoot: env('APP_ROOT'),
      counterpartAppRoot: env('COUNTERPART_APP_ROOT'),
    });
    pass('APP_ROOT guard', `${environment} root differs from its counterpart`);
  } catch (err) {
    if (!(err instanceof HostApplyRefusal)) throw err;
    fail('APP_ROOT guard', err.message);
  }
}

function checkSshReachable(): boolean {
  const result = remote('echo host-apply-preflight-ok');
  if (
    result.status === 0 &&
    result.stdout.includes('host-apply-preflight-ok')
  ) {
    pass('non-interactive SSH', 'connected with BatchMode=yes, no prompt');
    return true;
  }
  fail(
    'non-interactive SSH',
    [result.stderr || `ssh exited ${result.status} with no output`]
      .concat(diagnoseKnownHosts(result.stderr ?? ''))
      .join('\n'),
  );
  return false;
}

/**
 * A `known_hosts` entry is keyed on the host string, so keys captured for an IP
 * do nothing for a connection made by hostname. ssh reports that as a plain
 * "No ... host key is known", which reads like the pin was never set rather
 * than like it was set for a different name. Say which labels the supplied
 * value actually covers.
 */
function diagnoseKnownHosts(stderr: string): string[] {
  if (
    !knownHostsFile ||
    !/host key is known|verification failed/i.test(stderr)
  ) {
    return [];
  }

  const port = env('SSH_PORT') || '22';
  const host = env('SSH_HOST') ?? '';
  const expected = port === '22' ? host : `[${host}]:${port}`;

  const labels = [
    ...new Set(
      (env('SSH_KNOWN_HOSTS') || '')
        .split('\n')
        .map((line) => line.trim().split(/\s+/)[0])
        .filter(Boolean)
        .flatMap((field) => field.split(',')),
    ),
  ];

  if (labels.includes(expected)) {
    return [
      '',
      `SSH_KNOWN_HOSTS does cover ${expected}, so this is not a name mismatch.`,
      'The host may have changed its keys, which is worth understanding before re-pinning.',
    ];
  }

  return [
    '',
    `SSH_KNOWN_HOSTS covers: ${labels.join(', ') || '(nothing parseable)'}`,
    `but this connection is to: ${expected}`,
    '',
    'Entries are keyed on the host string, so keys scanned for an IP do not',
    'apply to a connection made by hostname. Re-scan by the name in SSH_HOST:',
    `  ssh-keyscan -p ${port} -t rsa,ecdsa,ed25519 ${host} > ~/myorg-hostkeys.txt`,
    'The fingerprints should match the ones you already verified — same keys,',
    'different label — so this does not need verifying from scratch.',
  ];
}

/** Prints the value to paste into SSH_KNOWN_HOSTS, or confirms the pin works. */
function checkHostKeyPin(): void {
  if (knownHostsFile) {
    pass('host key pin', 'connected with StrictHostKeyChecking=yes');
    return;
  }
  const port = env('SSH_PORT') || '22';
  const scan = spawnSync(
    'ssh-keyscan',
    ['-p', port, '-t', 'rsa,ecdsa,ed25519', env('SSH_HOST') ?? ''],
    { encoding: 'utf8' },
  );
  const keys = (scan.stdout || '')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'));
  if (keys.length === 0) {
    fail('host key pin', `ssh-keyscan returned nothing for port ${port}`);
    return;
  }
  fail(
    'host key pin',
    `SSH_KNOWN_HOSTS is not set. Verify these against the fingerprint your host publishes, then set them as the secret:\n\n${keys.join('\n')}\n`,
  );
}

function checkVirtualenv(): void {
  const activate = env('NODEVENV_ACTIVATE');
  const result = remote(
    `set -euo pipefail
[ -f ${shq(activate)} ] || { echo "no activate script at the configured path" >&2; exit 1; }
${buildActivateCommand(activate)}
printf 'node=%s npm=%s\\n' "$(node -v)" "$(npm -v)"`,
  );
  if (result.status === 0 && result.stdout.includes('node=')) {
    pass('Node virtualenv', result.stdout);
    return;
  }
  fail('Node virtualenv', result.stderr || result.stdout || 'no output');
}

function checkAppRootOnHost(): void {
  const appRoot = env('APP_ROOT');
  const result = remote(
    `set -euo pipefail
[ -d ${shq(appRoot)} ] || { echo "APP_ROOT is not a directory on the host" >&2; exit 1; }
${buildActivateCommand(env('NODEVENV_ACTIVATE'))}
cd ${shq(appRoot)}
[ -f package.json ] || { echo "no package.json in APP_ROOT - was the bundle ever uploaded?" >&2; exit 1; }
node -e 'const p=require("./package.json");process.stdout.write(JSON.stringify(Object.keys(p.scripts||{})))'`,
  );
  if (result.status !== 0) {
    fail('APP_ROOT on host', result.stderr || result.stdout || 'no output');
    return;
  }
  let scripts: string[] = [];
  try {
    scripts = JSON.parse(result.stdout) as string[];
  } catch {
    fail(
      'APP_ROOT on host',
      `could not read the script list: ${result.stdout}`,
    );
    return;
  }
  const missing = REQUIRED_PACKAGER_PRISMA_SCRIPTS.filter(
    (n) => !scripts.includes(n),
  );
  if (missing.length > 0) {
    fail(
      'APP_ROOT on host',
      [
        `the uploaded package.json is missing: ${missing.join(', ')}`,
        '',
        'The bundle on the host predates those scripts, and the apply calls them.',
        'This blocks an apply_only run, which applies whatever is already there.',
        'A full run (apply_only unticked) uploads a fresh bundle first and clears',
        'it — so this is a reason to choose that, not a separate task to do by hand.',
      ].join('\n'),
    );
    return;
  }
  pass(
    'APP_ROOT on host',
    `package.json exposes all ${REQUIRED_PACKAGER_PRISMA_SCRIPTS.length} Prisma scripts`,
  );
}

/** `touch tmp/restart.txt` is the restart trigger; a read-only check of it. */
function checkRestartTarget(): void {
  const result = remote(
    `set -euo pipefail
cd ${shq(env('APP_ROOT'))}
if [ -d tmp ]; then [ -w tmp ] && echo 'tmp/ exists and is writable' || { echo 'tmp/ exists but is not writable' >&2; exit 1; }
else [ -w . ] && echo 'tmp/ absent, APP_ROOT writable (apply will mkdir it)' || { echo 'tmp/ absent and APP_ROOT is not writable' >&2; exit 1; }; fi`,
  );
  if (result.status === 0) {
    pass('restart trigger', result.stdout);
    return;
  }
  fail('restart trigger', result.stderr || result.stdout || 'no output');
}

/** One row of `buildSelectorProbeScript`'s report, as the probe itself emits it. */
interface SelectorProbeRow {
  path: string;
  exists: boolean;
  parsed: boolean;
  hasPinnedKey: boolean;
  envField: string | null;
  hasDatabaseUrl: boolean;
}

/** The one assumption this engine cannot verify without a real host. */
function checkSelectorStore(): void {
  const result = remote(
    `set -euo pipefail
${buildActivateCommand(env('NODEVENV_ACTIVATE'))}
${buildSelectorProbeScript(env('SELECTOR_APP_KEY'))}`,
  );
  if (result.status !== 0) {
    fail('selector store', result.stderr || `probe exited ${result.status}`);
    return;
  }
  let report: SelectorProbeRow[];
  try {
    report = (
      JSON.parse(result.stdout) as { selectorProbe: SelectorProbeRow[] }
    ).selectorProbe;
  } catch {
    fail(
      'selector store',
      `probe returned unparseable output: ${result.stdout}`,
    );
    return;
  }

  const hit = report.find((row) => row.hasDatabaseUrl);
  if (!hit) {
    const lines = report.map(
      (r) =>
        `  ${r.path}: exists=${r.exists} parsed=${r.parsed} hasPinnedKey=${r.hasPinnedKey}`,
    );
    fail(
      'selector store',
      `no candidate path holds a DATABASE_URL for SELECTOR_APP_KEY.\n${lines.join('\n')}\n` +
        '  Check SELECTOR_APP_KEY matches the identity cPanel uses, and that\n' +
        '  DATABASE_URL is set on the app in the Node.js Selector UI.',
    );
    return;
  }

  const expected =
    hit.path === SELECTOR_STORE_PATH && hit.envField === SELECTOR_ENV_FIELD;
  if (!expected) {
    fail(
      'selector store',
      `found DATABASE_URL at ${hit.path} under "${hit.envField}", but buildSelectorLoadStep pins .cpanel/nodejsapps.json under "envvars".\n` +
        '  Update the pinned path/field in tools/scripts/lib/host-apply.ts before the first apply.',
    );
    return;
  }
  pass(
    'selector store',
    `DATABASE_URL present at ${hit.path} under "${hit.envField}" (value never read)`,
  );
}

function checkProbes(): void {
  const origin = (env('API_ORIGIN') ?? '').replace(/\/+$/, '');
  const status = (args: string[]): number => {
    const proc = spawnSync('curl', args, { encoding: 'utf8' });
    return Number(proc.stdout);
  };
  // Both request shapes must match the CI job's exactly, or the rehearsal
  // grades a different question. `-L` because /docs answers 301 to /docs/, and
  // a Content-Type because LiteSpeed rejects a bodyless, typeless POST with its
  // own HTML 403 before Node sees it.
  const docsStatus = status([
    '-sS',
    '-L',
    '--max-redirs',
    '3',
    '-o',
    '/dev/null',
    '-w',
    '%{http_code}',
    `${origin}/docs`,
  ]);
  const cronStatus = status([
    '-sS',
    '-o',
    '/dev/null',
    '-w',
    '%{http_code}',
    '-X',
    'POST',
    '-H',
    'Content-Type: application/json',
    '-H',
    'X-Cron-Secret: host-apply-preflight-wrong-secret',
    '-d',
    '{}',
    `${origin}/api/v1/youtube/cron/sync`,
  ]);
  try {
    assertHostApplyProbesHealthy({ docsStatus, cronStatus });
    pass(
      'HTTP probes',
      `/docs ${docsStatus}, wrong-secret cron ${cronStatus}`,
      'health',
    );
  } catch (err) {
    if (!(err instanceof HostApplyRefusal)) throw err;
    fail(
      'HTTP probes',
      `${err.message} (/docs ${docsStatus}, cron ${cronStatus})`,
      'health',
    );
  }
}

/** Single-quotes for the remote shell, same rule the engine uses. */
function shq(value: string | undefined): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

try {
  if (checkRequiredVars()) {
    checkAppRootGuard();
    const keyUsable = checkKeyParses();
    if (keyUsable && checkSshReachable()) {
      checkHostKeyPin();
      checkVirtualenv();
      checkAppRootOnHost();
      checkRestartTarget();
      checkSelectorStore();
    }
    checkProbes();
  }
} finally {
  cleanup();
}

const show = (rows: CheckResult[]): void => {
  for (const { name, ok, detail } of rows) {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (detail) {
      for (const line of String(detail).split('\n')) {
        console.log(`      ${line}`);
      }
    }
  }
};

const readiness = results.filter((r) => r.kind === 'readiness');
const health = results.filter((r) => r.kind === 'health');
const blocked = readiness.filter((r) => !r.ok);

console.log(`\nHost Apply preflight — ${environment}\n`);
console.log('Readiness — must pass before an apply\n');
show(readiness);

if (health.length > 0) {
  console.log('\nPost-apply health — what an apply should produce\n');
  show(health);
  if (health.some((r) => !r.ok)) {
    console.log(
      '\n      A backend that has never been applied cannot pass these: with no',
    );
    console.log(
      '      node_modules, Passenger cannot boot the app, so /docs is a 503 and',
    );
    console.log(
      '      the cron probe answers from the host rather than the API. Expected',
    );
    console.log(
      '      before the first apply. After one, a failure here is a real defect.',
    );
  }
}

console.log('');
if (blocked.length > 0) {
  console.log(
    `preflight: ${blocked.length} of ${readiness.length} readiness checks failed — fix these before running Host Apply in CI.`,
  );
  process.exit(1);
}

console.log(
  `preflight: all ${readiness.length} readiness checks passed — ${environment} is ready for a real Host Apply.`,
);
if (health.some((r) => !r.ok)) {
  console.log(
    'The API is not healthy yet. If it has never been applied, that is what the apply is for.',
  );
}
process.exit(0);
