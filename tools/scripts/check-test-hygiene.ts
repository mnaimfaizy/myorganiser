#!/usr/bin/env node

/**
 * Deterministic mechanical checks for Jest test files, plus one assertion
 * check for tools/scripts Contract Suites (ADR 0135).
 *
 * These are the TestReviewer checklist items that do not require judgment.
 * ADR 0004 defines TestReviewer as a static gate with "no judgment required";
 * running these here makes that literally true instead of asking a model to
 * eyeball import order. TestReviewer runs this and reports the output.
 *
 * What this asserts, by file kind:
 *   - Jest `*.test.*` / `*.spec.*` outside apps/web-e2e and tools/scripts:
 *     jest.mock() ordering against workspace imports, mock setup inside
 *     beforeAll(), duplicate top-level describe/helper names, stacked
 *     *Once() queues, unused jest.Mock casts, the vacuous-assertion ratio,
 *     and that at least one expect() — direct or via an asserting local
 *     helper — exists.
 *   - A tools/scripts Contract Suite (any *.test.ts under tools/scripts,
 *     ADR 0135): only that at least one assert()/assert.<method>()/
 *     t.assert… call exists. The Jest rules above do not apply — jest.mock(),
 *     beforeAll(), and expect() are not part of node --test.
 *   - apps/web-e2e specs: not asserted here at all. Their structural rules
 *     are a judgment call TestReviewer makes by reading the file against
 *     .agents/skills/playwright-e2e-workflow/references/e2e-patterns.md.
 *
 * Usage:
 *   node tools/scripts/check-test-hygiene.ts <file> [<file> ...]
 *   node tools/scripts/check-test-hygiene.ts --json <file>
 *
 * Exit codes: 0 = no errors, 1 = at least one error, 2 = bad invocation.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { errorMessage } from './lib/error-message.ts';

import {
  blockAfter,
  signatureBodyAfter,
  lineOf,
  maskNonCode,
  normalize,
} from './lib/source-scan.ts';

const USAGE = `Usage:
  node tools/scripts/check-test-hygiene.ts <file> [<file> ...]
  node tools/scripts/check-test-hygiene.ts --json <file> [<file> ...]
  node tools/scripts/check-test-hygiene.ts [--json] --all
  node tools/scripts/check-test-hygiene.ts [--json] --staged

Runs the mechanical (non-judgment) TestReviewer checklist items against Jest
test files. E2E specs under apps/web-e2e are skipped — they have their
own rules in .agents/skills/playwright-e2e-workflow/references/e2e-patterns.md.
A tools/scripts Contract Suite (ADR 0135) is not a Jest spec — it is a
node --test suite that asserts with node:assert, not expect() — so the Jest
rules above do not run against it. It is still required to assert something:
a Contract Suite with no assert()/assert.<method>()/t.assert… call fails.
`;

const TEST_PATHS = [
  '*.spec.ts',
  '*.spec.tsx',
  '*.spec.js',
  '*.spec.jsx',
  '*.test.ts',
  '*.test.tsx',
  '*.test.js',
  '*.test.jsx',
];

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/** One mechanical finding: the rule it breaks, where, and what to do. */
interface Finding {
  level: 'error' | 'warn';
  rule: string;
  line: number;
  message: string;
}

/** One file's outcome: its findings, or the reason it was skipped. */
interface FileResult {
  file: string;
  findings: Finding[];
  skipped?: 'e2e';
  kind?: 'contract-suite';
}

// --- individual checks -------------------------------------------------------

/**
 * The Nx trap is specific: a static import of a WORKSPACE library is what the
 * boundary lint sees. `jest.mock()` after a relative import is ordinary Jest and
 * is hoisted correctly, so only workspace imports are considered here.
 */
