/**
 * Tests for staging-web-deploy.ts — the decisions behind Staging's web deploy
 * (issue #1138, ADR 0128). Every read of a host, of git and of the Actions API
 * is a stub here; the command-line glue that makes the real reads is tested in
 * ../staging-web-deploy.test.mjs.
 *
 * Run with: yarn staging-web:test
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { APPLY_JOB, UPLOAD_JOB } from './staging-host-apply-guard.ts';
import {
  BUNDLE_HTACCESS,
  PLAN_INSTALL_OWED,
  PLAN_RESTART,
  READ_ATTEMPTS,
  SCHEDULE_FAIL_HEADERS,
  SCHEDULE_FAIL_UNREACHABLE,
  SCHEDULE_FAIL_UPLOADED_NOT_RUNNING,
  SCHEDULE_OUTCOMES,
  SCHEDULE_PROCEED,
  SCHEDULE_SKIP_NEWER,
  SCHEDULE_SKIP_PREDATES,
  SCHEDULE_SKIP_SERVING,
  SERVICE_WORKER_CACHE_CONTROL,
  SERVICE_WORKER_CSP,
  STATE_NONE,
  STATE_PRESENT,
  STATE_UNREADABLE,
  StagingWebDeployRefusal,
  assertBundleKeepsHostHtaccess,
  decidePlan,
  decideSchedule,
  findServiceWorkerHeaderProblems,
  hashDependencies,
  isSameSite,
  latestBackendUploadSha,
  parseDeployState,
  planDeploy,
  planSchedule,
  probeDeploy,
  readRunningHtml,
  readUploadedState,
  siteOf,
  type Fetcher,
  type ScheduleFacts,
} from './staging-web-deploy.ts';
import type { JobRecord } from './staging-host-apply-guard.ts';

const CLI = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'staging-web-deploy.mjs',
);

const WEB = 'https://staging.example.test';
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);

const DEPS_1 = { next: '16.0.0', react: '19.0.0' };
const DEPS_2 = { next: '16.0.0', react: '19.0.0', sharp: '0.34.0' };
const HASH_1 = hashDependencies({ dependencies: DEPS_1 });
const HASH_2 = hashDependencies({ dependencies: DEPS_2 });

const html = (sha: string) => `<html><script>self.b="${sha}"</script></html>`;

const GOOD_SW_HEADERS = {
  'cache-control': SERVICE_WORKER_CACHE_CONTROL,
  'content-security-policy': SERVICE_WORKER_CSP,
};

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const readRepo = (path: string) => readFileSync(join(REPO, path), 'utf8');

const response = (
  status: number,
  body = '',
  headers: Record<string, string> = {},
) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(headers),
  text: async () => body,
});

/**
 * A host as the deploy sees it: what the process renders, what was uploaded,
 * and what `/sw.js` comes back with.
 *
 *   - `login`: HTML, null (503), 'throw', or a function of the attempt number;
 *   - `state`: an object or string (200), undefined (404), a status number,
 *     'throw', or a function of the attempt number returning any of those;
 *   - `sw`: headers (200), null (404) or 'throw'.
 */
/** An answer the host gives outright, or one that depends on the attempt. */
type HostAnswer<T> = T | ((attempt: number) => T);

interface HostOptions {
  login?: HostAnswer<string | null>;
  state?: HostAnswer<object | string | number | undefined>;
  sw?: Record<string, string> | null | 'throw';
}

function host({
  login = null,
  state = undefined,
  sw = GOOD_SW_HEADERS,
}: HostOptions = {}) {
  const calls: string[] = [];
  const attempts = { login: 0, state: 0 };
  const refused: () => never = () => {
    throw new Error('connect ECONNREFUSED');
  };
  const fetcher: Fetcher = async (url) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path === '/login') {
      attempts.login += 1;
      const body = typeof login === 'function' ? login(attempts.login) : login;
      if (body === 'throw') refused();
      return body === null ? response(503) : response(200, body);
    }
    if (path === '/deploy-state.json') {
      attempts.state += 1;
      const value = typeof state === 'function' ? state(attempts.state) : state;
      if (value === 'throw') refused();
      if (value === undefined) return response(404, 'Not Found');
      if (typeof value === 'number') return response(value, 'error');
      return response(
        200,
        typeof value === 'string' ? value : JSON.stringify(value),
      );
    }
    if (path === '/sw.js') {
      if (sw === 'throw') refused();
      return sw === null ? response(404) : response(200, '// sw', sw);
    }
    return response(404);
  };
  return { fetcher, calls };
}

/** A sleep that returns at once and records how long it was asked to wait. */
function noSleep() {
  const waits: number[] = [];
  return {
    waits,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  };
}

