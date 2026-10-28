#!/usr/bin/env node
// Runs the decisions of Staging's web deploy for deploy-staging.yml (issue
// #1138, ADR 0128). The logic lives in lib/staging-web-deploy.ts; this file
// only reads arguments, the bundle, the network, git and the Actions API, and
// reports.
//
//   node tools/scripts/staging-web-deploy.ts same-site <webOrigin> <apiOrigin>
//   node tools/scripts/staging-web-deploy.ts schedule --sha <greenSha> [--web-origin <origin>]
//   node tools/scripts/staging-web-deploy.ts plan --web-origin <origin> --sha <sha> --bundle <dir>
//   node tools/scripts/staging-web-deploy.ts probe --web-origin <origin> --sha <sha> [--timeout-seconds 300]
//
// `schedule` decides whether a scheduled run deploys the newest green commit
// (see decideSchedule). It asks git about that commit, so it runs with the
// repository as its working directory and with full history, and it reads
// recent `Deploy Staging` runs with `gh api` (GH_TOKEN, `actions: read`). It
// prints the decision, appends `proceed=<true|false>` and
// `decision=<outcome>` to $GITHUB_OUTPUT and a line to $GITHUB_STEP_SUMMARY
// when set, and exits 1 on any outcome that starts with `fail-`.
//
// `plan` writes <bundle>/public/deploy-state.json, prints `restart` or
// `install-owed`, and appends `action=<value>` to $GITHUB_OUTPUT when set.
// It refuses, writing nothing, a bundle that carries public/.htaccess (that
// file would overwrite the host's own), a bundle built under another build
// id, and a host whose state file cannot be read.
//
// Both origins are GitHub Environment secrets (ADR 0056), so no message
// printed here contains one — only a path such as /login or /sw.js.
//
// Exit 0 = same site / schedule decided without failing / plan written /
// build is live. Exit 1 = different sites, a failing schedule outcome, a
// refused input, or the probe failed. Exit 2 = bad invocation.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { ghJson } from './lib/gh.ts';
import {
  type ApiJob,
  type ApiRun,
  type JobRecord,
  normalizeJobs,
} from './lib/staging-host-apply-guard.ts';
import {
  fileAtCommitMentions,
  isStrictAncestor,
} from './lib/staging-web-deploy-git.ts';
import {
  BUILD_ID_CONFIG,
  BUILD_ID_VARIABLE,
  BUNDLE_HTACCESS,
  type Fetcher,
  SCHEDULE_OUTCOMES,
  StagingWebDeployRefusal,
  assertBundleKeepsHostHtaccess,
  isSameSite,
  planDeploy,
  planSchedule,
  probeDeploy,
} from './lib/staging-web-deploy.ts';

const NAME = 'staging-web-deploy';
const REQUEST_TIMEOUT_MS = 20_000;

const usage = (msg: string): never => {
  console.error(`${NAME}: ${msg}`);
  process.exit(2);
};

/** Global fetch with a per-request timeout, so one hung socket cannot stall the job. */
const fetcher: Fetcher = (url, init = { headers: {} }) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i];
    if (!name?.startsWith('--') || args[i + 1] === undefined) {
      usage(`expected --flag value pairs, got ${JSON.stringify(name)}`);
    }
    flags[name.slice(2)] = args[i + 1];
  }
  return flags;
}

function required(flags: Record<string, string>, name: string): string {
  if (!flags[name]) usage(`missing --${name}`);
  return flags[name];
}

// As many as `release:cut` reads, for the same reason: runs on Staging queue
// one at a time, so its latest upload cannot be outside the window.
const STAGING_RUNS_TO_READ = 20;

/** Workflow run envelope `gh api`'s `runs` listing carries, beyond what the guard reads. */
type WorkflowRun = ApiRun & { id: number };

/** Normalized jobs of recent `Deploy Staging` runs, from every ref. */
function readBackendJobs(): JobRecord[] {
  const repo = process.env.GITHUB_REPOSITORY ?? '{owner}/{repo}';
  const api = (endpoint: string): unknown => {
    try {
      return ghJson(['api', `repos/${repo}/${endpoint}`]);
    } catch {
      // Unknown is not "no upload": the schedule stops rather than guess.
      throw new StagingWebDeployRefusal(
        'could not read recent `Deploy Staging` runs with `gh api`. Nothing was uploaded.',
      );
    }
  };
  const { workflow_runs: runs } = api(
    `actions/workflows/deploy-staging.yml/runs?per_page=${STAGING_RUNS_TO_READ}`,
  ) as { workflow_runs: WorkflowRun[] };
  return runs.flatMap((stagingRun) =>
    normalizeJobs(
      stagingRun,
      (
        api(`actions/runs/${stagingRun.id}/jobs?per_page=100`) as {
          jobs: ApiJob[];
        }
      ).jobs,
    ),
  );
}

