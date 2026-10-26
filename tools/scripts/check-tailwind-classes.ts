#!/usr/bin/env node
// Fails a Tailwind utility that names a theme value and compiles to no CSS (ADR 0065).
//
//   node tools/scripts/check-tailwind-classes.ts [--print]
//
// Tailwind drops a class name it cannot resolve. There is no build error, no
// warning, and no missing-file failure — the element simply renders unstyled.
// `libs/web/pages/groceries` shipped 212 such occurrences across 25 names
// (issue #632): a Material Design 3 vocabulary — `surface-container-low`,
// `on-surface-variant`, `outline-variant` — that existed in neither the design
// tokens nor either Tailwind config. Twelve Jest assertions pinned those names
// and stayed green the whole time, because `toHaveClass` cares whether a string
// is in an attribute, not whether it paints anything.
//
// Resolution is delegated to Tailwind itself rather than reimplemented. A
// hand-maintained list of valid suffixes is the obvious approach and the wrong
// one: it has to know that `text-xs`, `text-center` and `max-w-md` are fine
// while `text-error` is not, and it is wrong again the day someone adds a
// Semantic Role. Compiling the real stylesheet — with its `@config`, its
// imported generated roles, and both Tailwind configs — asks the only authority
// that can answer.
//
// Candidates come from Tailwind's own scanner (`@tailwindcss/oxide`) for the
// same reason. Regex extraction was tried while diagnosing #632 and produced
// false positives from a `file-text-icon` test id and a `delete-from-catalog`
// test name. A gate that cries wolf is a gate people learn to skip.
//
// Two scope decisions, both load-bearing:
//
//   * `libs/email-shell` and `libs/mobile` are excluded. Neither renders through
//     Tailwind — the email shell emits inline CSS for mail clients, and mobile
//     uses React Native `StyleSheet` (ADR 0008). Their CSS property names
//     (`border-bottom`, `text-decoration`) are class-shaped, and they are the
//     only false positives this check was measured to have.
//   * Test files are deliberately IN scope. They contribute no false positives,
//     and a test asserting a class name that paints nothing is the exact failure
//     #632 turned on.
//
// Spacing and radius are in scope alongside colour: `py-md` and `gap-sm` named
// design-token steps no Tailwind config exposes and failed exactly the same
// silent way, found by this check while it still only looked at colour.
//
// Arbitrary values (`bg-[var(--color-surface,#F8FAFC)]`) are skipped. Tailwind
// emits those verbatim, so they cannot silently resolve to nothing the way a
// named token can; the authentication pages use them legitimately.
//
// Exit 0 = every themed utility resolves. Exit 1 = at least one paints nothing.
// Exit 2 = the check could not run.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const cwd = process.cwd();
const printOnly = process.argv.includes('--print');

const fail: (msg: string) => never = (msg) => {
  console.error(`tailwind-classes: ${msg}`);
  process.exit(2);
};

/** The stylesheet the browser actually gets. Everything resolves through it. */
const ENTRY = 'apps/web/src/app/global.css';

/** Where Tailwind classes are authored. A negation must follow its base. */
const SOURCES = [
  { base: 'libs', pattern: '**/*.{ts,tsx}', negated: false },
  { base: 'libs/email-shell', pattern: '**/*.{ts,tsx}', negated: true },
  { base: 'libs/mobile', pattern: '**/*.{ts,tsx}', negated: true },
  { base: 'apps/web/src', pattern: '**/*.{ts,tsx}', negated: false },
];

/**
 * Utilities that take a value from the theme — a colour, a spacing step, a
 * radius. These are the ones a token name can be wrong in.
 *
 * Margin prefixes (`m-`, `my-`, …) are deliberately absent: `my-` matches any
 * hyphenated identifier, and a form field named `my-vault-passphrase` was the
 * one false positive this check was measured to have. Margins carry no token
 * vocabulary of their own, so excluding them costs nothing.
 */
const THEMED_UTILITY =
  /^([a-z-]+:)*(bg|text|border|ring|divide|from|via|to|fill|stroke|outline|decoration|placeholder|accent|caret|shadow|p|px|py|pt|pb|pl|pr|gap|gap-x|gap-y|space-x|space-y|rounded)-/;

/** CSS selector escaping for the characters Tailwind class names carry. */
const selectorFor = (candidate: string) =>
  '.' + candidate.replace(/([.:/[\]()%!,#])/g, '\\$1');

let Scanner: typeof import('@tailwindcss/oxide').Scanner;
let compile: typeof import('tailwindcss').compile;
try {
  ({ Scanner } = require('@tailwindcss/oxide'));
  ({ compile } = await import('tailwindcss'));
} catch (err) {
  fail(
    `could not load Tailwind. Is the workspace installed?\n  ${err instanceof Error ? err.message : String(err)}`,
  );
}

const entryPath = join(cwd, ENTRY);
let entryCss: string;
try {
  entryCss = await readFile(entryPath, 'utf8');
} catch {
  fail(`entry stylesheet not found: ${ENTRY}`);
}

const loadStylesheet = async (id: string, base: string) => {
  const path =
    id === 'tailwindcss'
      ? join(cwd, 'node_modules/tailwindcss/index.css')
      : resolve(base, id);
  return { path, base: dirname(path), content: await readFile(path, 'utf8') };
};

const loadModule = async (id: string, base: string) => {
  const path = resolve(base, id);
  return { path, base: dirname(path), module: require(path) };
};

let compiled: Awaited<ReturnType<typeof compile>>;
try {
  compiled = await compile(entryCss, {
    base: dirname(entryPath),
    loadStylesheet,
    loadModule,
  });
} catch (err) {
  fail(
    `could not compile ${ENTRY}:\n  ${err instanceof Error ? err.message : String(err)}`,
  );
}

const scanner = new Scanner({
  sources: SOURCES.map((s) => ({ ...s, base: join(cwd, s.base) })),
});

const candidates = [...new Set(scanner.scan())]
  .filter((c) => THEMED_UTILITY.test(c) && !c.includes('['))
  .sort();

// One build for all candidates. Building per candidate is O(n) compiles of the
// whole stylesheet, which turns a 300ms check into a minute.
const css = compiled.build(candidates);
const unresolved = candidates.filter((c) => !css.includes(selectorFor(c)));

if (printOnly) {
  const named = (negated: boolean) =>
    SOURCES.filter((s) => s.negated === negated)
      .map((s) => s.base)
      .join(', ');
  console.log(`entry:      ${ENTRY}`);
  console.log(`sources:    ${named(false)}`);
  console.log(`excluded:   ${named(true)}`);
  console.log(`candidates: ${candidates.length} themed utilities`);
  console.log(`unresolved: ${unresolved.length}`);
  for (const c of unresolved) console.log(`  ${c}`);
  process.exit(0);
}

if (unresolved.length > 0) {
  console.error(
    `tailwind-classes: ${unresolved.length} themed ${
      unresolved.length === 1 ? 'utility compiles' : 'utilities compile'
    } to no CSS\n`,
  );
  for (const c of unresolved) console.error(`  - ${c}`);
  console.error(
    '\nThese render unstyled, with no build error. Either the name is wrong, or' +
      '\nthe Semantic Role it wants does not exist yet — add it to' +
      '\nlibs/design-tokens/src/tokens.json under both colour modes and rebuild' +
      '\ntokens (ADR 0065). Do not add a colour name to a Tailwind config by hand.',
  );
  process.exit(1);
}

console.log(`tailwind-classes: ${candidates.length} themed utilities asserted`);
