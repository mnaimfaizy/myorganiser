#!/usr/bin/env node
// Asserts that every ADR filename in docs/adr/ carries a unique 4-digit number
// and a lowercase-hyphen slug (ADR 0042).
//
//   node tools/scripts/check-adr-numbering.ts
//
// On 2026-08-22 the repo held two ADR 0037 files. Neither author was careless:
// one branch wrote 0037 while the number was still free on main, the other
// merged main in twelve minutes later, and git resolved it cleanly because two
// files with different names never conflict. Nothing read docs/adr/ at all.
//
// The vantage point is what makes this check true. On a pull_request, CI checks
// out refs/pull/N/merge — the merged tree, where both files coexist. Branch
// protection is strict, so a PR cannot merge while behind main; the second PR
// to arrive must update, re-run this check, and renumber. First to merge keeps
// the number.
//
// Deliberately pure: a directory listing, no git. Renumbering onto a number
// that is already taken shows up here as a duplicate. Renumbering onto a free
// number is caught by review against ADR 0042, not by this script.
//
// Gaps in the sequence are legal. Once a number is merged it is immutable, so
// an abandoned pull request retires its number permanently.
//
// Exit 0 = in sync. Exit 1 = drift. Exit 2 = the check could not run.
import { existsSync, readdirSync } from 'node:fs';

const ROOT = 'docs/adr';

// 0042-some-slug.md — four digits, then lowercase alphanumeric words joined by
// single hyphens. A dot is allowed as an in-slug separator so a version can be
// named the way it is written: 0024-elastic-license-2.0.md.
// Rejects 42-x.md, 0042_x.md, 0042-Some-Slug.md, 0042--x.md, 0042-x-.md.
const ADR_FILENAME = /^(\d{4})-[a-z0-9]+(?:[.-][a-z0-9]+)*\.md$/;

const fail: (msg: string) => never = (msg) => {
  console.error(`adr-numbering: ${msg}`);
  process.exit(2);
};

if (!existsSync(ROOT)) fail(`${ROOT} not found`);

const malformed = [];
const byNumber = new Map();
let asserted = 0;

for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
  asserted += 1;
  const match = ADR_FILENAME.exec(entry.name);
  if (!match) {
    malformed.push(`${ROOT}/${entry.name}`);
    continue;
  }
  const [, number] = match;
  if (!byNumber.has(number)) byNumber.set(number, []);
  byNumber.get(number).push(`${ROOT}/${entry.name}`);
}

const duplicates = [...byNumber.entries()]
  .filter(([, paths]) => paths.length > 1)
  .sort(([a], [b]) => a.localeCompare(b));

if (duplicates.length) {
  console.error('adr-numbering: duplicate ADR number (ADR 0042)\n');
  for (const [number, paths] of duplicates) {
    console.error(`  ${number}`);
    for (const path of paths) console.error(`    ${path}`);
  }
  console.error(
    '\nAn ADR number is a claim until merged and a fact afterwards. Whichever',
  );
  console.error(
    'file is already on main keeps its number; the one arriving in this pull',
  );
  console.error(
    'request renumbers to the next free number. Never renumber a merged ADR —',
  );
  console.error('supersede it instead, and update every citation you move.');
}

if (malformed.length) {
  if (duplicates.length) console.error('');
  console.error('adr-numbering: ADR filename is not NNNN-slug.md (ADR 0042)\n');
  for (const path of malformed) console.error(`  ${path}`);
  console.error(
    '\nName it 0042-lowercase-hyphen-slug.md — four digits, then lowercase',
  );
  console.error(
    'alphanumeric words joined by single hyphens (a dot is allowed inside the',
  );
  console.error('slug for versions). ADRs are cited by filename.');
}

if (duplicates.length || malformed.length) process.exit(1);

console.log(`adr-numbering: ${asserted} ADRs asserted`);
