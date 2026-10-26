#!/usr/bin/env node
// Asserts that every Nx project carries exactly one `type:*`, `scope:*`, and
// `tier:*` tag from tools/config/nx-project-tags.json.
//
//   node tools/scripts/check-nx-project-tags.mjs
//
// An untagged project matches no @nx/enforce-module-boundaries constraint and
// may import anything, and a project without `tier:*` reaches the Review Tier
// classifier as an unknown (ADR 0070). Both are silent. This check is what
// makes "tag the new library" someone's job.
//
// Deliberately pure: reads project.json files from disk, no Nx daemon.
//
// Exit 0 = every project tagged. Exit 1 = findings. Exit 2 = could not run.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import {
  NX_PROJECT_TAGS_CONFIG_PATH,
  assertProjectTags,
  loadTagVocabulary,
} from './lib/nx-project-tags.ts';

const fail = (msg) => {
  console.error(`nx-project-tags: ${msg}`);
  process.exit(2);
};

let vocabulary;
try {
  vocabulary = loadTagVocabulary();
} catch (err) {
  fail(`cannot load ${NX_PROJECT_TAGS_CONFIG_PATH}: ${err.message}`);
}

let files;
try {
  files = execFileSync('git', ['ls-files', '--', '*project.json'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter((f) => f.endsWith('project.json'));
} catch (err) {
  fail(`git ls-files failed: ${err.message}`);
}
if (files.length === 0) fail('no project.json files found');

const projects = files.map((path) => {
  let json;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    fail(`${path}: ${err.message}`);
  }
  return { name: json.name ?? path, path, tags: json.tags };
});

const findings = assertProjectTags(projects, vocabulary);
if (findings.length) {
  console.error(
    `nx-project-tags: ${findings.length} finding(s) across ${projects.length} projects`,
  );
  for (const f of findings) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `nx-project-tags: OK — ${projects.length} projects carry one tag per dimension (${Object.keys(vocabulary).join(', ')})`,
);
