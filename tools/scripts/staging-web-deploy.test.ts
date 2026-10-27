/**
 * Tests for the glue around Staging's web deploy decisions (issue #1138,
 * ADR 0128): the two questions asked of a real git repository, and the
 * command-line program run as the workflow runs it.
 *
 * The decisions themselves are tested with stubs in
 * lib/staging-web-deploy.test.ts. A stub cannot notice swapped arguments, a
 * missing output line or a wrong exit code, so nothing here is stubbed inside
 * the program: git is a throwaway repository, the host is a `node:http` server
 * on 127.0.0.1, and `gh` is a script on PATH that answers from a fixture.
 *
 * Run with: node --test tools/scripts/staging-web-deploy.test.ts
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  fileAtCommitMentions,
  isStrictAncestor,
} from './lib/staging-web-deploy-git.ts';
import {
  BUILD_ID_CONFIG,
  BUILD_ID_VARIABLE,
  SERVICE_WORKER_CACHE_CONTROL,
  SERVICE_WORKER_CSP,
  hashDependencies,
} from './lib/staging-web-deploy.ts';
import { isolateGitEnvironment } from './lib/git-environment.ts';

// Husky runs this suite with the hook's GIT_DIR; see git-environment.ts.
isolateGitEnvironment();

const CLI = join(
  dirname(fileURLToPath(import.meta.url)),
  'staging-web-deploy.ts',
);
const UNKNOWN = 'f'.repeat(40);
const GOOD_SW_HEADERS = {
  'cache-control': SERVICE_WORKER_CACHE_CONTROL,
  'content-security-policy': SERVICE_WORKER_CSP,
};

const scratch = mkdtempSync(join(tmpdir(), 'staging-web-cli-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

// === A throwaway repository: OLD (predates the deploy) <- MID <- NEW ===

const repo = join(scratch, 'repo');
const git = (...args: string[]): string => {
  const result = spawnSync(
    'git',
    [
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@example.test',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd: repo, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const commit = (content: string, message: string): string => {
  mkdirSync(dirname(join(repo, BUILD_ID_CONFIG)), { recursive: true });
  writeFileSync(join(repo, BUILD_ID_CONFIG), content);
  git('add', '-A');
  git('commit', '-q', '-m', message);
  return git('rev-parse', 'HEAD');
};

mkdirSync(repo);
git('init', '-q');
const OLD = commit("module.exports = { output: 'standalone' };\n", 'old');
const MID = commit(
  `module.exports = { generateBuildId: () => process.env.${BUILD_ID_VARIABLE} || null };\n`,
  'mid',
);
const NEW = commit(
  `module.exports = { generateBuildId: () => process.env.${BUILD_ID_VARIABLE} || null, poweredByHeader: false };\n`,
  'new',
);

test('isStrictAncestor: an ancestor is one, in that argument order only', () => {
  assert.equal(isStrictAncestor(MID, NEW, { cwd: repo }), true);
  assert.equal(isStrictAncestor(OLD, NEW, { cwd: repo }), true);
  assert.equal(isStrictAncestor(NEW, MID, { cwd: repo }), false);
});

test('isStrictAncestor: a commit is not its own strict ancestor', () => {
  // `git merge-base --is-ancestor X X` succeeds. "Staging holds a newer
  // commit" must not be true of the very commit being deployed.
  assert.equal(isStrictAncestor(MID, MID, { cwd: repo }), false);
});

test('isStrictAncestor: a commit git does not know is evidence of nothing', () => {
  assert.equal(isStrictAncestor(MID, UNKNOWN, { cwd: repo }), false);
  assert.equal(isStrictAncestor(UNKNOWN, MID, { cwd: repo }), false);
});

test('fileAtCommitMentions reads the file as it was at that commit', () => {
  const mentions = (sha: string): boolean =>
    fileAtCommitMentions(sha, BUILD_ID_CONFIG, BUILD_ID_VARIABLE, {
      cwd: repo,
    });
  assert.equal(mentions(OLD), false);
  assert.equal(mentions(MID), true);
  assert.equal(mentions(NEW), true);
  assert.equal(mentions(UNKNOWN), false);
});

// === A host on 127.0.0.1, and a `gh` on PATH ===

/** What the host answers; each test sets the parts it needs. */
interface Site {
  login: string | null;
  state: unknown;
  sw: Record<string, string> | null;
  requests: string[];
}

