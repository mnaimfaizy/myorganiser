#!/usr/bin/env node
// Asserts that the synced OpenAPI spec and the generated API client are present
// and carry the current package version.
//
//   node tools/scripts/check-openapi-artifacts.ts [clientSrc] [specFile]
//
// Neither `app-api-client` nor `api-specs` has an ESLint config, on purpose —
// generated output is exempt. That left both `lint` targets as `nx:noop`, so
// every gate that ran them passed unconditionally, including one that deleted
// the entire generated client (issue #408). This is the cheap standing check
// that those artifacts still exist and are not stale: it reads the generator's
// own FILES manifest and needs no Java, so it can run anywhere.
//
// `openapi:check` remains the authority on whether the contents match the
// backend contract; this only catches missing, empty, or stale-version output.
//
// Exit 0 = in sync. Exit 1 = drift. Exit 2 = the check could not run.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Roots are overridable so the check itself can be exercised against fixtures.
const CLIENT_SRC = process.argv[2] ?? join('libs', 'app-api-client', 'src');
const SPEC_FILE =
  process.argv[3] ?? join('libs', 'api-specs', 'src', 'api-specs.openapi.yaml');

const MANIFEST = join(CLIENT_SRC, '.openapi-generator/FILES');
// Files the generator stamps with the spec version banner.
const VERSIONED = [
  'api.ts',
  'base.ts',
  'common.ts',
  'configuration.ts',
  'index.ts',
];

const fail: (msg: string) => never = (msg) => {
  console.error(`openapi-artifacts: ${msg}`);
  process.exit(2);
};

if (!existsSync(MANIFEST)) fail(`${MANIFEST} not found`);
if (!existsSync(SPEC_FILE)) fail(`${SPEC_FILE} not found`);

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
if (!version) fail('package.json has no version');

const findings = [];

// --- Spec ---------------------------------------------------------------
// Match `version:` at the two-space indent used under the top-level `info:`
// block, so a version nested in any other mapping cannot satisfy this.
const specVersion = readFileSync(SPEC_FILE, 'utf8')
  .match(/^ {2}version: (.+)$/m)?.[1]
  ?.trim();

if (!specVersion) {
  findings.push(`${SPEC_FILE} has no info.version`);
} else if (specVersion !== version) {
  findings.push(
    `${SPEC_FILE} is at ${specVersion}, expected ${version} — run \`yarn openapi:sync\``,
  );
}

// --- Generated client ---------------------------------------------------
const expected = readFileSync(MANIFEST, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

for (const name of expected) {
  const path = join(CLIENT_SRC, name);
  if (!existsSync(path)) {
    findings.push(`${path} is missing — run \`yarn openapi:sync\``);
    continue;
  }
  if (readFileSync(path, 'utf8').trim().length === 0) {
    findings.push(`${path} is empty — run \`yarn openapi:sync\``);
  }
}

const banner = `The version of the OpenAPI document: ${version}`;
for (const name of VERSIONED) {
  const path = join(CLIENT_SRC, name);
  if (!existsSync(path)) continue; // already reported above
  if (!readFileSync(path, 'utf8').includes(banner)) {
    findings.push(
      `${path} is not stamped with version ${version} — run \`yarn openapi:sync\``,
    );
  }
}

if (findings.length > 0) {
  console.error('openapi-artifacts: OpenAPI artifacts are out of sync.');
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}

console.log(
  `openapi-artifacts: spec and ${expected.length} generated file(s) present at version ${version}.`,
);
