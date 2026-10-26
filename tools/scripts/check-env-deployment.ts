#!/usr/bin/env node
// Asserts that every environment variable a deployment document declares is
// present in `.env.example` (ADR 0043).
//
//   node tools/scripts/check-env-deployment.ts [envExamplePath] [deploymentDocsDir]
//
// A deployment document declares a variable by writing a bare `KEY=value`
// line inside a fenced code block — no opt-in marker, no annotation. A doc
// that forgets a marker would pass by being invisible, the same reach
// failure `check-lint-coverage.ts` was written to close; reading what is
// on the page avoids reproducing it. A document with no fenced assignments
// legitimately declares nothing and passes.
//
// One-way on purpose: a deployment document legitimately omits variables
// that belong to a different host (`YOUTUBE_API_BASE_URL` belongs only in
// the cron wrapper's own env file, never in the Passenger env panel this
// checker reads). Only a declared-but-undeclared-in-.env.example variable
// has ever broken a deploy, so only that direction fails.
//
// Exit 0 = every declared variable is present in `.env.example`. Exit 1 =
// drift, naming the variable and the document that declares it. Exit 2 =
// the check could not run.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ENV_EXAMPLE = resolve(process.argv[2] ?? '.env.example');
const DEPLOYMENT_DOCS = resolve(process.argv[3] ?? 'docs/deployment');

const fail: (msg: string) => never = (msg) => {
  console.error(`env-deployment: ${msg}`);
  process.exit(2);
};

if (!existsSync(ENV_EXAMPLE)) fail(`${ENV_EXAMPLE} not found`);
if (!existsSync(DEPLOYMENT_DOCS)) fail(`${DEPLOYMENT_DOCS} not found`);

function listMarkdownFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(path));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) files.push(path);
  }
  return files;
}

const FENCE = /```[^\n]*\n([\s\S]*?)```/g;
const ASSIGNMENT = /^([A-Z_][A-Z0-9_]*)=/;

const declaredBy = new Map(); // variable name -> Set of document paths

for (const doc of listMarkdownFiles(DEPLOYMENT_DOCS)) {
  const content = readFileSync(doc, 'utf8');
  for (const [, block] of content.matchAll(FENCE)) {
    for (const line of block.split('\n')) {
      const match = line.trimStart().match(ASSIGNMENT);
      if (!match) continue;
      const name = match[1];
      if (!declaredBy.has(name)) declaredBy.set(name, new Set());
      declaredBy.get(name).add(doc);
    }
  }
}

const declaredInExample = new Set();
for (const line of readFileSync(ENV_EXAMPLE, 'utf8').split('\n')) {
  const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
  if (match) declaredInExample.add(match[1]);
}

const findings = [];
for (const [name, docs] of [...declaredBy].sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  if (declaredInExample.has(name)) continue;
  findings.push(`${name} is declared by ${[...docs].sort().join(', ')}`);
}

if (findings.length) {
  console.error(
    `env-deployment: ${findings.length} variable(s) a deployment document declares are not present in ${ENV_EXAMPLE}\n`,
  );
  for (const finding of findings) console.error(`  - ${finding}`);
  console.error(`\nAdd each variable to ${ENV_EXAMPLE}, or fix the document.`);
  process.exit(1);
}

console.log(
  `env-deployment: ${declaredBy.size} variable(s) declared across deployment docs, all present in ${ENV_EXAMPLE}`,
);
