#!/usr/bin/env node
// Asserts that markdown under libs/ is only Agent Guides and the design-tokens
// Library README + DESIGN.md (ADR 0023).
//
//   node tools/scripts/check-libs-markdown.ts
//
// Page READMEs, Nx scaffold READMEs, and other colocated notes went stale with
// nothing to catch them. This check is a filename allowlist only — it does not
// judge whether an Agent Guide earns its keep.
//
// Exit 0 = in sync. Exit 1 = drift. Exit 2 = the check could not run.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'libs';

const ALLOWED_EXACT = new Set([
  'libs/design-tokens/README.md',
  'libs/design-tokens/DESIGN.md',
]);

const fail: (msg: string) => never = (msg) => {
  console.error(`libs-markdown: ${msg}`);
  process.exit(2);
};

if (!existsSync(ROOT)) fail(`${ROOT} not found`);

const SKIP_DIRS = new Set(['node_modules', 'graphify-out', 'generated']);

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(path));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) out.push(path);
  }
  return out;
};

const findings = [];
let asserted = 0;

for (const file of walk(ROOT)) {
  const rel = file.replaceAll('\\', '/');
  asserted += 1;
  const base = rel.slice(rel.lastIndexOf('/') + 1);
  if (base === 'AGENTS.md') continue;
  if (ALLOWED_EXACT.has(rel)) continue;
  findings.push(rel);
}

if (findings.length) {
  console.error(
    'libs-markdown: markdown under libs/ is not on the ADR 0023 allowlist\n',
  );
  for (const finding of findings) {
    console.error(`  ${finding}`);
  }
  console.error(
    '\nAllowed: AGENTS.md anywhere, libs/design-tokens/README.md, libs/design-tokens/DESIGN.md.',
  );
  console.error(
    'Promote lasting docs to docs/adr/ or docs/features/; delete the rest.',
  );
  process.exit(1);
}

console.log(`libs-markdown: ${asserted} files on the allowlist`);