let site: Site;
const html = (sha: string): string =>
  `<html><script>self.b="${sha}"</script></html>`;
const resetSite = (): void => {
  site = { login: null, state: null, sw: GOOD_SW_HEADERS, requests: [] };
};

const server = createServer((request, response) => {
  site.requests.push(request.url ?? '');
  if (request.url === '/login' && site.login) {
    response.writeHead(200, { 'content-type': 'text/html' }).end(site.login);
  } else if (request.url === '/deploy-state.json' && site.state) {
    response.writeHead(200).end(JSON.stringify(site.state));
  } else if (request.url === '/sw.js' && site.sw) {
    response.writeHead(200, site.sw).end('// sw');
  } else {
    response.writeHead(404).end('Not Found');
  }
});
let origin: string;
before(
  () =>
    new Promise<void>((done) => {
      server.listen(0, '127.0.0.1', () => {
        origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        done();
      });
    }),
);
after(() => server.close());

const bin = join(scratch, 'bin');
const ghFixture = join(scratch, 'gh-fixture.json');
mkdirSync(bin);
writeFileSync(
  join(bin, 'gh'),
  [
    '#!/usr/bin/env node',
    "const { readFileSync } = require('node:fs');",
    'const [command, endpoint] = process.argv.slice(2);',
    'const fixture = JSON.parse(readFileSync(process.env.GH_FIXTURE));',
    "if (command !== 'api' || !(endpoint in fixture)) {",
    '  console.error(`fake gh: no answer for ${command} ${endpoint}`);',
    '  process.exit(1);',
    '}',
    'process.stdout.write(JSON.stringify(fixture[endpoint]));',
    '',
  ].join('\n'),
);
chmodSync(join(bin, 'gh'), 0o755);

const RUNS =
  'repos/acme/app/actions/workflows/deploy-staging.yml/runs?per_page=20';
const jobsOf = (id: number): string =>
  `repos/acme/app/actions/runs/${id}/jobs?per_page=100`;

interface GhFixtureRun {
  id: number;
  display_title: string;
}

/** Recent runs as the Actions API returns them: `[title, jobName, conclusion]`. */
function stagingRuns(...runs: [string, string, string][]): void {
  const runsEntry: { workflow_runs: GhFixtureRun[] } = { workflow_runs: [] };
  const fixture: Record<string, unknown> = { [RUNS]: runsEntry };
  runs.forEach(([title, name, conclusion], index) => {
    const id = index + 1;
    runsEntry.workflow_runs.push({ id, display_title: title });
    fixture[jobsOf(id)] = {
      jobs: [
        {
          name,
          conclusion,
          started_at: `2026-10-1${id}T10:00:00Z`,
          completed_at: `2026-10-1${id}T10:05:00Z`,
        },
      ],
    };
  });
  writeFileSync(ghFixture, JSON.stringify(fixture));
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  output: string;
  summary: string;
}

/** Runs the program without blocking this process, which is also the host. */
function runCli(
  args: string[],
  { cwd = repo }: { cwd?: string } = {},
): Promise<RunResult> {
  const outputFile = join(scratch, 'github-output');
  const summaryFile = join(scratch, 'github-summary');
  writeFileSync(outputFile, '');
  writeFileSync(summaryFile, '');
  return new Promise((done, failed) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        GH_FIXTURE: ghFixture,
        GITHUB_REPOSITORY: 'acme/app',
        GITHUB_OUTPUT: outputFile,
        GITHUB_STEP_SUMMARY: summaryFile,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on('error', failed);
    child.on('close', (status) =>
      done({
        status,
        stdout,
        stderr,
        output: readFileSync(outputFile, 'utf8'),
        summary: readFileSync(summaryFile, 'utf8'),
      }),
    );
  });
}

const schedule = (
  sha: string,
  webOrigin: string = origin,
): Promise<RunResult> =>
  runCli(['schedule', '--sha', sha, '--web-origin', webOrigin]);