/** A clock the probe advances by sleeping, so no test waits in real time. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

// === Same site ===

test('subdomains of one domain are the same site', () => {
  assert.equal(
    isSameSite('https://staging.example.com', 'https://api.example.com'),
    true,
  );
  assert.equal(
    isSameSite('https://example.com', 'https://api.staging.example.com/api/v1'),
    true,
  );
});

test('identical hosts are the same site, whatever the port or case', () => {
  assert.equal(
    isSameSite('http://localhost:4200', 'http://localhost:3000'),
    true,
  );
  assert.equal(
    isSameSite('https://App.Example.com', 'https://app.example.com'),
    true,
  );
});

test('different parent domains are different sites', () => {
  assert.equal(
    isSameSite('https://staging.example.com', 'https://api.example.org'),
    false,
  );
  assert.equal(
    isSameSite('https://app.one.test', 'https://api.two.test'),
    false,
  );
});

test('a vercel.app address and a custom domain are different sites', () => {
  // The defect of #1138: the refresh cookie set by the API is never sent.
  assert.equal(
    isSameSite('https://myapp.vercel.app', 'https://api.example.com'),
    false,
  );
});

test('siteOf is the last two labels — a rule of thumb, and wrong for co.uk', () => {
  assert.equal(siteOf('https://a.b.example.com'), 'example.com');
  // Documented limitation, pinned so nobody mistakes it for the Public Suffix List.
  assert.equal(isSameSite('https://one.co.uk', 'https://two.co.uk'), true);
});

test('an origin that is not a URL is refused without echoing it', () => {
  assert.throws(
    () => isSameSite('not a url', 'https://api.example.com'),
    (err) =>
      err instanceof StagingWebDeployRefusal && !/not a url/.test(err.message),
  );
});

test('the CLI exits 1 on different sites and names the consequence, not the hosts', () => {
  const different = spawnSync(
    process.execPath,
    [CLI, 'same-site', 'https://myapp.vercel.app', 'https://api.example.com'],
    { encoding: 'utf8' },
  );
  assert.equal(different.status, 1);
  assert.match(different.stderr, /refresh cookie/);
  assert.doesNotMatch(different.stderr + different.stdout, /vercel|example/);

  const same = spawnSync(
    process.execPath,
    [CLI, 'same-site', 'https://web.example.com', 'https://api.example.com'],
    { encoding: 'utf8' },
  );
  assert.equal(same.status, 0, same.stderr);
});

// === Dependency hash and state ===

test('hashDependencies ignores key order and sees a version change', () => {
  assert.equal(
    hashDependencies({ dependencies: { react: '19.0.0', next: '16.0.0' } }),
    HASH_1,
  );
  assert.notEqual(
    hashDependencies({ dependencies: { ...DEPS_1, next: '16.0.1' } }),
    HASH_1,
  );
  assert.notEqual(HASH_1, HASH_2);
});

test('parseDeployState rejects anything this module did not write', () => {
  assert.equal(parseDeployState(null), null);
  assert.equal(parseDeployState({ sha: '', depsHash: HASH_1 }), null);
  assert.equal(parseDeployState({ sha: SHA_A, depsHash: 'nope' }), null);
  assert.deepEqual(parseDeployState({ sha: SHA_A, depsHash: HASH_1 }), {
    sha: SHA_A,
    depsHash: HASH_1,
    installedDepsHash: null,
  });
});

// === Reading the host: three outcomes that must not be confused ===

const stateFor = (sha: string) => ({
  sha,
  depsHash: HASH_1,
  installedDepsHash: HASH_1,
});

test('a valid state file is present', async () => {
  const { fetcher, calls } = host({ state: stateFor(SHA_A) });
  const read = await readUploadedState(fetcher, WEB, noSleep());
  assert.deepEqual(read, { status: STATE_PRESENT, state: stateFor(SHA_A) });
  assert.equal(calls.length, 1);
});

test('a 404 is no state — the first deploy — and is not retried', async () => {
  const { fetcher, calls } = host();
  const read = await readUploadedState(fetcher, WEB, noSleep());
  assert.deepEqual(read, { status: STATE_NONE, state: null });
  assert.equal(calls.length, 1);
});

test('no answer, a server error and an unparseable 200 are each unreadable, after three tries', async () => {
  for (const state of [
    'throw',
    503,
    500,
    '<html>Not Found</html>',
    '{"sha":"nope"}',
  ]) {
    const { fetcher, calls } = host({ state });
    const clock = noSleep();
    const read = await readUploadedState(fetcher, WEB, clock);
    assert.deepEqual(read, { status: STATE_UNREADABLE, state: null });
    assert.equal(calls.length, READ_ATTEMPTS);
    assert.equal(clock.waits.length, READ_ATTEMPTS - 1);
  }
});

test('a state file that answers on the second try is read', async () => {
  const { fetcher } = host({
    state: (attempt) => (attempt === 1 ? 'throw' : stateFor(SHA_A)),
  });
  const read = await readUploadedState(fetcher, WEB, noSleep());
  assert.equal(read.status, STATE_PRESENT);
});

test('/login that does not answer is null after three tries, and HTML as soon as it does', async () => {
  const down = host({ login: 'throw' });
  assert.equal(await readRunningHtml(down.fetcher, WEB, noSleep()), null);
  assert.equal(down.calls.length, READ_ATTEMPTS);

  const slow = host({ login: (attempt) => (attempt < 3 ? null : html(SHA_A)) });
  assert.equal(
    await readRunningHtml(slow.fetcher, WEB, noSleep()),
    html(SHA_A),
  );
});

// === Plan ===

test('first deploy: no state on the host means an install is owed', async () => {
  const { fetcher } = host({ login: html('some-default-build-id') });

  const plan = await planDeploy({
    fetcher,
    webOrigin: WEB,
    sha: SHA_A,
    packageJson: { dependencies: DEPS_1 },
  });

  assert.equal(plan.action, PLAN_INSTALL_OWED);
  assert.deepEqual(plan.state, {
    sha: SHA_A,
    depsHash: HASH_1,
    installedDepsHash: null,
  });
});

test('unchanged dependencies with the uploaded build running: restart', async () => {
  const { fetcher } = host({
    login: html(SHA_A),
    state: { sha: SHA_A, depsHash: HASH_1, installedDepsHash: HASH_1 },
  });

  const plan = await planDeploy({
    fetcher,
    webOrigin: WEB,
    sha: SHA_B,
    packageJson: { dependencies: DEPS_1 },
  });

  assert.equal(plan.action, PLAN_RESTART);
  assert.deepEqual(plan.state, {
    sha: SHA_B,
    depsHash: HASH_1,
    installedDepsHash: HASH_1,
  });
});

test('changed dependencies: install owed, and the proven list is carried forward', async () => {
  const { fetcher } = host({
    login: html(SHA_A),
    state: { sha: SHA_A, depsHash: HASH_1, installedDepsHash: HASH_1 },
  });

  const plan = await planDeploy({
    fetcher,
    webOrigin: WEB,
    sha: SHA_B,
    packageJson: { dependencies: DEPS_2 },
  });

  assert.equal(plan.action, PLAN_INSTALL_OWED);
  assert.deepEqual(plan.state, {
    sha: SHA_B,
    depsHash: HASH_2,
    installedDepsHash: HASH_1,
  });
});

test('install still owed: a later commit does not promote an unproven list', async () => {
  // B was uploaded with new dependencies and nobody installed: A still runs.
  const { fetcher } = host({
    login: html(SHA_A),
    state: { sha: SHA_B, depsHash: HASH_2, installedDepsHash: HASH_1 },
  });

  const plan = await planDeploy({
    fetcher,
    webOrigin: WEB,
    sha: SHA_C,
    packageJson: { dependencies: DEPS_2 },
  });

  assert.equal(plan.action, PLAN_INSTALL_OWED);
  assert.equal(plan.state.installedDepsHash, HASH_1);
});

test('operator installed after an install-owed: the list is promoted and the next run restarts', async () => {
  // Same state file as above, but the operator ran NPM Install and Restart,
  // so the process now serves B — which proves B's dependencies are installed.
  const { fetcher } = host({
    login: html(SHA_B),
    state: { sha: SHA_B, depsHash: HASH_2, installedDepsHash: HASH_1 },
  });

  const plan = await planDeploy({
    fetcher,
    webOrigin: WEB,
    sha: SHA_C,
    packageJson: { dependencies: DEPS_2 },
  });

  assert.equal(plan.action, PLAN_RESTART);
  assert.deepEqual(plan.state, {
    sha: SHA_C,
    depsHash: HASH_2,
    installedDepsHash: HASH_2,
  });
});

test('a process that is not answering falls back to the last inferred list', () => {
  const uploadedState = {
    sha: SHA_A,
    depsHash: HASH_2,
    installedDepsHash: HASH_1,
  };
  assert.equal(
    decidePlan({
      sha: SHA_B,
      depsHash: HASH_1,
      runningHtml: null,
      uploadedState,
    }).action,
    PLAN_RESTART,
  );
  assert.equal(
    decidePlan({
      sha: SHA_B,
      depsHash: HASH_2,
      runningHtml: null,
      uploadedState,
    }).action,
    PLAN_INSTALL_OWED,
  );
});

test('plan refuses a commit that is not a full SHA before any request', async () => {
  const { fetcher, calls } = host();
  await assert.rejects(
    planDeploy({
      fetcher,
      webOrigin: WEB,
      sha: 'abc1234',
      packageJson: { dependencies: DEPS_1 },
    }),
    StagingWebDeployRefusal,
  );
  assert.deepEqual(calls, []);
});

test('plan refuses, naming no host, when the state file cannot be read', async () => {
  for (const state of ['throw', 503, '<html>oops</html>']) {
    const { fetcher } = host({ login: html(SHA_A), state });
    await assert.rejects(
      planDeploy({
        fetcher,
        webOrigin: WEB,
        sha: SHA_B,
        packageJson: { dependencies: DEPS_1 },
        ...noSleep(),
      }),
      (err) =>
        err instanceof StagingWebDeployRefusal &&
        /did not answer for \/deploy-state\.json/.test(err.message) &&
        /Nothing was uploaded/.test(err.message) &&
        !/example\.test/.test(err.message),
    );
  }
});

test('plan with a readable state and a silent /login keeps the last inferred list', async () => {
  const { fetcher } = host({
    login: 'throw',
    state: { sha: SHA_A, depsHash: HASH_2, installedDepsHash: HASH_1 },
  });

  const plan = await planDeploy({
    fetcher,
    webOrigin: WEB,
    sha: SHA_B,
    packageJson: { dependencies: DEPS_1 },
    ...noSleep(),
  });

  assert.equal(plan.action, PLAN_RESTART);
  assert.equal(plan.state.installedDepsHash, HASH_1);
});

// === Probe ===

test('probe passes once the running process serves the uploaded build', async () => {
  const { fetcher, calls } = host({
    login: (attempt) => (attempt < 3 ? html(SHA_A) : html(SHA_B)),
  });

  const result = await probeDeploy({
    fetcher,
    webOrigin: WEB,
    sha: SHA_B,
    ...fakeClock(),
  });

  assert.deepEqual(result, { ok: true, attempts: 3 });
  assert.deepEqual(calls, ['/login', '/login', '/login', '/sw.js']);
});

test('probe survives a host that refuses connections while it restarts', async () => {
  const { fetcher } = host({
    login: (attempt) => (attempt === 1 ? 'throw' : html(SHA_B)),
  });

  const result = await probeDeploy({
    fetcher,
    webOrigin: WEB,
    sha: SHA_B,
    ...fakeClock(),
  });

  assert.equal(result.ok, true);
});

test('probe times out when the old build keeps answering', async () => {
  const { fetcher, calls } = host({ login: html(SHA_A) });

  const result = await probeDeploy({
    fetcher,
    webOrigin: WEB,
    sha: SHA_B,
    timeoutSeconds: 30,
    intervalSeconds: 10,
    ...fakeClock(),
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /\/login did not answer from build bbbbbbb/);
  assert.match(result.reason, /within 30s/);
  assert.doesNotMatch(result.reason, /example\.test/);
  // Never reaches the header check: an old build's headers prove nothing.
  assert.ok(!calls.includes('/sw.js'));
  assert.equal(calls.length, 4);
});

test('probe fails when /sw.js comes back without its headers', async () => {
  const { fetcher } = host({ login: html(SHA_B), sw: {} });

  const result = await probeDeploy({
    fetcher,
    webOrigin: WEB,
    sha: SHA_B,
    ...fakeClock(),
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /\/sw\.js has no Cache-Control/);
  assert.match(result.reason, /\/sw\.js has no Content-Security-Policy/);
});

test('probe fails when /sw.js carries a permissive policy', async () => {
  // Present is not enough: this header exists and confines nothing.
  const { fetcher } = host({
    login: html(SHA_B),
    sw: { ...GOOD_SW_HEADERS, 'content-security-policy': 'default-src *' },
  });

  const result = await probeDeploy({
    fetcher,
    webOrigin: WEB,
    sha: SHA_B,
    ...fakeClock(),
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.reason,
    '/sw.js Content-Security-Policy differs from the expected value',
  );
});

test('probe fails when /sw.js is missing', async () => {
  const { fetcher } = host({ login: html(SHA_B), sw: null });

  const result = await probeDeploy({
    fetcher,
    webOrigin: WEB,
    sha: SHA_B,
    ...fakeClock(),
  });

  assert.deepEqual(result, { ok: false, reason: '/sw.js answered 404' });
});

test('a wrong header value is never repeated in the problem', () => {
  // A host-level policy can name hostnames, and a log masks exact secrets only.
  const problems = findServiceWorkerHeaderProblems(
    new Headers({
      'cache-control': 'public, s-maxage=60, x-origin=internal.example.test',
      'content-security-policy': 'default-src https://internal.example.test',
    }),
  );
  assert.equal(problems.length, 2);
  assert.doesNotMatch(problems.join(' '), /example|public|https/);
});

test('service worker headers are compared exactly, but for spacing and case', () => {
  const problems = (headers: Record<string, string>) =>
    findServiceWorkerHeaderProblems(new Headers(headers));

  assert.deepEqual(problems(GOOD_SW_HEADERS), []);
  assert.deepEqual(
    problems({
      'cache-control': '  No-Cache,  no-store, must-revalidate ',
      'content-security-policy': "default-src 'self';  script-src 'self' ",
    }),
    [],
  );

  // Each of these contains no-store, or some policy, and is still wrong.
  assert.equal(
    problems({ ...GOOD_SW_HEADERS, 'cache-control': 'no-store' }).length,
    1,
  );
  assert.equal(
    problems({
      ...GOOD_SW_HEADERS,
      'cache-control': `${SERVICE_WORKER_CACHE_CONTROL}, public`,
    }).length,
    1,
  );
  assert.equal(
    problems({
      ...GOOD_SW_HEADERS,
      'content-security-policy': `${SERVICE_WORKER_CSP} 'unsafe-inline'`,
    }).length,
    1,
  );
  assert.equal(problems({ 'cache-control': 'public, max-age=3600' }).length, 2);
});

// === The three places the service worker headers are written ===

test('next.config.js sets exactly the expected service worker headers', () => {
  const config = readRepo('apps/web/next.config.js');
  const valueOf = (key: string) =>
    config.match(
      new RegExp(`key: '${key}',\\s*value:\\s*(?:'([^']*)'|"([^"]*)")`),
    );

  const cacheControl = valueOf('Cache-Control');
  const csp = valueOf('Content-Security-Policy');
  assert.equal(
    cacheControl?.[1] ?? cacheControl?.[2],
    SERVICE_WORKER_CACHE_CONTROL,
  );
  assert.equal(csp?.[1] ?? csp?.[2], SERVICE_WORKER_CSP);
});

test('the sw-headers snippet sets exactly the expected service worker headers, for sw.js only', () => {
  const snippet = readRepo('apps/web/deploy/sw-headers.htaccess');
  const directives = snippet
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  assert.deepEqual(directives, [
    '<IfModule mod_headers.c>',
    '<Files "sw.js">',
    `Header set Cache-Control "${SERVICE_WORKER_CACHE_CONTROL}"`,
    `Header set Content-Security-Policy "${SERVICE_WORKER_CSP}"`,
    '</Files>',
    '</IfModule>',
  ]);
});

// === The host's own .htaccess is never overwritten ===

test('the tree has no apps/web/public/.htaccess', () => {
  assert.equal(
    existsSync(join(REPO, 'apps/web/public/.htaccess')),
    false,
    "the host's document root is this folder and holds the host's own .htaccess; shipping one overwrites it",
  );
});

test('a bundle that carries public/.htaccess is refused', () => {
  assert.throws(
    () =>
      assertBundleKeepsHostHtaccess([
        'server.js',
        'public/sw.js',
        BUNDLE_HTACCESS,
      ]),
    (err) =>
      err instanceof StagingWebDeployRefusal &&
      /overwrite/.test(err.message) &&
      /Nothing was uploaded/.test(err.message),
  );
  assert.throws(
    () => assertBundleKeepsHostHtaccess(['public\\.htaccess']),
    StagingWebDeployRefusal,
  );
});

test('a bundle without one passes', () => {
  assert.doesNotThrow(() =>
    assertBundleKeepsHostHtaccess(['server.js', 'public/sw.js']),
  );
  assert.doesNotThrow(() => assertBundleKeepsHostHtaccess([]));
});

// === What the probe stands on ===

test('the root layout stays force-dynamic, so /login comes from the running process', () => {
  // Without it Next.js prerenders /login at build time. The page would then be
  // read from disk, and the probe, the schedule and the plan would all report
  // the uploaded build as the running one.
  assert.match(
    readRepo('apps/web/src/app/layout.tsx'),
    /^export const dynamic = 'force-dynamic';$/m,
  );
});

// === Latest backend upload ===

const job = (
  name: string,
  conclusion: string | null,
  headSha: string | null,
  completedAt: string,
) => ({
  name,
  conclusion,
  headSha,
  startedAt: completedAt,
  completedAt,
});

test('the latest successful backend upload names its commit', () => {
  assert.equal(
    latestBackendUploadSha([
      job(UPLOAD_JOB, 'success', SHA_C, '2026-10-12T10:00:00Z'),
      job(UPLOAD_JOB, 'success', SHA_A, '2026-10-10T10:00:00Z'),
      job(UPLOAD_JOB, 'success', SHA_B, '2026-10-11T10:00:00Z'),
    ]),
    SHA_C,
  );
});

test('a failed, cancelled or skipped upload, and a Host Apply, are not uploads', () => {
  assert.equal(
    latestBackendUploadSha([
      job(UPLOAD_JOB, 'success', SHA_A, '2026-10-10T10:00:00Z'),
      job(UPLOAD_JOB, 'failure', SHA_B, '2026-10-11T10:00:00Z'),
      job(UPLOAD_JOB, 'cancelled', SHA_B, '2026-10-12T10:00:00Z'),
      job(UPLOAD_JOB, 'skipped', SHA_B, '2026-10-13T10:00:00Z'),
      job(APPLY_JOB, 'success', SHA_C, '2026-10-14T10:00:00Z'),
    ]),
    SHA_A,
  );
});

test('a scheduled upload after a dispatched one yields no commit', () => {
  // The schedule only uploads the newest green commit, so its own last
  // upload is never something to protect.
  assert.equal(
    latestBackendUploadSha([
      job(UPLOAD_JOB, 'success', SHA_A, '2026-10-10T10:00:00Z'),
      job(UPLOAD_JOB, 'success', null, '2026-10-11T16:00:00Z'),
    ]),
    null,
  );
});

test('no uploads at all yields no commit', () => {
  assert.equal(latestBackendUploadSha([]), null);
});

// === Schedule ===

const schedule = (input: Partial<ScheduleFacts>) =>
  decideSchedule({
    greenSha: SHA_B,
    buildsNamedBundle: true,
    stateStatus: STATE_NONE,
    runningServesGreen: false,
    serviceWorkerHeadersOk: false,
    uploadedSha: null,
    backendSha: null,
    greenIsStrictAncestorOfUploaded: false,
    greenIsStrictAncestorOfBackend: false,
    ...input,
  });

test('schedule proceeds when Staging holds nothing', () => {
  assert.equal(schedule({}), SCHEDULE_PROCEED);
});

test('schedule proceeds when Staging holds older commits on both halves', () => {
  assert.equal(
    schedule({
      stateStatus: STATE_PRESENT,
      uploadedSha: SHA_A,
      backendSha: SHA_A,
    }),
    SCHEDULE_PROCEED,
  );
});

test('schedule stops green when the commit predates the web deploy, before anything else', () => {
  assert.equal(schedule({ buildsNamedBundle: false }), SCHEDULE_SKIP_PREDATES);
  assert.equal(
    schedule({ buildsNamedBundle: false, stateStatus: STATE_UNREADABLE }),
    SCHEDULE_SKIP_PREDATES,
  );
});

test('schedule fails when the state file is unreadable, whatever else is true', () => {
  assert.equal(
    schedule({ stateStatus: STATE_UNREADABLE }),
    SCHEDULE_FAIL_UNREACHABLE,
  );
  assert.equal(
    schedule({
      stateStatus: STATE_UNREADABLE,
      runningServesGreen: true,
      serviceWorkerHeadersOk: true,
    }),
    SCHEDULE_FAIL_UNREACHABLE,
  );
});

test('schedule skips when the running process serves the commit with its headers', () => {
  assert.equal(
    schedule({
      stateStatus: STATE_PRESENT,
      runningServesGreen: true,
      serviceWorkerHeadersOk: true,
      uploadedSha: SHA_B,
      backendSha: SHA_B,
    }),
    SCHEDULE_SKIP_SERVING,
  );
});

test('schedule fails when the running process serves the commit without its headers', () => {
  // The run that deployed it failed on /sw.js alone. Skipping green here
  // would bury that failure under a run that fixed nothing.
  assert.equal(
    schedule({
      stateStatus: STATE_PRESENT,
      runningServesGreen: true,
      serviceWorkerHeadersOk: false,
      uploadedSha: SHA_B,
    }),
    SCHEDULE_FAIL_HEADERS,
  );
});

test('schedule fails when the web bundle of that commit is uploaded but not running', () => {
  assert.equal(
    schedule({ stateStatus: STATE_PRESENT, uploadedSha: SHA_B }),
    SCHEDULE_FAIL_UPLOADED_NOT_RUNNING,
  );
});

test('schedule fails when the backend of that commit is uploaded and the web bundle is not', () => {
  // A dispatch uploaded and Host Applied the backend, then its web job failed
  // before uploading: the state file still names an older commit.
  assert.equal(
    schedule({
      stateStatus: STATE_PRESENT,
      uploadedSha: SHA_A,
      backendSha: SHA_B,
    }),
    SCHEDULE_FAIL_UPLOADED_NOT_RUNNING,
  );
  assert.equal(
    schedule({ backendSha: SHA_B }),
    SCHEDULE_FAIL_UPLOADED_NOT_RUNNING,
  );
});

test('schedule does not roll back a newer dispatched web bundle', () => {
  assert.equal(
    schedule({
      stateStatus: STATE_PRESENT,
      uploadedSha: SHA_C,
      greenIsStrictAncestorOfUploaded: true,
    }),
    SCHEDULE_SKIP_NEWER,
  );
});

test('schedule does not roll back a newer dispatched backend', () => {
  assert.equal(
    schedule({
      stateStatus: STATE_PRESENT,
      uploadedSha: SHA_A,
      backendSha: SHA_C,
      greenIsStrictAncestorOfBackend: true,
    }),
    SCHEDULE_SKIP_NEWER,
  );
});

test('an ancestry answer about a commit that is not there changes nothing', () => {
  assert.equal(
    schedule({
      greenIsStrictAncestorOfUploaded: true,
      greenIsStrictAncestorOfBackend: true,
    }),
    SCHEDULE_PROCEED,
  );
});

test('uploaded-not-running outranks newer: the same commit on one half fails', () => {
  assert.equal(
    schedule({
      stateStatus: STATE_PRESENT,
      uploadedSha: SHA_B,
      backendSha: SHA_C,
      greenIsStrictAncestorOfBackend: true,
    }),
    SCHEDULE_FAIL_UPLOADED_NOT_RUNNING,
  );
});

test('every schedule decision has an outcome; only proceed deploys; the fail- ones fail', () => {
  const decisions = [
    SCHEDULE_PROCEED,
    SCHEDULE_SKIP_SERVING,
    SCHEDULE_SKIP_NEWER,
    SCHEDULE_SKIP_PREDATES,
    SCHEDULE_FAIL_UPLOADED_NOT_RUNNING,
    SCHEDULE_FAIL_UNREACHABLE,
    SCHEDULE_FAIL_HEADERS,
  ] as const;
  assert.deepEqual(
    Object.keys(SCHEDULE_OUTCOMES).sort(),
    [...decisions].sort(),
  );
  assert.deepEqual(
    decisions.filter((d) => SCHEDULE_OUTCOMES[d].proceed),
    [SCHEDULE_PROCEED],
  );
  for (const decision of decisions) {
    assert.equal(
      SCHEDULE_OUTCOMES[decision].failed,
      decision.startsWith('fail-'),
      decision,
    );
    if (decision !== SCHEDULE_PROCEED) {
      assert.match(SCHEDULE_OUTCOMES[decision].summary, /othing was uploaded/);
    }
  }
  assert.match(
    SCHEDULE_OUTCOMES[SCHEDULE_FAIL_UPLOADED_NOT_RUNNING].summary,
    /Run NPM Install.*Restart.*dispatch `Deploy Staging` in full/s,
  );
  assert.match(
    SCHEDULE_OUTCOMES[SCHEDULE_FAIL_HEADERS].summary,
    /apps\/web\/deploy\/sw-headers\.htaccess/,
  );
});

/**
 * Everything `planSchedule` reads besides the host, as stubs that record what
 * they were asked. `newer` lists the commits git says descend from the green one.
 */
