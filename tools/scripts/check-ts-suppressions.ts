#!/usr/bin/env node
// Rejects `ts-nocheck`, `ts-ignore`, and a reasonless `ts-expect-error` in
// every `tools/scripts` `.ts` file.
//
//   node tools/scripts/check-ts-suppressions.ts [scriptsDir] [--print]
//
// ADR 0135's migration promises strict typechecking buys real type safety
// rather than just a moved file extension: a migrated script carries no
// `ts-nocheck`, no `ts-ignore`, and a `ts-expect-error` only with a written
// reason. `yarn typecheck:check` only proves a file compiles, and a
// suppression comment is exactly how a file compiles while hiding the error
// typechecking exists to catch — nothing before this gate enforced that.
//
// Throughout this file the three directives are written without their leading
// `@`, and the literals the scan matches are assembled from `DIRECTIVE_AT`
// below, so this file does not match the check it implements and needs no
// exemption from its own scan. `check-product-name.ts` spells the name it
// forbids the same way, and for the same reason.
//
// `ts-nocheck` and `ts-ignore` are forbidden outright: neither carries a
// reason, and both suppress silently with no expiry. `ts-expect-error` is
// allowed, but only with a written reason — text after the directive on the
// same comment line — because a suppression that errors the moment the
// line it names stops erroring is a different kind of debt than one that
// hides forever, and ADR 0135 asks for the reason in writing.
//
// This is a text scan over tracked lines, not an AST walk: the three are
// directives TypeScript itself recognises only in a comment, so matching the
// literal text is exactly what the compiler does, with none of the
// false-positive risk a bare substring match on an import specifier has in
// `check-mobile-platform.ts`.
//
// `copilot-hooks/__tests__` is excluded, mirroring `tools/scripts/tsconfig.json`:
// those specs are still Jest, not yet subject to ADR 0135's strict-TypeScript
// convention this rule enforces, until their own later migration slice.
//
// Every other `.ts` file under `tools/scripts` is in scope, this file and its
// Contract Suite included.
//
// Exit 0 = zero violations. Exit 1 = a forbidden suppression comment was
// found, naming the file and line. Exit 2 = the check could not run.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { errorMessage } from './lib/error-message.ts';

const args = process.argv.slice(2);
const printOnly = args.includes('--print');
const SCRIPTS_DIR = resolve(
  args.find((a) => !a.startsWith('--')) ?? 'tools/scripts',
);

const EXCLUDED_PREFIX = ['copilot-hooks', '__tests__'].join(sep) + sep;

/**
 * The prefix every directive shares, kept apart from its suffix so no literal
 * this scan matches is ever written out in this file; see the header.
 */
const DIRECTIVE_AT = ['@', 'ts-'].join('');

/** `ts-expect-error`, spelled as the compiler reads it. */
const EXPECT_ERROR_NAME = `${DIRECTIVE_AT}expect-error`;

const fail: (msg: string) => never = (msg) => {
  console.error(`ts-suppressions: ${msg}`);
  process.exit(2);
};

/** Every `.ts` file under `dir`, recursively, excluding the still-Jest copilot-hooks specs. Returns `[]` for a missing dir. */
function listTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .filter(
      (entry): entry is string =>
        typeof entry === 'string' &&
        entry.endsWith('.ts') &&
        !entry.startsWith(EXCLUDED_PREFIX),
    )
    .sort();
}

// Always forbidden: neither carries a reason, and both suppress silently.
const ALWAYS_BANNED = ['nocheck', 'ignore'].map((suffix) => ({
  name: `${DIRECTIVE_AT}${suffix}`,
  pattern: new RegExp(`${DIRECTIVE_AT}${suffix}\\b`),
}));

// Allowed only with a written reason: text after the directive, on the same
// line, once a trailing block-comment close (`*/`) is stripped.
const EXPECT_ERROR = new RegExp(`${EXPECT_ERROR_NAME}\\b(.*)$`);

function scan(relativePath: string, text: string): string[] {
  const findings: string[] = [];
  text.split('\n').forEach((line, index) => {
    const lineNumber = index + 1;
    for (const { name, pattern } of ALWAYS_BANNED) {
      if (pattern.test(line)) {
        findings.push(
          `${relativePath}:${lineNumber}: \`${name}\` is forbidden in tools/scripts — ` +
            'it suppresses with no written reason and no expiry. Fix the type error, ' +
            `or use \`${EXPECT_ERROR_NAME}\` with a reason if it is genuinely expected.`,
        );
      }
    }
    const match = line.match(EXPECT_ERROR);
    if (match) {
      const reason = match[1].replace(/\*\/\s*$/, '').trim();
      if (!reason) {
        findings.push(
          `${relativePath}:${lineNumber}: \`${EXPECT_ERROR_NAME}\` carries no written reason. ` +
            'Add text after the directive explaining why the error is expected (ADR 0135).',
        );
      }
    }
  });
  return findings;
}

const files = listTsFiles(SCRIPTS_DIR);

if (printOnly) {
  console.log(
    `ts-suppressions: ${files.length} .ts file(s) scanned under ${SCRIPTS_DIR}`,
  );
  for (const file of files) console.log(`  ${file}`);
}

const findings: string[] = [];
for (const file of files) {
  const relativePath = join('tools', 'scripts', file);
  let text: string;
  try {
    text = readFileSync(join(SCRIPTS_DIR, file), 'utf8');
  } catch (error) {
    fail(`could not read ${relativePath}: ${errorMessage(error)}`);
  }
  findings.push(...scan(relativePath, text));
}

if (findings.length > 0) {
  console.error(
    'ts-suppressions: forbidden suppression comment found in tools/scripts\n',
  );
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}

console.log(
  `ts-suppressions: OK — ${files.length} .ts file(s) scanned, 0 violations`,
);