const stateFor = (sha: string) => ({
  sha,
  depsHash: hashDependencies({ dependencies: {} }),
  installedDepsHash: null,
});

// === schedule ===

test('schedule: nothing on Staging proceeds, writes both outputs and no summary', async () => {
  resetSite();
  stagingRuns();

  const result = await schedule(MID);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'proceed');
  assert.equal(result.output, 'proceed=true\ndecision=proceed\n');
  assert.equal(result.summary, '');
});

test('schedule: a commit that predates the deploy stops green before any request', async () => {
  resetSite();
  stagingRuns();

  const result = await schedule(OLD);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'proceed=false\ndecision=skip-predates\n');
  assert.match(result.summary, /predates the Staging web deploy/);
  assert.deepEqual(site.requests, []);
});

test('schedule: the running build already serves the commit — skips green', async () => {
  resetSite();
  site.login = html(MID);
  site.state = stateFor(MID);
  stagingRuns();

  const result = await schedule(MID);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'proceed=false\ndecision=skip-serving\n');
  assert.match(result.summary, /already serves that commit/);
});

test('schedule: serving the commit without the /sw.js headers exits 1', async () => {
  resetSite();
  site.login = html(MID);
  site.state = stateFor(MID);
  site.sw = { 'cache-control': 'public, max-age=60' };
  stagingRuns();

  const result = await schedule(MID);

  assert.equal(result.status, 1);
  assert.equal(result.output, 'proceed=false\ndecision=fail-headers\n');
  assert.match(result.summary, /sw-headers\.htaccess/);
  assert.doesNotMatch(result.stdout + result.stderr, /max-age/);
});

test('schedule: a dispatched backend upload of the commit, read through gh, exits 1', async () => {
  resetSite();
  site.login = html(OLD);
  site.state = stateFor(OLD);
  // Newest first, as the API lists them. The scheduled run names no commit.
  stagingRuns(
    [`Deploy Staging ${MID}`, 'deploy-backend', 'success'],
    ['Deploy Staging (scheduled)', 'deploy-backend', 'failure'],
  );

  const result = await schedule(MID);

  assert.equal(result.status, 1);
  assert.equal(
    result.output,
    'proceed=false\ndecision=fail-uploaded-not-running\n',
  );
  assert.match(result.summary, /dispatch `Deploy Staging` in full/);
});

test('schedule: a newer dispatched backend, known to git, is not rolled back', async () => {
  resetSite();
  site.login = html(OLD);
  site.state = stateFor(OLD);
  stagingRuns([`Deploy Staging ${NEW}`, 'deploy-backend', 'success']);

  const result = await schedule(MID);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'proceed=false\ndecision=skip-newer\n');
});

test('schedule: an older dispatched backend, and one git does not know, proceed', async () => {
  for (const sha of [OLD, UNKNOWN]) {
    resetSite();
    site.login = html(OLD);
    site.state = stateFor(OLD);
    stagingRuns([`Deploy Staging ${sha}`, 'deploy-backend', 'success']);

    const result = await schedule(NEW);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output, 'proceed=true\ndecision=proceed\n');
  }
});

test('schedule: runs that cannot be read from the API exit 1 rather than proceed', async () => {
  resetSite();
  site.login = html(OLD);
  site.state = stateFor(OLD);
  writeFileSync(ghFixture, '{}');

  const result = await schedule(MID);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /could not read recent `Deploy Staging` runs/);
  assert.doesNotMatch(result.output, /proceed=true/);
});

test('schedule: a host that refuses connections exits 1 and names no address', async () => {
  resetSite();
  stagingRuns();
  // A port nothing listens on: refused at once, three tries with backoff.
  const closed = createServer();
  const port = await new Promise<number>((done) =>
    closed.listen(0, '127.0.0.1', () =>
      done((closed.address() as AddressInfo).port),
    ),
  );
  await new Promise<void>((done) => closed.close(() => done()));

  const result = await schedule(MID, `http://127.0.0.1:${port}`);

  assert.equal(result.status, 1);
  assert.equal(result.output, 'proceed=false\ndecision=fail-unreachable\n');
  assert.match(result.summary, /did not answer; nothing was uploaded/);
  assert.doesNotMatch(
    result.stdout + result.stderr + result.summary,
    new RegExp(`127\\.0\\.0\\.1|${port}`),
  );
});