interface WorldOptions {
  builds?: boolean;
  backendJobs?: JobRecord[];
  newer?: string[];
}

function world({
  builds = true,
  backendJobs = [],
  newer = [],
}: WorldOptions = {}) {
  const asked: {
    builds: string[];
    ancestry: [string, string][];
    backendReads: number;
  } = { builds: [], ancestry: [], backendReads: 0 };
  return {
    asked,
    buildsNamedBundle: (sha: string) => {
      asked.builds.push(sha);
      return builds;
    },
    readBackendJobs: () => {
      asked.backendReads += 1;
      return backendJobs;
    },
    isStrictAncestor: (ancestor: string, descendant: string) => {
      asked.ancestry.push([ancestor, descendant]);
      return newer.includes(descendant);
    },
  };
}

const runSchedule = (
  hostOptions: HostOptions,
  worldOptions: WorldOptions = {},
  webOrigin = WEB,
) => {
  const site = host(hostOptions);
  const w = world(worldOptions);
  const { asked, ...inputs } = w;
  return planSchedule({
    fetcher: site.fetcher,
    webOrigin,
    greenSha: SHA_B,
    ...inputs,
    ...noSleep(),
  }).then((decision) => ({ decision, asked, calls: site.calls }));
};

const dispatchedUpload = (sha: string, completedAt = '2026-10-12T10:00:00Z') =>
  job(UPLOAD_JOB, 'success', sha, completedAt);

