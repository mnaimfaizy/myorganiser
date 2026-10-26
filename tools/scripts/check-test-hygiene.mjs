#!/usr/bin/env node

/**
 * Deterministic mechanical checks for Jest test files.
 *
 * These are the TestReviewer checklist items that do not require judgment.
 * ADR 0004 defines TestReviewer as a static gate with "no judgment required";
 * running these here makes that literally true instead of asking a model to
 * eyeball import order. TestReviewer runs this and reports the output.
 *
 * Usage:
 *   node tools/scripts/check-test-hygiene.mjs <file> [<file> ...]
 *   node tools/scripts/check-test-hygiene.mjs --json <file>
 *
 * Exit codes: 0 = no errors, 1 = at least one error, 2 = bad invocation.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  blockAfter,
  signatureBodyAfter,
  lineOf,
  maskNonCode,
  normalize,
} from './lib/source-scan.ts';

const USAGE = `Usage:
  node tools/scripts/check-test-hygiene.mjs <file> [<file> ...]
  node tools/scripts/check-test-hygiene.mjs --json <file> [<file> ...]
  node tools/scripts/check-test-hygiene.mjs [--json] --all
  node tools/scripts/check-test-hygiene.mjs [--json] --staged

Runs the mechanical (non-judgment) TestReviewer checklist items against Jest
test files. E2E specs under apps/web-e2e are skipped — they have their
own rules in .agents/skills/playwright-e2e-workflow/references/e2e-patterns.md.
tools/scripts/**/*.test.ts Contract Suites are skipped too — they are
node --test suites asserting with node:assert, not Jest specs asserting with
expect(), and ADR 0135 covers them with their own tooling.
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

// --- individual checks -------------------------------------------------------

/**
 * The Nx trap is specific: a static import of a WORKSPACE library is what the
 * boundary lint sees. `jest.mock()` after a relative import is ordinary Jest and
 * is hoisted correctly, so only workspace imports are considered here.
 */
function checkMockOrdering(code, raw, findings) {
  // Positions come from the masked source (so comments never match); the module
  // specifier is read back from raw, because masking blanks string contents.
  const specifierAt = (index, pattern) => {
    const slice = raw.slice(index, index + 300);
    const found = slice.match(pattern);
    return found ? found[2] : null;
  };

  let firstWorkspaceImport = null;
  const importRe = /^[ \t]*import\s[^;]*?from\s*['"]/gm;
  let imp;
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
  let m;
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

function checkBeforeAllMocks(code, raw, findings) {
  const re = /\bbeforeAll\s*\(/g;
  let m;
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
function checkDuplicateDescribes(code, raw, findings) {
  const seen = new Map();
  const re = /^describe\s*\(\s*(['"`])/gm;
  let m;
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
function checkDuplicateHelpers(code, raw, findings) {
  const seen = new Map();
  const re =
    /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/gm;
  let m;
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
function checkMockReturnValueOnce(code, raw, findings) {
  const testRe = /\b(?:it|test)\s*(?:\.\s*\w+\s*)?\(/g;
  let t;
  while ((t = testRe.exec(code)) !== null) {
    const body = blockAfter(code, t.index);
    if (!body) continue;
    const offset = code.indexOf(body, t.index);
    const onceRe =
      /\bmock(?:ReturnValue|ResolvedValue|RejectedValue)Once\s*\(/g;
    const hits = [];
    let m;
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

function checkUnusedMockCasts(code, raw, findings) {
  const re =
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*\bas\s+(?:unknown\s+as\s+)?jest\s*\.\s*(?:Mock|Mocked)/g;
  let m;
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

function checkVacuousAssertions(code, raw, findings, helperAssertions = 0) {
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
  const hits = [];
  let m;
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

async function resolveLocalModule(file, specifier) {
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

function importedBindings(raw, code) {
  const bindings = [];
  const importRe = /^\s*import\s*{[^}]+}\s*from\s*['"]/gm;
  let match;
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

function exportedHelperHasAssertion(raw, exportedName) {
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
  return /\bexpect\s*\(/.test(signatureBodyAfter(code, declaration.index));
}

async function countCalledLocalAssertionHelpers(file, raw, code) {
  let count = 0;
  const moduleCache = new Map();

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
    if (exportedHelperHasAssertion(moduleSource, binding.imported)) {
      count += callCount;
    }
  }

  return count;
}

async function inspect(file) {
  const raw = normalize(await fs.readFile(file, 'utf8'));
  const code = maskNonCode(raw);
  const findings = [];
  for (const check of CHECKS) check(code, raw, findings);
  const helperAssertions = await countCalledLocalAssertionHelpers(
    file,
    raw,
    code,
  );
  checkVacuousAssertions(code, raw, findings, helperAssertions);
  findings.sort((a, b) => a.line - b.line);
  return findings;
}

function isE2E(file) {
  return path.normalize(file).replace(/\\/g, '/').includes('apps/web-e2e/');
}

/** A `node --test` Contract Suite (ADR 0135), not a Jest spec: it asserts
 *  with `node:assert`, never `expect()`, so the Jest-oriented checks below
 *  would read it as having none. Matched by `.test.ts` specifically — a
 *  `tools/scripts/copilot-hooks/__tests__/*.spec.ts` file is a Jest spec
 *  this checker still has to run. */
function isToolsScripts(file) {
  const normalized = path.normalize(file).replace(/\\/g, '/');
  return (
    normalized.includes('tools/scripts/') && normalized.endsWith('.test.ts')
  );
}

function collectGitFiles(mode) {
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
    .filter((file) => !isE2E(file) && !isToolsScripts(file));
}

function printResults(results, concise) {
  for (const result of results) {
    if (result.skipped) {
      if (!concise) {
        const reason =
          result.skipped === 'tools-scripts'
            ? 'Contract Suite — asserts with node:assert, not expect() (ADR 0135)'
            : 'E2E spec — structural rules live in the Playwright skill';
        console.log(`\n${result.file}\n  SKIPPED (${reason})`);
      }
      continue;
    }
    if (concise && !result.findings.length) continue;
    console.log(`\n${result.file}`);
    if (!result.findings.length) {
      console.log('  PASS — no mechanical issues');
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

  const results = [];
  let errors = 0;
  let warnings = 0;

  for (const file of files) {
    if (isE2E(file)) {
      results.push({ file, skipped: 'e2e', findings: [] });
      continue;
    }
    if (isToolsScripts(file)) {
      results.push({ file, skipped: 'tools-scripts', findings: [] });
      continue;
    }
    let findings;
    try {
      findings = await inspect(file);
    } catch (error) {
      results.push({
        file,
        findings: [
          {
            level: 'error',
            rule: 'unreadable',
            line: 1,
            message: error?.message ?? String(error),
          },
        ],
      });
      errors += 1;
      continue;
    }
    errors += findings.filter((f) => f.level === 'error').length;
    warnings += findings.filter((f) => f.level === 'warn').length;
    results.push({ file, findings });
  }

  if (json) {
    process.stdout.write(
      `${JSON.stringify({ errors, warnings, results }, null, 2)}\n`,
    );
  } else {
    printResults(results, all);
    const summary = all
      ? `Checked ${files.length} Jest files`
      : 'Mechanical hygiene';
    console.log(`\n${summary}: ${errors} error(s), ${warnings} warning(s)`);
  }

  process.exitCode = errors > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