function checkMockOrdering(code: string, raw: string, findings: Finding[]) {
  // Positions come from the masked source (so comments never match); the module
  // specifier is read back from raw, because masking blanks string contents.
  const specifierAt = (index: number, pattern: RegExp) => {
    const slice = raw.slice(index, index + 300);
    const found = slice.match(pattern);
    return found ? found[2] : null;
  };

  let firstWorkspaceImport: { index: number; spec: string } | null = null;
  const importRe = /^[ \t]*import\s[^;]*?from\s*['"]/gm;
  let imp: RegExpExecArray | null;
  while ((imp = importRe.exec(code)) !== null) {
    const spec = specifierAt(
      imp.index,
      /import\s[^;]*?from\s*(['"])([^'"]+)\1/,
    );
    if (spec?.startsWith('@myorganiser/')) {
      firstWorkspaceImport = { index: imp.index, spec };
      break;
    }
  }
  if (!firstWorkspaceImport) return;
  const firstLine = lineOf(raw, firstWorkspaceImport.index);

  const mockRe = /^[ \t]*jest\s*\.\s*mock\s*\(\s*['"]/gm;
  let m: RegExpExecArray | null;
  while ((m = mockRe.exec(code)) !== null) {
    if (m.index <= firstWorkspaceImport.index) continue;
    const spec = specifierAt(m.index, /mock\s*\(\s*(['"])([^'"]+)\1/);
    if (!spec?.startsWith('@myorganiser/')) continue;
    findings.push({
      level: 'error',
      rule: 'jest-mock-before-imports',
      line: lineOf(raw, m.index),
      message: `jest.mock('${spec}') appears after the workspace import of '${firstWorkspaceImport.spec}' on line ${firstLine}. Nx flags that static import as a boundary violation at lint time; move every jest.mock() of a @myorganiser/* library above all @myorganiser/* imports, including 'import type'.`,
    });
  }
}

function checkBeforeAllMocks(code: string, raw: string, findings: Finding[]) {
  const re = /\bbeforeAll\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const body = blockAfter(code, m.index);
    const hit = body.match(
      /\b(mockReset|mockClear|mockRestore|mockResolvedValue|mockRejectedValue|mockReturnValue|mockImplementation|clearAllMocks|resetAllMocks|jest\s*\.\s*fn)\b/,
    );
    if (hit) {
      findings.push({
        level: 'error',
        rule: 'no-mock-setup-in-beforeAll',
        line: lineOf(raw, m.index),
        message: `beforeAll() configures mocks (${hit[1]}). Mocks retain state between tests; move this into beforeEach().`,
      });
    }
  }
}

/**
 * Only top-level (column 0) describes are considered. A nested
 * describe('error handling') under two different parents is legitimate; two
 * top-level blocks with the same title means a suite was appended twice.
 */
function checkDuplicateDescribes(
  code: string,
  raw: string,
  findings: Finding[],
) {
  const seen = new Map<string, number>();
  const re = /^describe\s*\(\s*(['"`])/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    // Title text was masked out, so recover it from the raw source.
    const rawSlice = raw.slice(m.index, m.index + 400);
    const titleMatch = rawSlice.match(/describe\s*\(\s*(['"`])([\s\S]*?)\1/);
    if (!titleMatch) continue;
    const title = titleMatch[2];
    const line = lineOf(raw, m.index);
    if (seen.has(title)) {
      findings.push({
        level: 'error',
        rule: 'no-duplicate-describe',
        line,
        message: `Duplicate describe('${title}') — first defined at line ${seen.get(title)}. This usually means a regenerated suite was appended instead of replacing the original.`,
      });
    } else {
      seen.set(title, line);
    }
  }
}

/**
 * Only module-scope (column 0) declarations. An indented `const x = (...)`
 * inside two different describe/beforeEach blocks is a scoped local, not a
 * duplicated helper.
 */
function checkDuplicateHelpers(code: string, raw: string, findings: Finding[]) {
  const seen = new Map<string, number>();
  const re =
    /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const name = m[1] || m[2];
    const line = lineOf(raw, m.index);
    if (seen.has(name)) {
      findings.push({
        level: 'error',
        rule: 'no-duplicate-helper',
        line,
        message: `Helper '${name}' is declared twice — first at line ${seen.get(name)}.`,
      });
    } else {
      seen.set(name, line);
    }
  }
}

/**
 * A queue only exists when several *Once() calls stack up inside one test. Two
 * calls in two different `it()` blocks are independent one-shot overrides, so
 * hits are grouped per test block rather than per file.
 */
function checkMockReturnValueOnce(
  code: string,
  raw: string,
  findings: Finding[],
) {
  const testRe = /\b(?:it|test)\s*(?:\.\s*\w+\s*)?\(/g;
  let t: RegExpExecArray | null;
  while ((t = testRe.exec(code)) !== null) {
    const body = blockAfter(code, t.index);
    if (!body) continue;
    const offset = code.indexOf(body, t.index);
    const onceRe =
      /\bmock(?:ReturnValue|ResolvedValue|RejectedValue)Once\s*\(/g;
    const hits: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = onceRe.exec(body)) !== null) {
      hits.push(lineOf(raw, offset + m.index));
    }
    if (hits.length >= 2) {
      findings.push({
        level: 'error',
        rule: 'no-once-queues',
        line: hits[0],
        message: `${hits.length} *Once() calls stack up inside one test (lines ${hits.join(', ')}). Queue order breaks under async or concurrent calls — use an order-independent mockImplementation().`,
      });
    }
  }
}

function checkUnusedMockCasts(code: string, raw: string, findings: Finding[]) {
  const re =
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*\bas\s+(?:unknown\s+as\s+)?jest\s*\.\s*(?:Mock|Mocked)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const name = m[1];
    const uses = code.match(new RegExp(`\\b${name}\\b`, 'g')) ?? [];
    if (uses.length <= 1) {
      findings.push({
        level: 'error',
        rule: 'no-unused-mock-cast',
        line: lineOf(raw, m.index),
        message: `'${name}' is cast to jest.Mock but never used. Delete it — it will also trip no-unused-vars.`,
      });
    }
  }
}

function checkVacuousAssertions(
  code: string,
  raw: string,
  findings: Finding[],
  helperAssertions = 0,
) {
  const total = (code.match(/\bexpect\s*\(/g) ?? []).length + helperAssertions;
  if (total === 0) {
    findings.push({
      level: 'error',
      rule: 'no-assertions',
      line: 1,
      message: 'No expect() calls found in this test file.',
    });
    return;
  }
  const re = /\.\s*(toBeTruthy|toBeFalsy|toBeDefined|toBeUndefined)\s*\(/g;
  const hits: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) hits.push(lineOf(raw, m.index));
  if (hits.length && hits.length / total > 0.3) {
    findings.push({
      level: 'warn',
      rule: 'weak-assertions',
      line: hits[0],
      message: `${hits.length} of ${total} assertions are vacuous (toBeTruthy/toBeDefined/…), lines ${hits.slice(0, 8).join(', ')}${hits.length > 8 ? ', …' : ''}. Prefer toBe/toEqual/toHaveBeenCalledWith.`,
    });
  }
}

const CHECKS = [
  checkMockOrdering,
  checkBeforeAllMocks,
  checkDuplicateDescribes,
  checkDuplicateHelpers,
  checkMockReturnValueOnce,
  checkUnusedMockCasts,
];

async function resolveLocalModule(
  file: string,
  specifier: string,
): Promise<string | null> {
  const base = path.resolve(path.dirname(file), specifier);
  const candidates = path.extname(base)
    ? [base]
    : [
        ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
        ...SOURCE_EXTENSIONS.map((extension) =>
          path.join(base, `index${extension}`),
        ),
      ];

  for (const candidate of candidates) {
    try {
      const stats = await fs.stat(candidate);
      if (stats.isFile()) return candidate;
    } catch {
      // Try the next supported source extension.
    }
  }
  return null;
}

/** One `{ imported as local }` binding from a relative import. */
interface ImportedBinding {
  imported: string;
  local: string;
  specifier: string;
}

function importedBindings(raw: string, code: string): ImportedBinding[] {
  const bindings: ImportedBinding[] = [];
  const importRe = /^\s*import\s*{[^}]+}\s*from\s*['"]/gm;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(code)) !== null) {
    const slice = raw.slice(match.index, match.index + 1000);
    const recovered = slice.match(
      /import\s*{([^}]+)}\s*from\s*(['"])(\.[^'"]+)\2/,
    );
    if (!recovered) continue;

    for (const binding of recovered[1].split(',')) {
      const [imported, local = imported] = binding.trim().split(/\s+as\s+/);
      if (imported && local) {
        bindings.push({ imported, local, specifier: recovered[3] });
      }
    }
  }
  return bindings;
}

/** An `expect(` call, credited to a Jest spec that calls this helper. */
const EXPECT_RE = /\bexpect\s*\(/;

function exportedHelperHasAssertion(
  raw: string,
  exportedName: string,
  assertionRe: RegExp,
) {
  const code = maskNonCode(raw);
  const escapedName = exportedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // `<[^(]*>` lets a generic parameter list sit between the name and the
  // parameters. Without it a generic helper is not recognised as a declaration
  // at all, and every spec calling it loses assertion credit.
  const declarationRe = new RegExp(
    `\\bexport\\s+(?:(?:async\\s+)?function\\s+${escapedName}\\s*(?:<[^(]*>)?\\s*\\(|const\\s+${escapedName}\\s*=)`,
  );
  const declaration = declarationRe.exec(code);
  if (!declaration) return false;
  return assertionRe.test(signatureBodyAfter(code, declaration.index));
}

/** Credits a call to a local helper whose exported body itself asserts —
 *  with `expect(` for a Jest spec, or with `assertionRe` for a Contract
 *  Suite's node:assert / test-context calls. */
async function countCalledLocalAssertionHelpers(
  file: string,
  raw: string,
  code: string,
  assertionRe: RegExp,
) {
  let count = 0;
  const moduleCache = new Map<string, string>();

  for (const binding of importedBindings(raw, code)) {
    const callCount = (
      code.match(new RegExp(`\\b${binding.local}\\s*\\(`, 'g')) ?? []
    ).length;
    if (!callCount) continue;

    const modulePath = await resolveLocalModule(file, binding.specifier);
    if (!modulePath) continue;
    let moduleSource = moduleCache.get(modulePath);
    if (moduleSource === undefined) {
      moduleSource = normalize(await fs.readFile(modulePath, 'utf8'));
      moduleCache.set(modulePath, moduleSource);
    }
    if (
      exportedHelperHasAssertion(moduleSource, binding.imported, assertionRe)
    ) {
      count += callCount;
    }
  }

  return count;
}

async function inspect(file: string): Promise<Finding[]> {
  const raw = normalize(await fs.readFile(file, 'utf8'));
  const code = maskNonCode(raw);
  const findings: Finding[] = [];
  for (const check of CHECKS) check(code, raw, findings);
  const helperAssertions = await countCalledLocalAssertionHelpers(
    file,
    raw,
    code,
    EXPECT_RE,
  );
  checkVacuousAssertions(code, raw, findings, helperAssertions);
  findings.sort((a, b) => a.line - b.line);
  return findings;
}

/** An assert()/assert.<method>() call from node:assert or node:assert/strict
 *  (however the import is named), or a t.assert… call on the test context. */
const CONTRACT_SUITE_ASSERTION_RE =
  /\bassert\s*\.\s*[A-Za-z_$][\w$]*\s*\(|\bassert\s*\(|\bt\s*\.\s*assert\b/;

/** A tools/scripts Contract Suite's only mechanical rule (ADR 0135): it must
 *  call an assertion somewhere, directly or through a local helper (such as
 *  copilot-hooks/hook-harness.ts's expectContext()) whose exported body
 *  asserts. Every other check in CHECKS is Jest-specific and does not apply
 *  — jest.mock(), beforeAll(), and expect() are not part of node --test. */
async function inspectContractSuite(file: string): Promise<Finding[]> {
  const raw = normalize(await fs.readFile(file, 'utf8'));
  const code = maskNonCode(raw);
  if (CONTRACT_SUITE_ASSERTION_RE.test(code)) return [];
  const helperAssertions = await countCalledLocalAssertionHelpers(
    file,
    raw,
    code,
    CONTRACT_SUITE_ASSERTION_RE,
  );
  if (helperAssertions > 0) return [];
  return [
    {
      level: 'error',
      rule: 'no-assertions',
      line: 1,
      message: `No assert()/assert.<method>()/t.assert… call found in ${file}. A Contract Suite (ADR 0135) asserts with node:assert, not expect() — add at least one assertion.`,
    },
  ];
}

function isE2E(file: string) {
  return path.normalize(file).replace(/\\/g, '/').includes('apps/web-e2e/');
}

/** A `node --test` Contract Suite (ADR 0135), not a Jest spec: it asserts
 *  with `node:assert`, never `expect()`, so the Jest-oriented checks below
 *  would misread it as having none. It is routed to inspectContractSuite
 *  instead, which checks for an assertion call without applying any
 *  Jest-specific rule. Matched by `.test.ts` specifically — a `*.spec.ts`
 *  file under tools/scripts would be a Jest spec this checker still has to
 *  run. */
function isToolsScripts(file: string) {
  const normalized = path.normalize(file).replace(/\\/g, '/');
  return (
    normalized.includes('tools/scripts/') && normalized.endsWith('.test.ts')
  );
}

function collectGitFiles(mode: 'all' | 'staged') {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const args =
    mode === 'all'
      ? ['ls-files', '-z', '--', ...TEST_PATHS]
      : [
          'diff',
          '--cached',
          '--name-only',
          '--diff-filter=ACMR',
          '-z',
          '--',
          ...TEST_PATHS,
        ];
  const output = execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  });
  process.chdir(root);
  return output
    .split('\0')
    .filter(Boolean)
    .filter((file) => !isE2E(file));
}

function printResults(results: FileResult[], concise: boolean) {
  for (const result of results) {
    if (result.skipped) {
      if (!concise) {
        console.log(
          `\n${result.file}\n  SKIPPED (E2E spec — structural rules live in the Playwright skill)`,
        );
      }
      continue;
    }
    if (concise && !result.findings.length) continue;
    console.log(`\n${result.file}`);
    if (!result.findings.length) {
      console.log(
        result.kind === 'contract-suite'
          ? '  PASS — asserts with node:assert (Contract Suite, ADR 0135)'
          : '  PASS — no mechanical issues',
      );
      continue;
    }
    for (const finding of result.findings) {
      const tag = finding.level === 'error' ? 'ERROR' : 'WARN ';
      console.log(
        `  ${tag} ${finding.rule} (line ${finding.line})\n        ${finding.message}`,
      );
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE);
    process.exitCode = argv.length ? 0 : 2;
    return;
  }

  const json = argv.includes('--json');
  const all = argv.includes('--all');
  const staged = argv.includes('--staged');
  const unknownFlags = argv.filter(
    (arg) =>
      arg.startsWith('--') && !['--json', '--all', '--staged'].includes(arg),
  );
  const explicitFiles = argv.filter((arg) => !arg.startsWith('--'));
  if (
    unknownFlags.length ||
    (all && staged) ||
    ((all || staged) && explicitFiles.length)
  ) {
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }
  const selector = all ? 'all' : staged ? 'staged' : null;
  const files = selector ? collectGitFiles(selector) : explicitFiles;
  if (!files.length) {
    if (staged) {
      process.stdout.write('No staged Jest files to check.\n');
      return;
    }
    if (all) {
      process.stdout.write('Checked 0 Jest files: 0 error(s), 0 warning(s)\n');
      return;
    }
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }

  const results: FileResult[] = [];
  let errors = 0;
  let warnings = 0;

  for (const file of files) {
    if (isE2E(file)) {
      results.push({ file, skipped: 'e2e', findings: [] });
      continue;
    }
    const kind = isToolsScripts(file) ? 'contract-suite' : undefined;
    let findings: Finding[];
    try {
      findings =
        kind === 'contract-suite'
          ? await inspectContractSuite(file)
          : await inspect(file);
    } catch (error) {
      results.push({
        file,
        kind,
        findings: [
          {
            level: 'error',
            rule: 'unreadable',
            line: 1,
            message: errorMessage(error),
          },
        ],
      });
      errors += 1;
      continue;
    }
    errors += findings.filter((f) => f.level === 'error').length;
    warnings += findings.filter((f) => f.level === 'warn').length;
    results.push({ file, kind, findings });
  }

  if (json) {
    process.stdout.write(
      `${JSON.stringify({ errors, warnings, results }, null, 2)}\n`,
    );
  } else {
    printResults(results, all);
    const contractChecked = results.filter(
      (r) => r.kind === 'contract-suite',
    ).length;
    const jestChecked = results.length - contractChecked;
    const summary = all
      ? `Checked ${jestChecked} Jest files${contractChecked ? ` and ${contractChecked} Contract Suite${contractChecked === 1 ? '' : 's'}` : ''}`
      : 'Mechanical hygiene';
    console.log(`\n${summary}: ${errors} error(s), ${warnings} warning(s)`);
  }

  process.exitCode = errors > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
