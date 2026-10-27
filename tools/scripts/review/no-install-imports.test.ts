// Asserts that a script a workflow job runs before installing dependencies
// imports no package (issue #1031).
//
// Some jobs run a script straight after checkout: the golden replay lists
// its cases and regenerates its ledger that way. Such a script may import
// `node:` built-ins and files beside it and nothing else, however far the
// chain goes. Replay run 37722854031 failed to list its cases because
// `golden-results.ts` had gained an import of `run-ladder.ts`, which
// reaches `zod` through `obligations.ts`. Every test passed, because every
// test runs with `node_modules` present.
//
// Direction: workflows → the import graph, one way. A job is read as
// installing when it runs `yarn install` anywhere; a script it runs before
// that line is not caught here.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import test from 'node:test';

const WORKFLOWS = '.github/workflows';

/** Each job of a workflow: its key and its text. */
export const jobsIn = (workflowText) => {
  const lines = workflowText.split('\n');
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (start === -1) return [];
  const jobs = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\S/.test(lines[i])) break;
    const key = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[i]);
    if (key) jobs.push({ name: key[1], lines: [] });
    else if (jobs.length) jobs.at(-1).lines.push(lines[i]);
  }
  return jobs.map(({ name, lines: body }) => ({
    name,
    body: body.filter((line) => !/^\s*#/.test(line)).join('\n'),
  }));
};

/** The repository scripts a job's text runs with `node`. */
export const scriptsRunBy = (jobBody) => [
  ...new Set(
    [...jobBody.matchAll(/\bnode\s+(tools\/scripts\/[\w./-]+\.mjs)\b/g)].map(
      (m) => m[1],
    ),
  ),
];

const IMPORT =
  /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Every package a script imports, directly or through the files it imports.
 *
 * @returns {{ specifier: string, from: string }[]}
 */
export const packagesReachedFrom = (
  entry,
  read = (p) => readFileSync(p, 'utf8'),
) => {
  const seen = new Set();
  const packages = [];
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const m of read(file).matchAll(IMPORT)) {
      const specifier = m[1] ?? m[2] ?? m[3];
      if (specifier.startsWith('node:')) continue;
      if (specifier.startsWith('.'))
        visit(normalize(join(dirname(file), specifier)));
      else packages.push({ specifier, from: file });
    }
  };
  visit(entry);
  return packages;
};

test('a job is split out with its own text, and its scripts are found', () => {
  const jobs = jobsIn(
    [
      'jobs:',
      '  cases:',
      '    steps:',
      '      - run: node tools/scripts/review/golden-tiers.ts --matrix',
      '  replay:',
      '    steps:',
      '      # node tools/scripts/review/in-a-comment.mjs',
      '      - run: corepack yarn install --immutable',
      '      - run: node "$TOOLING/tools/scripts/review/elsewhere.mjs"',
    ].join('\n'),
  );
  assert.deepEqual(
    jobs.map((j) => j.name),
    ['cases', 'replay'],
  );
  assert.deepEqual(scriptsRunBy(jobs[0].body), [
    'tools/scripts/review/golden-tiers.ts',
  ]);
  // A comment is not a run, and a script run from another tree is not ours.
  assert.deepEqual(scriptsRunBy(jobs[1].body), []);
});

test('a package reached through a chain of files is found, with the file that imports it', () => {
  const files = {
    'a/entry.mjs': "import fs from 'node:fs';\nimport { x } from './mid.mjs';",
    'a/mid.mjs': "export { y } from '../b/leaf.mjs';",
    'b/leaf.mjs': "import { z } from 'zod';\nexport const y = z;",
  };
  assert.deepEqual(
    packagesReachedFrom('a/entry.mjs', (p) => files[p]),
    [{ specifier: 'zod', from: 'b/leaf.mjs' }],
  );
});

test('no script run before an install imports a package', () => {
  const checked = [];
  for (const name of readdirSync(WORKFLOWS).filter((n) => n.endsWith('.yml'))) {
    const file = join(WORKFLOWS, name);
    for (const job of jobsIn(readFileSync(file, 'utf8'))) {
      if (/\byarn install\b/.test(job.body)) continue;
      for (const script of scriptsRunBy(job.body)) {
        if (!existsSync(script)) continue;
        checked.push(`${name}:${job.name}:${script}`);
        assert.deepEqual(
          packagesReachedFrom(script),
          [],
          `${file}, job "${job.name}", runs ${script} with no dependencies installed, and it reaches a package`,
        );
      }
    }
  }
  // The replay's first job is the one this was written for. A scan that
  // stops finding it passes everything.
  assert.ok(
    checked.some((c) =>
      c.startsWith(
        'review-golden-replay.yml:cases:tools/scripts/review/golden-tiers.ts',
      ),
    ),
    `the golden replay's cases job was not checked; checked: ${checked.join(', ')}`,
  );
});
