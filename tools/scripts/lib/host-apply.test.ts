/**
 * Tests for host-apply.mjs — the engine for CI-owned Host Apply (ADR 0056, issue #566).
 *
 * Run with: yarn host-apply:test
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  HostApplyRefusal,
  HOST_APPLY_SECRET_NAMES,
  SELECTOR_ENV_FIELD,
  SELECTOR_STORE_CANDIDATES,
  SELECTOR_STORE_PATH,
  HOST_APPLY_STEP_ORDER,
  buildSelectorLoadStep,
  buildHostApplySteps,
  renderHostApplyScript,
  buildHostApplyScript,
  assertAppRootGuard,
  buildSelectorProbeScript,
  findHostApplyLogLeaks,
  assertHostApplyLogClean,
  assertHostApplyProbesHealthy,
  findMissingPackagerPrismaScripts,
} from './host-apply.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');

// === Area 1: Builder order ===

test('buildHostApplySteps returns steps in HOST_APPLY_STEP_ORDER', () => {
  const result = buildHostApplySteps({
    nodevenvActivate: '/home/user/.nvm/nvm.sh',
    appRoot: '/var/app',
    selectorAppKey: 'my-app',
  });

  const ids = result.map((step) => step.id);
  assert.deepEqual(ids, HOST_APPLY_STEP_ORDER);
});

test('buildHostApplySteps npm-ci command is exactly npm ci --omit=dev', () => {
  const result = buildHostApplySteps({
    nodevenvActivate: '/home/user/.nvm/nvm.sh',
    appRoot: '/var/app',
    selectorAppKey: 'my-app',
  });

  const npmCi = result.find((step) => step.id === 'npm-ci')!;
  assert.equal(npmCi.command, 'npm ci --omit=dev');
});

test('buildHostApplySteps prisma commands use npm run (not npx)', () => {
  const result = buildHostApplySteps({
    nodevenvActivate: '/home/user/.nvm/nvm.sh',
    appRoot: '/var/app',
    selectorAppKey: 'my-app',
  });

  const migrate = result.find((step) => step.id === 'prisma-migrate-deploy')!;
  assert.equal(migrate.command, 'npm run prisma:migrate:deploy');

  const generate = result.find((step) => step.id === 'prisma-generate')!;
  assert.equal(generate.command, 'npm run prisma:generate');
});

test('buildHostApplySteps restart step creates tmp/ before touching restart.txt', () => {
  const result = buildHostApplySteps({
    nodevenvActivate: '/home/user/.nvm/nvm.sh',
    appRoot: '/var/app',
    selectorAppKey: 'my-app',
  });

  const restart = result.find((step) => step.id === 'restart')!;
  assert.equal(restart.command, 'mkdir -p tmp && touch tmp/restart.txt');
});

test('renderHostApplyScript starts with set -euo pipefail', () => {
  const steps = buildHostApplySteps({
    nodevenvActivate: '/home/user/.nvm/nvm.sh',
    appRoot: '/var/app',
    selectorAppKey: 'my-app',
  });

  const script = renderHostApplyScript(steps);
  assert.match(script, /^set -euo pipefail\n/);
});

test('renderHostApplyScript joins steps in order separated by newlines', () => {
  const steps = buildHostApplySteps({
    nodevenvActivate: '/home/user/.nvm/nvm.sh',
    appRoot: '/var/app',
    selectorAppKey: 'my-app',
  });

  const script = renderHostApplyScript(steps);
  const lines = script.split('\n');

  // First line is set -euo pipefail
  assert.equal(lines[0], 'set -euo pipefail');

  // Script contains all the commands in order
  assert.ok(script.includes('source'));
  assert.ok(script.includes('cd'));
  assert.ok(script.includes('npm ci --omit=dev'));
  assert.ok(script.includes('npm run prisma:migrate:deploy'));
  assert.ok(script.includes('npm run prisma:generate'));
  assert.ok(script.includes('mkdir -p tmp && touch tmp/restart.txt'));
});

// === Area 2: Builder refuses unsafe input ===

test('buildHostApplySteps throws when appRoot is missing', () => {
  assert.throws(
    () =>
      buildHostApplySteps({
        nodevenvActivate: '/home/user/.nvm/nvm.sh',
        selectorAppKey: 'my-app',
      }),
    (err) =>
      err instanceof HostApplyRefusal && err.message.includes('APP_ROOT'),
  );
});

test('buildHostApplySteps throws when selectorAppKey is missing', () => {
  assert.throws(
    () =>
      buildHostApplySteps({
        nodevenvActivate: '/home/user/.nvm/nvm.sh',
        appRoot: '/var/app',
      }),
    (err) =>
      err instanceof HostApplyRefusal &&
      err.message.includes('SELECTOR_APP_KEY'),
  );
});

test('buildHostApplySteps throws when nodevenvActivate is missing', () => {
  assert.throws(
    () =>
      buildHostApplySteps({
        appRoot: '/var/app',
        selectorAppKey: 'my-app',
      }),
    (err) =>
      err instanceof HostApplyRefusal &&
      err.message.includes('NODEVENV_ACTIVATE'),
  );
});

test('activate step suspends set -u across the vendor script and restores it', () => {
  // CloudLinux's nodevenv activate reads CL_VIRTUAL_ENV unguarded, so `set -u`
  // aborted the apply on its line 78 — before node was on PATH. Found by
  // running the preflight against a real host (#569).
  const steps = buildHostApplySteps({
    nodevenvActivate: '/home/user/nodevenv/app/22/bin/activate',
    appRoot: '/var/app',
    selectorAppKey: 'my-app',
  });
  const activate = steps.find((step) => step.id === 'activate-nodevenv')!;

  const lines = activate.command.split('\n');
  assert.equal(lines[0], 'set +u');
  assert.match(lines[1], /^source /);
  assert.equal(lines[2], 'set -u');
});

test('an unguarded variable in the activate script does not abort the script', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'activate-unbound-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // A stand-in for the vendor script: reads an unset variable, as CloudLinux does.
  const activate = join(dir, 'activate');
  writeFileSync(activate, 'echo "venv: $CL_VIRTUAL_ENV"\n');

  const steps = buildHostApplySteps({
    nodevenvActivate: activate,
    appRoot: dir,
    selectorAppKey: 'my-app',
  });
  const upToActivate = renderHostApplyScript(steps.slice(0, 1));

  const result = spawnSync('bash', ['-c', `${upToActivate}\necho SURVIVED`], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SURVIVED/);
});

test('set -u is back on after the activate step', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'activate-restores-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const activate = join(dir, 'activate');
  writeFileSync(activate, 'echo "venv: $CL_VIRTUAL_ENV"\n');

  const steps = buildHostApplySteps({
    nodevenvActivate: activate,
    appRoot: dir,
    selectorAppKey: 'my-app',
  });

  // Our own unset variable must still abort — suspending -u is scoped to the
  // vendor script, not a blanket relaxation for the rest of the sequence.
  const script = `${renderHostApplyScript(steps.slice(0, 1))}\necho "$OUR_OWN_TYPO"\necho SURVIVED`;
  const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  assert.ok(!result.stdout.includes('SURVIVED'));
});

// === Area 3: Selector isolation ===

test('buildSelectorLoadStep embeds the key literally with JSON.stringify', () => {
  const result = buildSelectorLoadStep('my-test-app');

  // JSON.stringify('my-test-app') produces "my-test-app" (with quotes)
  assert.ok(result.includes('"my-test-app"'));
});

test('buildSelectorLoadStep contains no sibling-enumeration patterns', () => {
  const result = buildSelectorLoadStep('my-app');

  // Should not contain Object.keys, for...in, or for...of
  assert.ok(
    !/Object\.keys|for\s*\(.*\bin\b|for\s*\(.*\bof\b/.test(result),
    'contains forbidden enumeration pattern',
  );
});

test('buildSelectorLoadStep never echoes or logs DATABASE_URL', () => {
  const result = buildSelectorLoadStep('my-app');

  // Should not echo the DATABASE_URL value itself (error messages echoed to stderr are ok)
  // Check that the node script uses process.stdout.write (not echo or console.log to output the value)
  assert.ok(result.includes('process.stdout.write(url)'));
  assert.ok(!result.includes('console.log(url)'));
  assert.ok(!result.includes('echo $DATABASE_URL'));
  assert.ok(!result.includes('echo "$DATABASE_URL"'));
});

test('buildSelectorLoadStep throws when selectorAppKey is empty', () => {
  assert.throws(
    () => buildSelectorLoadStep(''),
    (err) =>
      err instanceof HostApplyRefusal &&
      err.message.includes('SELECTOR_APP_KEY'),
  );
});

test('buildSelectorLoadStep throws when selectorAppKey is missing', () => {
  assert.throws(
    () => buildSelectorLoadStep(undefined),
    (err) =>
      err instanceof HostApplyRefusal &&
      err.message.includes('SELECTOR_APP_KEY'),
  );
});

// === Area 3b: Selector isolation (runtime behavior) ===

test('selector fragment refuses when app identity is not in store', (t) => {
  const tmpHome = mkdtempSync(join(tmpdir(), 'selector-missing-identity-'));
  t.after(() => rmSync(tmpHome, { recursive: true, force: true }));

  const storeFile = join(tmpHome, SELECTOR_STORE_PATH);
  mkdirSync(dirname(storeFile), { recursive: true });

  // Create a store with some app but NOT the one we'll request
  writeFileSync(
    storeFile,
    JSON.stringify({
      'other-app': {
        [SELECTOR_ENV_FIELD]: { DATABASE_URL: 'postgres://other:pass@host/db' },
      },
    }),
  );

  const fragment = buildSelectorLoadStep('missing-app-key');
  const result = spawnSync('bash', ['-c', fragment], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0, 'should exit non-zero');
  assert.ok(
    result.stderr.includes('refused'),
    'stderr should contain refusal message',
  );
  assert.ok(
    !result.stdout.includes('postgres://'),
    'stdout should not contain connection string',
  );
});

test('selector fragment refuses when DATABASE_URL key is missing from envvars', (t) => {
  const tmpHome = mkdtempSync(join(tmpdir(), 'selector-missing-dburl-'));
  t.after(() => rmSync(tmpHome, { recursive: true, force: true }));

  const storeFile = join(tmpHome, SELECTOR_STORE_PATH);
  mkdirSync(dirname(storeFile), { recursive: true });

  // Create a store with the app but envvars lacks DATABASE_URL
  writeFileSync(
    storeFile,
    JSON.stringify({
      'my-app': {
        [SELECTOR_ENV_FIELD]: { SOME_OTHER_VAR: 'value' },
      },
    }),
  );

  const fragment = buildSelectorLoadStep('my-app');
  const result = spawnSync('bash', ['-c', fragment], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0, 'should exit non-zero');
  assert.ok(
    result.stderr.includes('refused'),
    'stderr should contain refusal message',
  );
  assert.ok(
    !result.stdout.includes('value'),
    'stdout should not contain any envvars value',
  );
});

test('selector fragment succeeds and does not print the value to stdout', (t) => {
  const tmpHome = mkdtempSync(join(tmpdir(), 'selector-success-'));
  t.after(() => rmSync(tmpHome, { recursive: true, force: true }));

  const storeFile = join(tmpHome, SELECTOR_STORE_PATH);
  mkdirSync(dirname(storeFile), { recursive: true });

  const fixtureUrl =
    'postgres://fixture-user:fixture-pass@fixture-host:5432/fixture-db';

  // Create a store with the app and proper DATABASE_URL
  writeFileSync(
    storeFile,
    JSON.stringify({
      'my-app': {
        [SELECTOR_ENV_FIELD]: { DATABASE_URL: fixtureUrl },
      },
    }),
  );

  const fragment = buildSelectorLoadStep('my-app');

  // Test 1: Fragment alone produces empty stdout (value captured in variable, not printed)
  const result1 = spawnSync('bash', ['-c', fragment], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });

  assert.equal(result1.status, 0, 'should succeed');
  assert.equal(
    result1.stdout,
    '',
    'fragment itself should not print to stdout',
  );

  // Test 2: Fragment wrapped with a test-provided echo shows variable was exported
  const wrappedCommand = `${fragment}\necho GOT:$DATABASE_URL`;
  const result2 = spawnSync('bash', ['-c', wrappedCommand], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });

  assert.equal(result2.status, 0, 'should succeed with wrapper echo');
  assert.ok(
    result2.stdout.includes('GOT:postgres://fixture-user:fixture-pass'),
    'wrapper echo should show the exported value',
  );
  // Verify the fixture value appears only in the wrapper echo line, not elsewhere
  const lines = result2.stdout.split('\n');
  const gotLine = lines.find((l) => l.startsWith('GOT:'))!;
  assert.ok(gotLine, 'should have GOT: line from wrapper');
  assert.ok(
    gotLine.includes(fixtureUrl),
    'GOT line should contain the fixture value',
  );
});

test('selector fragment refuses cleanly when store file is missing', (t) => {
  const tmpHome = mkdtempSync(join(tmpdir(), 'selector-no-file-'));
  t.after(() => rmSync(tmpHome, { recursive: true, force: true }));

  // Do NOT create the selector store at all

  const fragment = buildSelectorLoadStep('my-app');
  const result = spawnSync('bash', ['-c', fragment], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0, 'should exit non-zero');
  assert.ok(
    result.stderr.includes('refused'),
    'stderr should contain refusal message',
  );
  // Confirm no stack trace or internal paths leaked beyond the error message
  assert.ok(!result.stderr.includes('at '), 'should not contain stack trace');
});

// === Area 3b: the secret-name contract ===

test('HOST_APPLY_SECRET_NAMES never contains DATABASE_URL', () => {
  assert.ok(!HOST_APPLY_SECRET_NAMES.includes('DATABASE_URL'));
});

test('HOST_APPLY_SECRET_NAMES carries the two guard inputs', () => {
  // Both were absent from the PRD's original list of eight, and their absence
  // is what left the APP_ROOT collision check and host-key verification inert.
  assert.ok(HOST_APPLY_SECRET_NAMES.includes('COUNTERPART_APP_ROOT'));
  assert.ok(HOST_APPLY_SECRET_NAMES.includes('SSH_KNOWN_HOSTS'));
});

// === Area 4: APP_ROOT guard ===

test('assertAppRootGuard throws when appRoot is empty', () => {
  assert.throws(
    () =>
      assertAppRootGuard({
        environment: 'staging',
        appRoot: '',
        counterpartAppRoot: '/var/prod-app',
      }),
    (err) =>
      err instanceof HostApplyRefusal && err.message.includes('APP_ROOT'),
  );
});

test('assertAppRootGuard throws when appRoot is undefined', () => {
  assert.throws(
    () =>
      assertAppRootGuard({
        environment: 'staging',
        appRoot: undefined,
        counterpartAppRoot: '/var/prod-app',
      }),
    (err) =>
      err instanceof HostApplyRefusal && err.message.includes('APP_ROOT'),
  );
});

test('assertAppRootGuard throws when staging appRoot equals production counterpart', () => {
  const sharedRoot = '/var/app';

  assert.throws(
    () =>
      assertAppRootGuard({
        environment: 'staging',
        appRoot: sharedRoot,
        counterpartAppRoot: sharedRoot,
      }),
    (err) =>
      err instanceof HostApplyRefusal && err.message.includes('Production'),
  );
});

test('assertAppRootGuard throws when production appRoot equals staging counterpart', () => {
  const sharedRoot = '/var/app';

  assert.throws(
    () =>
      assertAppRootGuard({
        environment: 'production',
        appRoot: sharedRoot,
        counterpartAppRoot: sharedRoot,
      }),
    (err) => err instanceof HostApplyRefusal && err.message.includes('Staging'),
  );
});

test('assertAppRootGuard returns appRoot when staging differs from production', () => {
  const stagingRoot = '/var/staging-app';
  const result = assertAppRootGuard({
    environment: 'staging',
    appRoot: stagingRoot,
    counterpartAppRoot: '/var/prod-app',
  });

  assert.equal(result, stagingRoot);
});

test('assertAppRootGuard returns appRoot when production differs from staging', () => {
  const prodRoot = '/var/prod-app';
  const result = assertAppRootGuard({
    environment: 'production',
    appRoot: prodRoot,
    counterpartAppRoot: '/var/staging-app',
  });

  assert.equal(result, prodRoot);
});

test('assertAppRootGuard throws when counterpartAppRoot is missing', () => {
  // Without the other environment's pin the guard degrades to the unset check,
  // which is what let a Staging apply reach Production's root unchallenged.
  assert.throws(
    () =>
      assertAppRootGuard({
        environment: 'staging',
        appRoot: '/var/staging-app',
      }),
    (err) =>
      err instanceof HostApplyRefusal &&
      err.message.includes('COUNTERPART_APP_ROOT'),
  );
});

test('assertAppRootGuard throws when counterpartAppRoot is empty', () => {
  assert.throws(
    () =>
      assertAppRootGuard({
        environment: 'production',
        appRoot: '/var/prod-app',
        counterpartAppRoot: '   ',
      }),
    (err) =>
      err instanceof HostApplyRefusal &&
      err.message.includes('COUNTERPART_APP_ROOT'),
  );
});

test('assertAppRootGuard throws on unknown environment', () => {
  assert.throws(
    () =>
      assertAppRootGuard({
        environment: 'unknown',
        appRoot: '/var/app',
        counterpartAppRoot: '/var/other-app',
      }),
    (err) =>
      err instanceof HostApplyRefusal &&
      err.message.includes('unknown Host Apply environment'),
  );
});

// === Area 5: Log redaction ===

test('assertHostApplyLogClean throws for connection string leak', () => {
  const logWithLeak =
    'Connecting to postgres://user:password@localhost:5432/db\n';

  assert.throws(
    () => assertHostApplyLogClean(logWithLeak),
    (err) =>
      err instanceof HostApplyRefusal &&
      err.message.includes('redaction violation'),
  );
});

test('assertHostApplyLogClean throws for bare DATABASE_URL assignment', () => {
  const logWithLeak = 'Setting DATABASE_URL=postgres://localhost\n';

  assert.throws(
    () => assertHostApplyLogClean(logWithLeak),
    (err) =>
      err instanceof HostApplyRefusal &&
      err.message.includes('redaction violation'),
  );
});

test('assertHostApplyLogClean does not throw for clean log', () => {
  const cleanLog =
    'npm ci completed\nPrisma migration succeeded\nRestart command executed\n';

  assert.doesNotThrow(() => assertHostApplyLogClean(cleanLog));
});

test('findHostApplyLogLeaks returns empty array for clean log', () => {
  const cleanLog =
    'npm ci completed\nPrisma migration succeeded\nRestart command executed\n';

  const leaks = findHostApplyLogLeaks(cleanLog);

  assert.deepEqual(leaks, []);
});

test('findHostApplyLogLeaks detects connection string on the correct line', () => {
  const logWithLeak =
    'Step 1\nConnecting to mysql://user:pass@host/db\nStep 2\n';

  const leaks = findHostApplyLogLeaks(logWithLeak);

  assert.equal(leaks.length, 1);
  assert.equal(leaks[0].rule, 'connection-string');
  assert.equal(leaks[0].line, 2);
});

test('findHostApplyLogLeaks detects DATABASE_URL assignment on the correct line', () => {
  const logWithLeak = 'Step 1\nDATABASE_URL=somevalue\nStep 2\n';

  const leaks = findHostApplyLogLeaks(logWithLeak);

  assert.ok(leaks.some((l) => l.rule === 'database-url-assignment'));
  assert.ok(leaks.some((l) => l.line === 2));
});

// === Area 6: Packager contract ===

test('findMissingPackagerPrismaScripts returns empty array for real package-backend-api.ts', () => {
  const packagerPath = join(REPO, 'tools/scripts/package-backend-api.ts');
  const packagerSource = readFileSync(packagerPath, 'utf8');

  const missing = findMissingPackagerPrismaScripts(packagerSource);

  assert.deepEqual(missing, []);
});

test('findMissingPackagerPrismaScripts detects missing prisma:migrate:deploy', () => {
  const packagerSource = `
    scripts: {
      'prisma:generate': 'npm run --prefix dist/apps/backend prisma generate',
    }
  `;

  const missing = findMissingPackagerPrismaScripts(packagerSource);

  assert.ok(missing.includes('prisma:migrate:deploy'));
  assert.ok(!missing.includes('prisma:generate'));
});

test('findMissingPackagerPrismaScripts detects missing prisma:generate', () => {
  const packagerSource = `
    scripts: {
      'prisma:migrate:deploy': 'npm run --prefix dist/apps/backend prisma migrate deploy --',
    }
  `;

  const missing = findMissingPackagerPrismaScripts(packagerSource);

  assert.ok(!missing.includes('prisma:migrate:deploy'));
  assert.ok(missing.includes('prisma:generate'));
});

test('buildHostApplyScript returns both steps and script', () => {
  const result = buildHostApplyScript({
    nodevenvActivate: '/home/user/.nvm/nvm.sh',
    appRoot: '/var/app',
    selectorAppKey: 'my-app',
  });

  assert.ok(Array.isArray(result.steps));
  assert.equal(result.steps.length, HOST_APPLY_STEP_ORDER.length);
  assert.equal(typeof result.script, 'string');
  assert.ok(result.script.startsWith('set -euo pipefail'));
});

// === Area 7: HTTP probe grading ===

test('assertHostApplyProbesHealthy returns without throwing when both probes are healthy', () => {
  assert.doesNotThrow(() =>
    assertHostApplyProbesHealthy({
      docsStatus: 200,
      cronStatus: 401,
    }),
  );
});

test('assertHostApplyProbesHealthy accepts docsStatus at 200 boundary', () => {
  assert.doesNotThrow(() =>
    assertHostApplyProbesHealthy({
      docsStatus: 200,
      cronStatus: 401,
    }),
  );
});

test('assertHostApplyProbesHealthy accepts docsStatus at 299 boundary', () => {
  assert.doesNotThrow(() =>
    assertHostApplyProbesHealthy({
      docsStatus: 299,
      cronStatus: 401,
    }),
  );
});

test('assertHostApplyProbesHealthy throws when docsStatus is 500', () => {
  assert.throws(
    () =>
      assertHostApplyProbesHealthy({
        docsStatus: 500,
        cronStatus: 401,
      }),
    (err) =>
      err instanceof HostApplyRefusal &&
      err.message.includes('500') &&
      err.message.includes('2xx'),
  );
});

test('assertHostApplyProbesHealthy throws when docsStatus is 403', () => {
  assert.throws(
    () =>
      assertHostApplyProbesHealthy({
        docsStatus: 403,
        cronStatus: 401,
      }),
    (err) =>
      err instanceof HostApplyRefusal &&
      err.message.includes('403') &&
      err.message.includes('2xx'),
  );
});

test('assertHostApplyProbesHealthy throws when cronStatus is 500', () => {
  assert.throws(
    () =>
      assertHostApplyProbesHealthy({
        docsStatus: 200,
        cronStatus: 500,
      }),
    (err) =>
      err instanceof HostApplyRefusal &&
      err.message.includes('500') &&
      err.message.includes('401'),
  );
});

test('assertHostApplyProbesHealthy throws when cronStatus is 403', () => {
  assert.throws(
    () =>
      assertHostApplyProbesHealthy({
        docsStatus: 200,
        cronStatus: 403,
      }),
    (err) =>
      err instanceof HostApplyRefusal &&
      err.message.includes('403') &&
      err.message.includes('401'),
  );
});

test('assertHostApplyProbesHealthy throws when cronStatus is 200', () => {
  assert.throws(
    () =>
      assertHostApplyProbesHealthy({
        docsStatus: 200,
        cronStatus: 200,
      }),
    (err) =>
      err instanceof HostApplyRefusal &&
      err.message.includes('200') &&
      err.message.includes('401'),
  );
});

// === Area 8: the scrubber CLI ===
//
// findHostApplyLogLeaks is graded above; what matters here is the decision the
// CLI wraps around it, because that is what stands between a leaked value and
// a public Actions log. A grader nothing calls protects nothing.

const SCRUBBER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'scrub-host-apply-log.ts',
);

function runScrubber(t: TestContext, contents: string) {
  const dir = mkdtempSync(join(tmpdir(), 'host-apply-scrub-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const logFile = join(dir, 'host-apply.log');
  writeFileSync(logFile, contents);
  return spawnSync(process.execPath, [SCRUBBER, logFile], {
    encoding: 'utf8',
  });
}

test('scrub-host-apply-log prints a clean log verbatim', (t) => {
  const log = 'added 41 packages\nAll migrations applied\n';
  const result = runScrubber(t, log);

  assert.equal(result.status, 0);
  assert.equal(result.stdout, log);
});

test('scrub-host-apply-log withholds a log carrying a connection string', (t) => {
  const secret = 'postgresql://someone:hunter2@db.internal/app';
  const result = runScrubber(t, `npm ci ok\nDATABASE_URL=${secret}\ndone\n`);

  assert.equal(result.status, 1);
  // Neither stream may repeat the value into the log we are protecting.
  assert.ok(!result.stdout.includes(secret));
  assert.ok(!result.stderr.includes(secret));
  assert.ok(!result.stdout.includes('npm ci ok'));
  assert.match(result.stderr, /line 2/);
});

test('scrub-host-apply-log refuses a missing log rather than passing silently', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'host-apply-scrub-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = spawnSync(
    process.execPath,
    [SCRUBBER, join(dir, 'absent.log')],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 2);
});

// === Area 9: the selector probe (read-only discovery, #569) ===
//
// The probe is what tells the operator whether buildSelectorLoadStep's pinned
// path is right, before a red CI run does. It runs for real against a fake
// HOME here, the same way the loader fragment is exercised above.

interface SelectorProbeRow {
  path: string;
  exists: boolean;
  parsed: boolean;
  hasPinnedKey: boolean;
  envField: string | null;
  hasDatabaseUrl: boolean;
}

function runProbe(
  t: TestContext,
  layout: Record<string, string>,
  key = 'my-app',
) {
  const tmpHome = mkdtempSync(join(tmpdir(), 'selector-probe-'));
  t.after(() => rmSync(tmpHome, { recursive: true, force: true }));

  for (const [rel, contents] of Object.entries(layout)) {
    const file = join(tmpHome, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }

  const result = spawnSync('bash', ['-c', buildSelectorProbeScript(key)], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  const report: SelectorProbeRow[] = JSON.parse(result.stdout).selectorProbe;
  return { result, report };
}

test('selector probe reports the pinned path and field when the store matches', (t) => {
  const { result, report } = runProbe(t, {
    [SELECTOR_STORE_PATH]: JSON.stringify({
      'my-app': {
        [SELECTOR_ENV_FIELD]: { DATABASE_URL: 'postgres://u:p@h/db' },
      },
    }),
  });

  assert.equal(result.status, 0);
  const hit = report.find((row) => row.hasDatabaseUrl)!;
  assert.equal(hit.path, SELECTOR_STORE_PATH);
  assert.equal(hit.envField, SELECTOR_ENV_FIELD);
});

test('selector probe finds a store the loader does not pin', (t) => {
  // The point of the probe: say so out loud rather than let CI fail red.
  const { report } = runProbe(t, {
    '.cpanel/nodejsapps.json': JSON.stringify({
      'my-app': { envvars: { DATABASE_URL: 'postgres://u:p@h/db' } },
    }),
  });

  const hit = report.find((row) => row.hasDatabaseUrl)!;
  assert.equal(hit.path, '.cpanel/nodejsapps.json');
  assert.equal(hit.envField, 'envvars');
});

test('selector probe never prints an environment value or a sibling app name', (t) => {
  const secret = 'postgres://someone:hunter2@db.internal/app';
  const { result } = runProbe(t, {
    [SELECTOR_STORE_PATH]: JSON.stringify({
      'my-app': {
        [SELECTOR_ENV_FIELD]: { DATABASE_URL: secret, OTHER: 'also-secret' },
      },
      'someone-elses-app': { [SELECTOR_ENV_FIELD]: { DATABASE_URL: secret } },
    }),
  });

  assert.ok(!result.stdout.includes(secret));
  assert.ok(!result.stdout.includes('hunter2'));
  assert.ok(!result.stdout.includes('also-secret'));
  assert.ok(!result.stdout.includes('someone-elses-app'));
});

test('selector probe reports a present store that lacks the pinned identity', (t) => {
  const { report } = runProbe(t, {
    [SELECTOR_STORE_PATH]: JSON.stringify({
      'other-app': {
        [SELECTOR_ENV_FIELD]: { DATABASE_URL: 'postgres://u:p@h/db' },
      },
    }),
  });

  const row = report.find((r) => r.path === SELECTOR_STORE_PATH)!;
  assert.equal(row.exists, true);
  assert.equal(row.parsed, true);
  assert.equal(row.hasPinnedKey, false);
  assert.equal(row.hasDatabaseUrl, false);
});

test('selector probe reports an unparseable store without throwing', (t) => {
  const { result, report } = runProbe(t, {
    [SELECTOR_STORE_PATH]: 'not json at all',
  });

  assert.equal(result.status, 0);
  const row = report.find((r) => r.path === SELECTOR_STORE_PATH)!;
  assert.equal(row.exists, true);
  assert.equal(row.parsed, false);
});

test('selector probe reports every candidate when nothing exists', (t) => {
  const { report } = runProbe(t, {});

  assert.equal(report.length, SELECTOR_STORE_CANDIDATES.length);
  assert.ok(report.every((row) => row.exists === false));
});

// === Area 10: probe grading reports every failure at once (#569) ===

test('assertHostApplyProbesHealthy reports both probes when both are wrong', () => {
  // The first live apply failed on /docs, was fixed, and only then revealed the
  // cron probe was wrong too. One apply per finding is too slow a loop.
  assert.throws(
    () => assertHostApplyProbesHealthy({ docsStatus: 301, cronStatus: 403 }),
    (err) =>
      err instanceof HostApplyRefusal &&
      err.message.includes('301') &&
      err.message.includes('403'),
  );
});

test('a 3xx /docs says the probe did not follow a redirect', () => {
  assert.throws(
    () => assertHostApplyProbesHealthy({ docsStatus: 301, cronStatus: 401 }),
    (err) =>
      err instanceof HostApplyRefusal && /301 to \/docs\//.test(err.message),
  );
});

test('a 403 cron says the host answered, not the API', () => {
  assert.throws(
    () => assertHostApplyProbesHealthy({ docsStatus: 200, cronStatus: 403 }),
    (err) =>
      err instanceof HostApplyRefusal &&
      /host answering, not the API/.test(err.message),
  );
});

test('a 500 cron carries no host-403 hint', () => {
  // 500 is the stale-Prisma-client case, a different problem entirely.
  assert.throws(
    () => assertHostApplyProbesHealthy({ docsStatus: 200, cronStatus: 500 }),
    (err) =>
      err instanceof HostApplyRefusal &&
      err.message.includes('500') &&
      !err.message.includes('host answering'),
  );
});