test('planSchedule: a commit that predates the deploy stops before any read', async () => {
  const { decision, asked, calls } = await runSchedule({}, { builds: false });
  assert.equal(decision, SCHEDULE_SKIP_PREDATES);
  assert.deepEqual(asked.builds, [SHA_B]);
  assert.deepEqual(calls, []);
  assert.equal(asked.backendReads, 0);
});

test('planSchedule: an unreadable state file fails, and nothing further is read', async () => {
  for (const state of ['throw', 503, '<html>oops</html>']) {
    const { decision, asked } = await runSchedule({
      login: html(SHA_A),
      state,
    });
    assert.equal(decision, SCHEDULE_FAIL_UNREACHABLE);
    assert.equal(asked.backendReads, 0);
  }
});

test('planSchedule: an unset or malformed address is unreachable, with no request', async () => {
  for (const webOrigin of ['', 'not a url']) {
    const { decision, calls } = await runSchedule({}, {}, webOrigin);
    assert.equal(decision, SCHEDULE_FAIL_UNREACHABLE);
    assert.deepEqual(calls, []);
  }
});

test('planSchedule: running the green commit with good headers skips, asking neither git nor the API', async () => {
  const { decision, asked, calls } = await runSchedule({
    login: html(SHA_B),
    state: stateFor(SHA_B),
  });
  assert.equal(decision, SCHEDULE_SKIP_SERVING);
  assert.deepEqual(asked.ancestry, []);
  assert.equal(asked.backendReads, 0);
  assert.ok(calls.includes('/sw.js'));
});