const [, , command, ...rest] = process.argv;

async function main(): Promise<number> {
  if (command === 'same-site') {
    const [webOrigin, apiOrigin] = rest;
    if (!webOrigin || !apiOrigin) usage('same-site needs two origins');
    if (isSameSite(webOrigin, apiOrigin)) {
      console.log(`${NAME}: the web app and the API are on the same site`);
      return 0;
    }
    console.error(
      `${NAME}: the web origin and the API origin are on different sites ` +
        '(their last two hostname labels differ). The browser does not send ' +
        'the refresh cookie across sites, so sign-in would not survive ' +
        'closing and reopening the web app. Host both under one domain.',
    );
    return 1;
  }

  if (command === 'schedule') {
    const flags = parseFlags(rest);
    const decision = await planSchedule({
      fetcher,
      // Optional on purpose: an unset address is unreadable, which the
      // decision fails on by name, rather than a bad invocation.
      webOrigin: flags['web-origin'] ?? '',
      greenSha: required(flags, 'sha'),
      buildsNamedBundle: (sha) =>
        fileAtCommitMentions(sha, BUILD_ID_CONFIG, BUILD_ID_VARIABLE),
      readBackendJobs,
      isStrictAncestor,
    });
    const outcome = SCHEDULE_OUTCOMES[decision];

    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `proceed=${outcome.proceed}\ndecision=${decision}\n`,
      );
    }
    if (outcome.summary && process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${outcome.summary}\n`);
    }
    console.log(decision);
    if (outcome.failed) {
      console.error(`${NAME}: ${outcome.summary}`);
      return 1;
    }
    return 0;
  }

  if (command === 'plan') {
    const flags = parseFlags(rest);
    const webOrigin = required(flags, 'web-origin');
    const sha = required(flags, 'sha');
    const bundle = required(flags, 'bundle');

    const packageJsonPath = join(bundle, 'package.json');
    if (!existsSync(packageJsonPath)) usage(`${packageJsonPath} not found`);

    assertBundleKeepsHostHtaccess(
      existsSync(join(bundle, BUNDLE_HTACCESS)) ? [BUNDLE_HTACCESS] : [],
    );

    // The probe waits for this commit in the running HTML. A bundle built
    // under another id would upload, restart, and then never satisfy it.
    const buildIdPath = join(bundle, '.next', 'BUILD_ID');
    const buildId = existsSync(buildIdPath)
      ? readFileSync(buildIdPath, 'utf8').trim()
      : null;
    if (buildId !== sha) {
      console.error(
        `${NAME}: the bundle's build id is not the commit being deployed. ` +
          'Package it with WEB_BUILD_ID set to that commit.',
      );
      return 1;
    }

    const { action, state } = await planDeploy({
      fetcher,
      webOrigin,
      sha,
      packageJson: JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
        dependencies?: Record<string, unknown>;
      },
    });

    mkdirSync(join(bundle, 'public'), { recursive: true });
    writeFileSync(
      join(bundle, 'public', 'deploy-state.json'),
      `${JSON.stringify(state, null, 2)}\n`,
    );
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `action=${action}\n`);
    }
    console.log(action);
    return 0;
  }

  if (command === 'probe') {
    const flags = parseFlags(rest);
    const timeoutSeconds = Number(flags['timeout-seconds'] ?? 300);
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
      usage('--timeout-seconds must be a positive number');
    }
    const result = await probeDeploy({
      fetcher,
      webOrigin: required(flags, 'web-origin'),
      sha: required(flags, 'sha'),
      timeoutSeconds,
    });
    if (!result.ok) {
      console.error(`${NAME}: probe failed - ${result.reason}`);
      return 1;
    }
    console.log(
      `${NAME}: the uploaded build is answering (${result.attempts} attempt(s)) and /sw.js carries its headers`,
    );
    return 0;
  }

  return usage(
    `unknown command ${JSON.stringify(command)} (expected same-site, schedule, plan or probe)`,
  );
}

try {
  process.exit(await main());
} catch (err) {
  if (err instanceof StagingWebDeployRefusal) {
    console.error(`${NAME}: refused - ${err.message}`);
    process.exit(1);
  }
  throw err;
}
