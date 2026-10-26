#!/usr/bin/env node
// Asserts that every environment variable the backend reads is declared in
// `.env.example` (ADR 0043).
//
//   node tools/scripts/check-env-declared.ts [envExamplePath] [backendSrcRoot]
//
// Release v0.4.0 shipped a backend that read `YOUTUBE_CRON_SECRET` with no
// declaration anywhere a deployer would see it, so cron auth and mail both
// failed the moment the deployment plan was followed exactly (issue #438).
// This is the fact that incident turns into: a `process.env.NAME` read with
// no matching `NAME=` line in `.env.example` is a variable nobody set up the
// deploy for, because there was nothing to copy.
//
// One-way on purpose: `.env.example` legitimately carries frontend and
// docker-compose keys the backend never reads (NEXT_PUBLIC_*, DATABASE_USER,
// PGADMIN_*, ...). Only a read with no declaration is a defect; a
// declaration with no read is somebody else's variable.
//
// Most reads are `process.env.NAME` or `process.env['NAME']` directly, but
// `middleware/globalRateLimit.ts` takes `env: Env = process.env` as an
// injectable default and reads `env.NAME` inside the function, so a bare
// `process.env` bound to a local name (by a default parameter, a plain
// assignment, or a destructure) is tracked per file and its alias's `.NAME`
// accesses count as reads too.
//
// `JEST_WORKER_ID` is excluded from the read set: it is Jest's own worker
// identifier, read by `utils/passport.ts` only to relax a secret check
// during tests, and it is not something a deploy ever sets.
//
// Exit 0 = every read is declared. Exit 1 = drift, naming the variable and
// the file(s) that read it. Exit 2 = the check could not run.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ENV_EXAMPLE = resolve(process.argv[2] ?? '.env.example');
const BACKEND_SRC = resolve(process.argv[3] ?? 'apps/backend/src');

const fail: (msg: string) => never = (msg) => {
  console.error(`env-declared: ${msg}`);
  process.exit(2);
};

// Never meant to appear in `.env.example` — set by the test runner, not a deploy.
const TEST_RUNNER_VARS = new Set(['JEST_WORKER_ID']);

if (!existsSync(ENV_EXAMPLE)) fail(`${ENV_EXAMPLE} not found`);
if (!existsSync(BACKEND_SRC)) fail(`${BACKEND_SRC} not found`);

function listSourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(path));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts')) {
      continue;
    }
    files.push(path);
  }
  return files;
}

const DIRECT_READ_PATTERNS = [
  /process\.env\.([A-Z_][A-Z0-9_]*)/g,
  /process\.env\[\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\]/g,
];

// A bare `process.env` (the whole object, not a `.NAME`/`['NAME']` read of
// it) bound to a local identifier — `env: Env = process.env`, `const env =
// process.env`. The identifier's later `.NAME` accesses are reads too.
const ALIAS_BINDING =
  /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=,)]+)?=\s*process\.env\b(?!\.|\[)/g;

// `const { FOO, BAR: renamed } = process.env` — the destructured keys are
// reads directly, with no alias to chase further.
const DESTRUCTURE_BINDING = /\{\s*([^{}]+?)\s*\}\s*=\s*process\.env\b/g;

// variable name -> Set of file paths
const readBy = new Map<string, Set<string>>();
const recordRead = (name: string, file: string): void => {
  const files = readBy.get(name) ?? new Set<string>();
  files.add(file);
  readBy.set(name, files);
};

for (const file of listSourceFiles(BACKEND_SRC)) {
  const content = readFileSync(file, 'utf8');

  for (const pattern of DIRECT_READ_PATTERNS) {
    for (const [, name] of content.matchAll(pattern)) recordRead(name, file);
  }

  for (const [, binding] of content.matchAll(DESTRUCTURE_BINDING)) {
    for (const entry of binding.split(',')) {
      const key = entry.split(':')[0].split('=')[0].trim();
      if (/^[A-Z_][A-Z0-9_]*$/.test(key)) recordRead(key, file);
    }
  }

  const aliases = new Set<string>();
  for (const [, alias] of content.matchAll(ALIAS_BINDING)) aliases.add(alias);
  for (const alias of aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const accessPattern = new RegExp(`\\b${escaped}\\.([A-Z_][A-Z0-9_]*)`, 'g');
    for (const [, name] of content.matchAll(accessPattern))
      recordRead(name, file);
  }
}

const declared = new Set<string>();
for (const line of readFileSync(ENV_EXAMPLE, 'utf8').split('\n')) {
  const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
  if (match) declared.add(match[1]);
}

const findings = [];
let checked = 0;
for (const [name, files] of [...readBy].sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  if (TEST_RUNNER_VARS.has(name)) continue;
  checked += 1;
  if (declared.has(name)) continue;
  findings.push(`${name} is read by ${[...files].sort().join(', ')}`);
}

if (findings.length) {
  console.error(
    `env-declared: ${findings.length} variable(s) the backend reads are not declared in ${ENV_EXAMPLE}\n`,
  );
  for (const finding of findings) console.error(`  - ${finding}`);
  console.error(`\nAdd each variable to ${ENV_EXAMPLE}, or the read is a bug.`);
  process.exit(1);
}

console.log(
  `env-declared: ${checked} variable(s) read by the backend, all declared in ${ENV_EXAMPLE}`,
);