test('planSchedule: running the green commit with wrong or missing headers fails', async () => {
  for (const sw of [
    {},
    null,
    'throw',
    { ...GOOD_SW_HEADERS, 'cache-control': 'public' },
  ]) {
    const { decision } = await runSchedule({
      login: html(SHA_B),
      state: stateFor(SHA_B),
      sw,
    });
    assert.equal(decision, SCHEDULE_FAIL_HEADERS);
  }
});

test('planSchedule: the green web bundle uploaded under an older running build fails', async () => {
  const { decision } = await runSchedule({
    login: html(SHA_A),
    state: stateFor(SHA_B),
  });
  assert.equal(decision, SCHEDULE_FAIL_UPLOADED_NOT_RUNNING);
});

test('planSchedule: the green backend uploaded by a dispatch whose web job never uploaded fails', async () => {
  const { decision, asked } = await runSchedule(
    { login: html(SHA_A), state: stateFor(SHA_A) },
    { backendJobs: [dispatchedUpload(SHA_B)] },
  );
  assert.equal(decision, SCHEDULE_FAIL_UPLOADED_NOT_RUNNING);
  assert.equal(asked.backendReads, 1);
});

test('planSchedule: a newer web bundle is asked of git as (green, uploaded) and skips', async () => {
  const { decision, asked } = await runSchedule(
    { login: html(SHA_C), state: stateFor(SHA_C) },
    { newer: [SHA_C] },
  );
  assert.equal(decision, SCHEDULE_SKIP_NEWER);
  assert.deepEqual(asked.ancestry, [[SHA_B, SHA_C]]);
});

