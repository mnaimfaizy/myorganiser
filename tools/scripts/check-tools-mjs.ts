#!/usr/bin/env node
// Fails on any `.mjs` file under tools/scripts, naming each one.
//
//   node tools/scripts/check-tools-mjs.ts [scriptsDir] [--print]
//
// ADR 0135 moved every tooling script to strict TypeScript that Node runs by
// stripping types, and this is its contract step: once no `.mjs` remained,
// the old form had to become impossible to bring back. A script written from
// habit, or copied from an old example, as `.mjs` would be untyped again —
// `yarn typecheck:check` reaches the tools tsconfig, which includes only
// `.ts` — and the Meta-Gate would not even find it as a checker, so nothing
// else would notice.
//
// One direction is asserted: no file under the scripts directory ends in
// `.mjs`, at any depth (`lib/`, `review/`, `ai/`, `ci/`, `copilot-hooks/`,
// and fixtures included). The other direction — that every script *is* a
// `.ts` file — is deliberately not asserted: the directory also holds a
// shell script, a `package.json`, a tsconfig, and JSON fixtures, all of
// which are correct as they are. `.js` and `.cjs` are not checked either;
// ADR 0135 retires the `.mjs` convention, and neither of those was ever in
// use here.
//
// The scan reads the working tree, not the git index, so an `.mjs` being
// written fails before it is ever staged. `node_modules` is skipped: it is
// installed output, not a tooling script anyone authored.
//
// `.mjs` files elsewhere — `.agents/skills`, `libs/email-shell` — are out of
// scope (ADR 0135 Consequences) and are not read.
//
// Exit 0 = no `.mjs` under the scripts directory. Exit 1 = at least one,
// each named. Exit 2 = the check could not run.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { errorMessage } from './lib/error-message.ts';

const args = process.argv.slice(2);
const printOnly = args.includes('--print');
const scriptsArg = args.find((a) => !a.startsWith('--')) ?? 'tools/scripts';
const SCRIPTS_DIR = resolve(scriptsArg);

const fail: (msg: string) => never = (msg) => {
  console.error(`tools-mjs: ${msg}`);
  process.exit(2);
};

if (!existsSync(SCRIPTS_DIR) || !statSync(SCRIPTS_DIR).isDirectory()) {
  fail(`${scriptsArg} is not a directory`);
}

let entries: string[];
try {
  entries = readdirSync(SCRIPTS_DIR, { recursive: true })
    .map(String)
    .filter((entry) => !entry.split(sep).includes('node_modules'))
    .sort();
} catch (error) {
  fail(`could not read ${scriptsArg}: ${errorMessage(error)}`);
}

const offenders = entries
  .filter((entry) => entry.endsWith('.mjs'))
  .map((entry) => join(scriptsArg, entry).split(sep).join('/'));

if (printOnly) {
  console.log(
    `tools-mjs: ${entries.length} entries scanned under ${scriptsArg}`,
  );
}

if (offenders.length > 0) {
  console.error('tools-mjs: .mjs file found under tools/scripts (ADR 0135)\n');
  for (const offender of offenders) console.error(`  - ${offender}`);
  console.error(
    '\nTooling scripts are strict TypeScript run directly by Node. Rename the' +
      '\nfile to `.ts`, add its types, and keep `yarn typecheck:check` green.',
  );
  process.exit(1);
}

console.log(
  `tools-mjs: OK — ${entries.length} entries scanned under ${scriptsArg}, 0 .mjs files`,
);
