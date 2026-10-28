#!/usr/bin/env node
// Asserts every GitHub Actions job pins `runs-on` to ubuntu-24.04
// (docs/deployment/CI_CD_AND_RELEASE_PROCESS.md, issue #1136).
//
// Direction asserted: a job under .github/workflows whose runs-on is
// missing, repeated, or any value other than ubuntu-24.04 fails, named
// by file and job id. Every workflow file is read, so a new job on
// ubuntu-latest fails here.
//
// Direction omitted: whether that image still has the tools a job's
// steps need. The deployment doc states the pin; the image contents
// are a separate check when the pin moves.
//
//   node tools/scripts/check-runner-image.ts [repoRoot]
//
// Exit 0 = every job pins ubuntu-24.04. Exit 1 = a job does not.
// Exit 2 = the check could not run.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PIN = 'ubuntu-24.04';
const WORKFLOWS = join('.github', 'workflows');

const fail: (msg: string) => never = (msg) => {
  console.error(`runner-image: ${msg}`);
  process.exit(2);
};

const root = resolve(process.argv[2] ?? '.');
const dir = join(root, WORKFLOWS);
if (!existsSync(dir)) fail(`${WORKFLOWS} not found`);

const files = readdirSync(dir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();
if (files.length === 0) fail(`${WORKFLOWS} has no workflow files`);

/** Every two-space job id, in file order. */
const jobIds = (source: string, path: string): string[] => {
  const jobsAt = source.search(/^jobs:\s*$/m);
  if (jobsAt === -1) fail(`${path} has no top-level jobs: key`);
  return [
    ...source.slice(jobsAt).matchAll(/^ {2}([a-z0-9][a-z0-9-]*):\s*$/gm),
  ].map((match) => match[1]);
};

/** One job body, from its id through the line before the next job. */
const jobBlock = (source: string, path: string, jobId: string) => {
  const jobsAt = source.search(/^jobs:\s*$/m);
  const body = source.slice(jobsAt);
  const start = body.search(new RegExp(`^ {2}${jobId}:\\s*$`, 'm'));
  if (start === -1) fail(`${path} has no job named ${jobId}`);
  const rest = body.slice(start + 1);
  const next = rest.search(/^ {2}[a-z0-9][a-z0-9-]*:\s*$/m);
  return next === -1 ? rest : rest.slice(0, next);
};

const unquote = (value: string) => value.replace(/^['"]|['"]$/g, '');

const findings: string[] = [];
let jobs = 0;

for (const name of files) {
  const path = join(WORKFLOWS, name);
  const source = readFileSync(join(root, path), 'utf8');
  for (const jobId of jobIds(source, path)) {
    jobs += 1;
    const runsOn = [
      ...jobBlock(source, path, jobId).matchAll(/^ {4}runs-on:\s*(.*)\s*$/gm),
    ].map((match) => unquote(match[1].trim()));
    if (runsOn.length !== 1 || runsOn[0] !== PIN) {
      const found = runsOn.length === 0 ? 'missing' : runsOn.join(', ');
      findings.push(`${path} job ${jobId} runs-on is ${found}`);
    }
  }
}

if (jobs === 0) fail(`${WORKFLOWS} has no jobs`);

if (findings.length > 0) {
  console.error(
    `runner-image: ${findings.length} job(s) do not pin ${PIN}\n` +
      findings.map((finding) => `  ${finding}`).join('\n'),
  );
  process.exit(1);
}

console.log(`runner-image: OK — ${jobs} job(s) pin ${PIN}`);