test('planSchedule: a newer backend alone is asked of git as (green, backend) and skips', async () => {
  const { decision, asked } = await runSchedule(
    { login: html(SHA_A), state: stateFor(SHA_A) },
    { backendJobs: [dispatchedUpload(SHA_C)], newer: [SHA_C] },
  );
  assert.equal(decision, SCHEDULE_SKIP_NEWER);
  assert.deepEqual(asked.ancestry, [
    [SHA_B, SHA_A],
    [SHA_B, SHA_C],
  ]);
});

test('planSchedule: older or unknown commits on both halves proceed', async () => {
  const { decision } = await runSchedule(
    { login: html(SHA_A), state: stateFor(SHA_A) },
    { backendJobs: [dispatchedUpload(SHA_A)] },
  );
  assert.equal(decision, SCHEDULE_PROCEED);
});

test('planSchedule: a first deploy, with a silent /login and no state, proceeds', async () => {
  const { decision } = await runSchedule({ login: 'throw' });
  assert.equal(decision, SCHEDULE_PROCEED);
});

test('planSchedule refuses a commit that is not a full SHA', async () => {
  const { fetcher, calls } = host();
  await assert.rejects(
    planSchedule({
      fetcher,
      webOrigin: WEB,
      greenSha: 'main',
      ...world(),
    }),
    StagingWebDeployRefusal,
  );
  assert.deepEqual(calls, []);
});
