#!/usr/bin/env node
// Asserts where internal notes live (ADR 0041).
//
//   node tools/scripts/check-docs-notes.ts
//
// Two rules, both pure path/filename facts:
//   1. No catch-all notes directory under docs/. `docs/internal/` collected
//      planning drafts nobody owned until every one of them described shipped
//      work, and several were cited from agent skills as live TODO lists.
//   2. Every brief directly in docs/research/ is date-prefixed. A Research
//      Brief is frozen at the date in its filename, so that date is the
//      staleness disclaimer a reader needs. An undated pile is how the last
//      catch-all started.
//
// This enforces shape, not placement. A stale planning draft committed as
// docs/features/some-plan.md passes clean, and nothing mechanical catches it.
//
// Exit 0 = in sync. Exit 1 = drift. Exit 2 = the check could not run.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'docs';
const RESEARCH = 'docs/research';

// Names that promise a bucket rather than a subject. Anything landing here is
// a note that belongs in an issue, an ADR, docs/features/, or tmp/.
const RESERVED_DIR_NAMES = new Set([
  'internal',
  'misc',
  'notes',
  'scratch',
  'temp',
  'tmp',
  'wip',
  'planning',
  'drafts',
]);

const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/;

const fail: (msg: string) => never = (msg) => {
  console.error(`docs-notes: ${msg}`);
  process.exit(2);
};

if (!existsSync(ROOT)) fail(`${ROOT} not found`);

const reserved: string[] = [];
const undated: string[] = [];
let asserted = 0;

// Rule 1: walk the whole docs/ tree for reserved directory names.
const walkDirs = (dir: string): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name).replaceAll('\\', '/');
    asserted += 1;
    if (RESERVED_DIR_NAMES.has(entry.name.toLowerCase())) reserved.push(path);
    walkDirs(path);
  }
};

walkDirs(ROOT);

// Rule 2: top level of docs/research/ only — no recursion, so a brief that
// needs an assets folder is not forced into a naming scheme meant for briefs.
if (existsSync(RESEARCH)) {
  for (const entry of readdirSync(RESEARCH, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    asserted += 1;
    if (!DATE_PREFIX.test(entry.name))
      undated.push(`${RESEARCH}/${entry.name}`);
  }
}

if (reserved.length) {
  console.error(
    'docs-notes: catch-all notes directory under docs/ (ADR 0041)\n',
  );
  for (const path of reserved) console.error(`  ${path}`);
  console.error(
    '\nPlanning and history go in GitHub issues. Durable decisions go in docs/adr/.',
  );
  console.error(
    'Feature behavior goes in docs/features/. Cited investigation goes in docs/research/.',
  );
  console.error(
    'Short-lived working files go in tmp/ and are never committed.',
  );
}

if (undated.length) {
  if (reserved.length) console.error('');
  console.error(
    'docs-notes: Research Brief without a date prefix (ADR 0041)\n',
  );
  for (const path of undated) console.error(`  ${path}`);
  console.error(
    '\nName it YYYY-MM-DD-slug.md. A brief is frozen at that date; if it must',
  );
  console.error(
    'stay current it is not research — it is an ADR or a feature doc.',
  );
}

if (reserved.length || undated.length) process.exit(1);

console.log(`docs-notes: ${asserted} paths asserted`);