// === plan ===

function bundle({
  buildId,
  htaccess = false,
}: { buildId?: string; htaccess?: boolean } = {}): string {
  const dir = mkdtempSync(join(scratch, 'bundle-'));
  mkdirSync(join(dir, '.next'));
  writeFileSync(join(dir, 'package.json'), '{"dependencies":{}}');
  writeFileSync(join(dir, '.next', 'BUILD_ID'), `${buildId}\n`);
  if (htaccess) {
    mkdirSync(join(dir, 'public'));
    writeFileSync(join(dir, 'public', '.htaccess'), '# ours');
  }
  return dir;
}

const plan = (
  sha: string,
  dir: string,
  webOrigin: string = origin,
): Promise<RunResult> =>
  runCli(['plan', '--web-origin', webOrigin, '--sha', sha, '--bundle', dir]);

const stateFile = (dir: string): string =>
  join(dir, 'public', 'deploy-state.json');

test('plan: a first deploy writes the state file and action=install-owed', async () => {
  resetSite();
  const dir = bundle({ buildId: MID });

  const result = await plan(MID, dir);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'install-owed');
  assert.equal(result.output, 'action=install-owed\n');
  assert.deepEqual(JSON.parse(readFileSync(stateFile(dir), 'utf8')), {
    ...stateFor(MID),
    installedDepsHash: null,
  });
});

test('plan: the uploaded build running with unchanged dependencies writes action=restart', async () => {
  resetSite();
  site.login = html(MID);
  site.state = stateFor(MID);
  const dir = bundle({ buildId: NEW });

  const result = await plan(NEW, dir);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'action=restart\n');
  assert.equal(
    JSON.parse(readFileSync(stateFile(dir), 'utf8')).installedDepsHash,
    stateFor(MID).depsHash,
  );
});

test('plan: a bundle built under another build id is refused, writing nothing', async () => {
  resetSite();
  const dir = bundle({ buildId: 'some-default-build-id' });

  const result = await plan(MID, dir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /build id is not the commit being deployed/);
  assert.equal(result.output, '');
  assert.equal(existsSync(stateFile(dir)), false);
  assert.deepEqual(site.requests, []);
});

test('plan: a bundle that carries public/.htaccess is refused before the host is read', async () => {
  resetSite();
  const dir = bundle({ buildId: MID, htaccess: true });

  const result = await plan(MID, dir);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /refused - the bundle contains public\/\.htaccess/,
  );
  assert.equal(result.output, '');
  assert.equal(existsSync(stateFile(dir)), false);
  assert.deepEqual(site.requests, []);
});

test('plan: a state file that cannot be read is refused, writing nothing', async () => {
  resetSite();
  site.state = 'not a state file';
  const dir = bundle({ buildId: MID });

  const result = await plan(MID, dir);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /refused - the Staging web address did not answer/,
  );
  assert.equal(result.output, '');
  assert.equal(existsSync(stateFile(dir)), false);
  assert.doesNotMatch(result.stdout + result.stderr, /127\.0\.0\.1/);
});

// === probe ===

const probe = (sha: string): Promise<RunResult> =>
  runCli([
    'probe',
    '--web-origin',
    origin,
    '--sha',
    sha,
    '--timeout-seconds',
    '1',
  ]);

test('probe: exits 0 when the running process serves the build with its headers', async () => {
  resetSite();
  site.login = html(MID);

  const result = await probe(MID);

  assert.equal(result.status, 0, result.stderr);
});

test('probe: exits 1 when another build answers', async () => {
  resetSite();
  site.login = html(OLD);

  const result = await probe(MID);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /probe failed - \/login did not answer from build/,
  );
});

test('probe: exits 1 on wrong /sw.js headers without repeating them', async () => {
  resetSite();
  site.login = html(MID);
  site.sw = { ...GOOD_SW_HEADERS, 'content-security-policy': 'default-src *' };

  const result = await probe(MID);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Content-Security-Policy differs from the expected value/,
  );
  assert.doesNotMatch(result.stderr, /default-src/);
});
