#!/usr/bin/env node

/**
 * Deterministic mechanical checks for React components.
 *
 * These are the ComponentReviewer checklist items that do not require judgment.
 * A model asked to confirm "displayName is set on every forwardRef component"
 * will say PASS at a glance and be wrong on the one sub-component that was
 * missed; a script counts. Running the shape rules here lets ComponentReviewer
 * spend its pass on the questions a script cannot answer — is the compound
 * split right, is this component doing too much, is the abstraction sound.
 *
 * Companion to check-test-hygiene.mjs; see docs/ui/GUIDELINES.md for the rules
 * this enforces and docs/adr/0014-component-pipeline-guardrails.md for why.
 *
 * Scopes: UI Primitives (libs/web/ui/src/lib/components/), Feature Components
 * (libs/web/pages/<route>/src/), Vault UI Components (libs/web/vault-ui/src/lib/),
 * and Feature Library Components — `.tsx` under `libs/web/<lib>/src/lib/` of any
 * other library tagged `type:feature` and `scope:web` in its project.json (for
 * example libs/web/usage-locations). The tags are read rather than the library
 * named, so the next shared feature library is checked on arrival instead of
 * sitting behind a green checker until somebody remembers to add it.
 *
 * Deliberately NOT checked here:
 *   - `any` usage — @typescript-eslint/no-explicit-any already owns it, honours
 *     inline disable comments, and this repo has four deliberate suppressions.
 *     Duplicating it here would report violations ESLint has already accepted.
 *   - 'use client' placement — Next.js inherits the client boundary through the
 *     import graph, so a child of a client component legitimately omits it. Not
 *     decidable from one file; ComponentReviewer judges it.
 *   - Composition pattern, concern mixing, abstraction quality, Radix-vs-custom
 *     — judgment, and the reason ComponentReviewer still reads the component.
 *
 * Usage:
 *   node tools/scripts/check-component-hygiene.mjs <file> [<file> ...]
 *   node tools/scripts/check-component-hygiene.mjs --json <file>
 *   node tools/scripts/check-component-hygiene.mjs --all
 *   node tools/scripts/check-component-hygiene.mjs --staged
 *   node tools/scripts/check-component-hygiene.mjs --all --max-warnings=0
 *
 * `--max-warnings=0` composes with any file-selection mode above, including
 * explicit file arguments — it is not restricted to `--all`/`--staged`.
 * ComponentBuilder and ComponentReviewer both invoke it this way on every
 * pass, so a warning that would fail pre-commit's staged strict check
 * (ADR 0014) surfaces as a required revision during review instead of only
 * at commit time.
 *
 * Exit codes: 0 = files were inspected and came in within budget, 1 = errors,
 * exceeded warning budget, or every input fell out of scope, 2 = bad
 * invocation.
 *
 * The last case of 1 is deliberate: a run that inspected nothing printed the
 * same "0 error(s), 0 warning(s)" as a run that inspected everything, which is
 * how a whole library sat behind a green checker (#290). 0 now means checks
 * ran and passed, never that there were no checks to run.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

import {
  blockAfter,
  lineOf,
  maskNonCode,
  normalize,
  parenAfter,
  reportFindings,
} from './lib/source-scan.mjs';

const USAGE = `Usage:
  node tools/scripts/check-component-hygiene.mjs <file> [<file> ...] [--max-warnings=0]
  node tools/scripts/check-component-hygiene.mjs --json <file> [<file> ...] [--max-warnings=0]
  node tools/scripts/check-component-hygiene.mjs --all [--max-warnings=0]
  node tools/scripts/check-component-hygiene.mjs --staged [--max-warnings=0]

--max-warnings=0 composes with any mode above, including explicit files.

Exits non-zero when every input is out of scope: a run that checked nothing is
not a pass.

Runs the mechanical (non-judgment) ComponentReviewer checklist items against
React components in libs/web/ui/ (UI Primitives), libs/web/pages/ (Feature
Components), libs/web/vault-ui/ (Vault UI Components), and every other
libs/web/<lib>/ tagged type:feature + scope:web (Feature Library Components).
Stories and test files are skipped. Judgment items — composition pattern, concern mixing,
abstraction quality — stay with ComponentReviewer.
`;

/**
 * The barrel each scope publishes through, and the path shape whose export it
 * is checked against. A scope with no entry simply has no barrel rule — the
 * absence is stated here rather than inferred from a regex that fails to match.
 */
const SCOPE_BARRELS = {
  primitive: {
    barrel: 'libs/web/ui/src/index.ts',
    re: /libs\/web\/ui\/src\/(lib\/components\/[^/]+\/[^/]+)\.tsx$/,
  },
  'vault-ui': {
    barrel: 'libs/web/vault-ui/src/index.ts',
    re: /libs\/web\/vault-ui\/src\/(lib\/[^/]+)\.tsx$/,
  },
};

/**
 * A Feature Library publishes through its own `src/index.ts`, so its barrel
 * depends on the file rather than the scope. Only a compound root is held to
 * it — `lib/<Name>.tsx` or `lib/<Name>/<Name>.tsx` — because a part beside the
 * root in its folder is the root's business, not the library's public surface.
 */
const FEATURE_LIBRARY_ROOT = /libs\/web\/([^/]+)\/src\/lib\/.+\.tsx$/;
const FEATURE_LIBRARY_BARREL_RE =
  /libs\/web\/[^/]+\/src\/(lib\/(?:([^/]+)\/\2|[^/]+))\.tsx$/;

/** Libraries under libs/web/ that have a scope of their own. */
const NAMED_WEB_LIBRARIES = new Set(['ui', 'vault-ui', 'pages']);

function barrelSpecOf(file, scope) {
  if (scope !== 'feature-library') return SCOPE_BARRELS[scope] ?? null;
  const lib = posix(file).match(FEATURE_LIBRARY_ROOT)?.[1];
  return {
    barrel: `libs/web/${lib}/src/index.ts`,
    re: FEATURE_LIBRARY_BARREL_RE,
  };
}

const MAX_JSX_LINES = 150;

const PASCAL_NAME = /^[A-Z][a-zA-Z0-9]*$/;

/**
 * Feature files that are allowed to violate the one-export-named-after-the-file
 * rule. Each entry is a decision: a repo-relative path and a written reason.
 * An entry without a reason, or one naming a file that is gone, is rejected
 * at startup — there is no silent exemption (GUIDELINES §2).
 */
const EXPORT_BASENAME_EXEMPTIONS = [];

// --- scope -------------------------------------------------------------------

function posix(file) {
  return path.normalize(file).replace(/\\/g, '/');
}

/**
 * Returns a scope name, or null when the file is out of scope.
 *
 * A Vault UI Component is its own scope rather than a Feature Component,
 * because it is both: reusable across routes and published through a barrel
 * like a primitive, while consuming primitives like a feature. Filing it under
 * either existing scope would silently drop half the rules that apply to it —
 * which is how this library went unchecked in the first place (#621 follow-up).
 * GUIDELINES §1 already described the category; only this checker did not.
 *
 * The scope is every `.tsx` in the library, which is deliberately wider than
 * the category GUIDELINES names. That section carves out `session`,
 * `vaultGate` and the runners as "not Vault UI Components" — but it does so to
 * say they do not need stories, which is a question about presentational
 * purity. Whether an effect cleans up after itself and whether an import goes
 * through the barrel are not questions about purity, and a 719-line gate is
 * the last file where they should go unasked.
 */
function scopeOf(file) {
  const p = posix(file);
  if (/\.(stories|test|spec)\.tsx?$/.test(p)) return null;
  if (p.includes('libs/web/ui/src/lib/components/')) return 'primitive';
  // `.tsx` only: this library keeps hooks and copy modules beside its
  // components in one flat directory, and a `.ts` hook reporting PASS as a
  // component is the same kind of false clean this scope was added to remove.
  if (/libs\/web\/vault-ui\/src\/lib\/[^/]+\.tsx$/.test(p)) return 'vault-ui';
  if (/libs\/web\/pages\/[^/]+\/src\//.test(p)) return 'feature';
  const lib = p.match(FEATURE_LIBRARY_ROOT)?.[1];
  if (lib && isFeatureLibrary(lib)) return 'feature-library';
  return null;
}

const featureLibraryCache = new Map();

/**
 * True when `libs/web/<lib>/project.json` carries both `type:feature` and
 * `scope:web`. Read relative to the working directory, like the barrels: every
 * mode runs from the repo root (`--staged` changes to it). A library with no
 * readable project.json is out of scope, which the "nothing was checked" exit
 * then reports, rather than a guess about what it is.
 *
 * Shared feature libraries are a Feature Library scope, not Feature
 * Components, for the reason Vault UI Components are not: they are reused
 * across routes and publish through a barrel, so filing them under `feature`
 * would drop the primitive half of the rules. `.tsx` only, for the same reason
 * as vault-ui — the form schemas and label helpers beside the components are
 * not components.
 */
function isFeatureLibrary(lib) {
  if (NAMED_WEB_LIBRARIES.has(lib)) return false;
  if (!featureLibraryCache.has(lib)) {
    let tags = [];
    try {
      const project = JSON.parse(
        readFileSync(`libs/web/${lib}/project.json`, 'utf8'),
      );
      tags = Array.isArray(project.tags) ? project.tags : [];
    } catch {
      tags = [];
    }
    featureLibraryCache.set(
      lib,
      tags.includes('type:feature') && tags.includes('scope:web'),
    );
  }
  return featureLibraryCache.get(lib);
}

function featureLibraryRoots() {
  let entries;
  try {
    entries = readdirSync('libs/web', { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && isFeatureLibrary(entry.name))
    .map((entry) => `libs/web/${entry.name}/src/lib`);
}

// --- primitive checks --------------------------------------------------------

/**
 * Every forwardRef component needs displayName — it is what React DevTools and
 * error stacks show, and a compound component with six sub-components has six
 * chances to miss one.
 */
function checkDisplayName(code, raw, findings) {
  const re =
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:React\s*\.\s*)?forwardRef\s*</g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const name = m[1];
    const assigned = new RegExp(`\\b${name}\\s*\\.\\s*displayName\\s*=`).test(
      code,
    );
    if (!assigned) {
      findings.push({
        level: 'error',
        rule: 'forwardref-displayname',
        line: lineOf(raw, m.index),
        message: `'${name}' uses forwardRef but never sets ${name}.displayName. GUIDELINES §4.1 — required for DevTools and error stacks.`,
      });
    }
  }
}

/**
 * Naive template concatenation cannot resolve Tailwind conflicts, so a consumer
 * override silently loses to the base class. Only flags the case where the
 * consumer's own `className` is being interpolated — that is the one that
 * actually breaks overriding.
 */
function checkClassNameMerge(_code, raw, findings) {
  const re = /className\s*=\s*\{\s*`[^`]*\$\{\s*className\s*\}/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    findings.push({
      level: 'error',
      rule: 'classname-not-cn',
      line: lineOf(raw, m.index),
      message:
        'className is built by template concatenation with the incoming className. GUIDELINES §4.2 — use cn() so tailwind-merge can resolve conflicts.',
    });
  }
}

/**
 * A primitive that is not in the barrel cannot be imported by a feature
 * component through @myorganiser/web-ui, which is the only import path
 * GUIDELINES §1 permits.
 */
function checkBarrelExport(file, scope, barrels, findings) {
  const spec = barrelSpecOf(file, scope);
  if (!spec) return;
  const barrelSource = barrels.get(spec.barrel);
  if (barrelSource == null) return;
  const match = posix(file).match(spec.re);
  if (!match) return;
  const specifier = `./${match[1]}`;
  if (!barrelSource.includes(specifier)) {
    findings.push({
      level: 'error',
      rule: 'missing-barrel-export',
      line: 1,
      message: `Not exported from ${spec.barrel}. GUIDELINES §4.6 — add "export * from '${specifier}';" in alphabetical order.`,
    });
  }
}

// --- feature checks ----------------------------------------------------------

/** Feature components must import primitives through the public entry point. */
function checkDeepImport(code, raw, findings) {
  const re = /\bfrom\s*(['"])([^'"]+)\1/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const spec = m[2];
    const deep =
      /web-ui\/src\//.test(spec) ||
      /web-vault-ui\/src\//.test(spec) ||
      /(^|\/)libs\/web\/ui\//.test(spec);
    if (deep) {
      findings.push({
        level: 'error',
        rule: 'deep-import',
        line: lineOf(raw, m.index),
        message: `Imports '${spec}' directly instead of '@myorganiser/web-ui'. GUIDELINES §1 — deep imports bypass the barrel and break Nx module boundaries.`,
      });
    }
  }
}

/**
 * True when `inner` (the contents of a JSX `{…}` handler prop) is an arrow
 * or function expression rather than a binding name.
 *
 * Depth-0 `=>` is what `#670` was about: the previous regex only captured
 * `onX={identifier}`, so `onX={() => { … }}` never became a finding.
 */
function isInlineFunctionExpr(inner) {
  const source = inner.trim();
  if (/^(?:async\s+)?function\b/.test(source)) return true;
  let depth = 0;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(' || ch === '{' || ch === '[') depth += 1;
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && ch === '=' && source[i + 1] === '>') {
      return true;
    }
  }
  return false;
}

/**
 * Expression body of an arrow, or null when the arrow has a block body or
 * the expression is a `function` keyword form. GUIDELINES §5.6's thin-wrapper
 * carve-out is only the expression-bodied form (`() => handleDelete(id)`).
 */
function arrowExpressionBody(inner) {
  const source = inner.trim().replace(/^async\s+/, '');
  if (/^function\b/.test(source)) return null;
  let depth = 0;
  let arrow = -1;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(' || ch === '{' || ch === '[') depth += 1;
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && ch === '=' && source[i + 1] === '>') {
      arrow = i;
      break;
    }
  }
  if (arrow === -1) return null;
  const body = source.slice(arrow + 2).trim();
  if (body.startsWith('{')) return null;
  return body;
}

const CALL_PREFIX = /^(?:void|await|return)\s+/;

/**
 * Root identifier of a single *identifier* call (`handleDelete(id)`,
 * `setOpen(true)`, `void onClose()`), or null when the body is anything
 * else — a member call (`e.preventDefault()`, `cloud.connect()`), `if`,
 * `&&`, a sequence. GUIDELINES §5.6's thin wrapper is a named callee, not
 * a method lookup.
 */
function singleCallRoot(expr) {
  const body = expr.trim().replace(CALL_PREFIX, '');
  const match = body.match(/^([A-Za-z_$][\w$]*)\s*\(/);
  if (!match) return null;
  const open = body.indexOf('(');
  const call = parenAfter(body, open);
  if (!call) return null;
  const rest = body
    .slice(open + call.length)
    .trim()
    .replace(/;$/, '');
  if (rest !== '') return null;
  return match[1];
}

/**
 * `onClick={() => handleDelete(id)}` where `handleDelete` is already a
 * useCallback (or is not a local function at all — a prop or a useState
 * setter). The wrapper still allocates each render; the carve-out exists
 * because hooks cannot be called inside `.map()` and because binding one
 * extra argument is the shape GUIDELINES §5.6 names as allowed.
 *
 * A local function that is *not* memoized is not a stable callee: wrapping
 * it in an arrow does not satisfy the rule.
 */
function isThinStableWrapper(inner, memoized, declared) {
  const expr = arrowExpressionBody(inner);
  if (expr == null) return false;
  const root = singleCallRoot(expr);
  if (root == null) return false;
  if (memoized.has(root)) return true;
  return !declared.has(root);
}

/**
 * A handler recreated every render defeats memoization in the child and, for
 * children in a list, re-renders the whole list. GUIDELINES §5.6 makes this
 * unconditional for real handler bodies; a documented thin wrapper that only
 * calls a stable callee with extra arguments is the one carve-out.
 *
 * The previous matcher only saw `onX={identifierName}`, so inline arrows
 * passed the check with no finding at all (#670).
 */
function checkHandlerCallbacks(code, raw, findings) {
  const memoized = new Set();
  const memoRe =
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:React\s*\.\s*)?useCallback\s*\(/g;
  let m;
  while ((m = memoRe.exec(code)) !== null) memoized.add(m[1]);

  const declared = new Map();
  const declRe =
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=;]*)?=>/g;
  while ((m = declRe.exec(code)) !== null) {
    if (!declared.has(m[1])) declared.set(m[1], lineOf(raw, m.index));
  }
  const fnRe = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
  while ((m = fnRe.exec(code)) !== null) {
    if (!declared.has(m[1])) declared.set(m[1], lineOf(raw, m.index));
  }

  const reportedNames = new Set();
  const propRe = /\bon[A-Z]\w*\s*=\s*/g;
  while ((m = propRe.exec(code)) !== null) {
    let cursor = m.index + m[0].length;
    while (cursor < code.length && /\s/.test(code[cursor])) cursor += 1;
    if (code[cursor] !== '{') continue;
    const exprBlock = blockAfter(code, cursor);
    if (!exprBlock || exprBlock.length < 2) continue;
    const inner = exprBlock.slice(1, -1).trim();
    if (!inner) continue;

    if (isInlineFunctionExpr(inner)) {
      if (isThinStableWrapper(inner, memoized, declared)) continue;
      findings.push({
        level: 'warn',
        rule: 'handler-not-memoized',
        line: lineOf(raw, m.index),
        message:
          'Inline function passed as a handler prop. GUIDELINES §5.6 — wrap the handler in useCallback. An expression-bodied call to a useCallback (or to a name not declared as a local function) is the documented thin-wrapper exception.',
      });
      continue;
    }

    const ident = inner.match(/^([A-Za-z_$][\w$]*)$/);
    if (!ident) continue;
    const name = ident[1];
    if (memoized.has(name)) continue;
    if (!declared.has(name)) continue; // a prop forwarded straight through
    if (reportedNames.has(name)) continue;
    reportedNames.add(name);
    findings.push({
      level: 'warn',
      rule: 'handler-not-memoized',
      line: lineOf(raw, m.index),
      message: `'${name}' is declared in this component (line ${declared.get(name)}) and passed as a prop, but is not wrapped in useCallback. GUIDELINES §5.6.`,
    });
  }
}

/** GUIDELINES §5.4 — props must be a named interface, not an inline type. */
function checkInlinePropsType(code, raw, findings) {
  const patterns = [
    // Destructured: `({ a }: { a: string }) => …` / `function X({ a }: { a: string }) {`
    /\}\s*:\s*\{[^{}]*\}\s*\)\s*(?::[^={]*)?\s*(?:=>|\{)/g,
    // Whole-object: `(props: { a: string })`
    /\(\s*props\s*:\s*\{[^{}]*\}\s*\)/g,
  ];
  const seen = new Set();
  for (const re of patterns) {
    let m;
    while ((m = re.exec(code)) !== null) {
      const line = lineOf(raw, m.index);
      if (seen.has(line)) continue;
      seen.add(line);
      findings.push({
        level: 'warn',
        rule: 'inline-props-type',
        line,
        message:
          'Props are annotated with an inline object type. GUIDELINES §5.4 — declare a named interface.',
      });
    }
  }
}

// --- checks that apply to both scopes ----------------------------------------

const LEAKY_SETUP =
  /\b(addEventListener|setInterval|setTimeout|requestAnimationFrame|subscribe|new\s+(?:ResizeObserver|MutationObserver|IntersectionObserver|WebSocket|AbortController|EventSource))\b/;

/**
 * A subscription or timer created in an effect without a teardown keeps firing
 * after unmount, against a component that no longer exists.
 */
function checkEffectCleanup(code, raw, findings) {
  const re = /\b(?:React\s*\.\s*)?useEffect\s*\(/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const body = parenAfter(code, m.index + 'useEffect'.length - 1);
    if (!body) continue;
    const setup = body.match(LEAKY_SETUP);
    if (!setup) continue;
    if (/\breturn\s*(?:\(\s*\)|\w+\s*=>|\(\s*\)\s*=>|function)/.test(body)) {
      continue;
    }
    findings.push({
      level: 'error',
      rule: 'effect-missing-cleanup',
      line: lineOf(raw, m.index),
      message: `useEffect calls ${setup[1]} but returns no cleanup function. It keeps running after unmount.`,
    });
  }
}

const GENERIC_NAMES = new Set([
  'Section',
  'Panel',
  'Container',
  'Wrapper',
  'Content',
  'Item',
]);

/** GUIDELINES §6 — a name that describes nothing cannot be found later. */
function checkGenericName(file, code, raw, findings) {
  const base = path.basename(posix(file)).replace(/\.tsx?$/, '');
  if (GENERIC_NAMES.has(base)) {
    findings.push({
      level: 'warn',
      rule: 'generic-name',
      line: 1,
      message: `'${base}' is a generic component name. GUIDELINES §6 — name it for the section or action it represents.`,
    });
  }
}

/**
 * Path helpers for the export/basename rule. kebab-case filenames map to
 * PascalCase exports (`task-add-dialog.tsx` → `TaskAddDialog`).
 */
function repoRelativePosix(file) {
  const p = posix(file);
  const marker = '/libs/';
  const idx = p.indexOf(marker);
  if (idx !== -1) return p.slice(idx + 1);
  return p;
}

function kebabToPascal(base) {
  return base
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function collectExportedComponents(code) {
  const names = new Set();
  const add = (name) => {
    if (name && PASCAL_NAME.test(name)) names.add(name);
  };

  const fnRe = /\bexport\s+(?:default\s+)?function\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = fnRe.exec(code)) !== null) add(m[1]);

  const constRe = /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=/g;
  while ((m = constRe.exec(code)) !== null) add(m[1]);

  const defaultRe = /\bexport\s+default\s+([A-Za-z_$][\w$]*)\b/g;
  while ((m = defaultRe.exec(code)) !== null) {
    if (m[1] !== 'function') add(m[1]);
  }

  const listRe = /\bexport\s+(type\s+)?\{([^}]+)\}/g;
  while ((m = listRe.exec(code)) !== null) {
    if (m[1]) continue;
    for (const spec of m[2].split(',')) {
      const trimmed = spec.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+as\s+/);
      add((parts[1] || parts[0]).trim());
    }
  }

  return names;
}

/**
 * A re-export barrel forwards another module's exports and declares nothing:
 * `export * from './TaskCard'`, `export { TaskCard } from './TaskCard'`. It has
 * no component to name, so the basename rule has nothing to say about it — and
 * `components/index.ts` is the shape the rule would otherwise demand be renamed
 * `Index`. A file that re-exports *and* declares an exported component is not a
 * barrel; it is a component file called index, and GUIDELINES §2 still applies.
 */
function isReExportBarrel(code) {
  const exports = code.match(/\bexport\b/g) ?? [];
  const reExports =
    code.match(
      /\bexport\s+(?:\*(?:\s+as\s+[A-Za-z_$][\w$]*)?|(?:type\s+)?\{[^}]*\})\s+from\b/g,
    ) ?? [];
  return reExports.length > 0 && reExports.length === exports.length;
}

function assertExportBasenameExemptions() {
  for (const entry of EXPORT_BASENAME_EXEMPTIONS) {
    if (!entry?.path || !String(entry.reason ?? '').trim()) {
      throw new Error(
        'EXPORT_BASENAME_EXEMPTIONS entry is missing a path or a written reason. ' +
          'An exemption without a reason is a hole, not a decision.',
      );
    }
    if (!existsSync(entry.path)) {
      throw new Error(
        `EXPORT_BASENAME_EXEMPTIONS names '${entry.path}' which does not exist. ` +
          'An exemption naming something that is gone is a hole nobody sees.',
      );
    }
  }
}

/**
 * GUIDELINES §2 / §6 — a Feature file under components/ exports exactly one
 * React component, named after the file (kebab-case → PascalCase). UI Primitives
 * and Vault UI Components keep a basename-matching compound root; prefixed
 * sub-exports may stay. Types, schemas, and camelCase helpers do not count.
 */
function checkExportBasename(file, scope, code, _raw, findings) {
  const rel = repoRelativePosix(file);
  if (EXPORT_BASENAME_EXEMPTIONS.some((entry) => entry.path === rel)) {
    return;
  }

  if (isReExportBarrel(code)) return;

  const p = posix(file);
  if (scope === 'feature' && !p.includes('/components/')) return;

  const base = path.basename(p).replace(/\.tsx?$/, '');
  const expected = kebabToPascal(base);
  const names = collectExportedComponents(code);
  const listed = [...names].sort().join(', ');

  if (scope === 'feature') {
    if (names.size === 1 && names.has(expected)) return;
    if (!names.has(expected)) {
      findings.push({
        level: 'error',
        rule: 'export-basename',
        line: 1,
        message:
          `Feature file '${path.basename(p)}' must export a React component ` +
          `named '${expected}'. GUIDELINES §2 — one exported component, named ` +
          `after the file. Found: ${listed || 'none'}.`,
      });
      return;
    }
    findings.push({
      level: 'error',
      rule: 'export-basename',
      line: 1,
      message:
        `Feature file '${path.basename(p)}' exports more than one React ` +
        `component (${listed}). GUIDELINES §2 — one exported component per file.`,
    });
    return;
  }

  // GUIDELINES §1 carves out `session`, `vaultGate`, and the runners as not
  // Vault UI Components. They stay in this library's hygiene scope for effect
  // cleanup and barrel rules, but their camelCase filenames are not a compound
  // root to match.
  if (!PASCAL_NAME.test(base)) return;

  if (!names.has(expected)) {
    findings.push({
      level: 'error',
      rule: 'export-basename',
      line: 1,
      message:
        `'${path.basename(p)}' must export a React component named '${expected}' ` +
        `(the compound root). GUIDELINES §3 — prefixed sub-exports may stay. ` +
        `Found: ${listed || 'none'}.`,
    });
  }
}

/**
 * GUIDELINES §2 lists "exceeds ~150 lines of JSX" as the primary split signal.
 * Measured on the largest returned expression rather than the whole file so
 * that hooks, schemas, and helpers above the return do not inflate it.
 */
function checkJsxSize(code, raw, findings) {
  const re = /\breturn\s*\(/g;
  let m;
  let largest = null;
  while ((m = re.exec(code)) !== null) {
    const block = parenAfter(code, m.index);
    if (!block) continue;
    const lines = block.split('\n').length;
    if (!largest || lines > largest.lines) {
      largest = { lines, index: m.index };
    }
  }
  if (largest && largest.lines > MAX_JSX_LINES) {
    findings.push({
      level: 'warn',
      rule: 'oversized-jsx',
      line: lineOf(raw, largest.index),
      message: `Returned JSX spans ${largest.lines} lines (limit ~${MAX_JSX_LINES}). GUIDELINES §2 — extract a card, dialog, list row, or section into its own file.`,
    });
  }
}

// --- driver ------------------------------------------------------------------

/**
 * Which rules each scope is checked against, stated per scope rather than
 * derived from an if/else.
 *
 * The previous shape was `if (primitive) … else …`, which meant a scope added
 * later inherited the feature rules by falling through — a default that reads
 * as a decision nobody made. Listing every scope means adding one is a
 * question somebody has to answer, and `assertScopesCovered` below makes an
 * unanswered one a hard failure instead of a quiet pass.
 *
 * Vault UI Components take both sets. They accept a `className` and merge it
 * like a primitive, they publish through a barrel like a primitive, and they
 * consume primitives through `@myorganiser/web-ui` like a feature. Feature
 * Library Components take both sets for the same reasons.
 */
const SCOPE_RULES = {
  primitive: ['displayName', 'classNameMerge', 'barrelExport'],
  feature: ['deepImport', 'handlerCallbacks', 'inlinePropsType'],
  'vault-ui': [
    'displayName',
    'classNameMerge',
    'barrelExport',
    'deepImport',
    'handlerCallbacks',
    'inlinePropsType',
  ],
  'feature-library': [
    'displayName',
    'classNameMerge',
    'barrelExport',
    'deepImport',
    'handlerCallbacks',
    'inlinePropsType',
  ],
};

/** Rules every scope is checked against, whatever else applies. */
const SHARED_RULES = [
  'effectCleanup',
  'genericName',
  'jsxSize',
  'exportBasename',
];

const RULES = {
  effectCleanup: ({ code, raw, findings }) =>
    checkEffectCleanup(code, raw, findings),
  genericName: ({ file, code, raw, findings }) =>
    checkGenericName(file, code, raw, findings),
  jsxSize: ({ code, raw, findings }) => checkJsxSize(code, raw, findings),
  exportBasename: ({ file, scope, code, raw, findings }) =>
    checkExportBasename(file, scope, code, raw, findings),
  displayName: ({ code, raw, findings }) =>
    checkDisplayName(code, raw, findings),
  classNameMerge: ({ code, raw, findings }) =>
    checkClassNameMerge(code, raw, findings),
  barrelExport: ({ file, scope, barrels, findings }) =>
    checkBarrelExport(file, scope, barrels, findings),
  deepImport: ({ code, raw, findings }) => checkDeepImport(code, raw, findings),
  handlerCallbacks: ({ code, raw, findings }) =>
    checkHandlerCallbacks(code, raw, findings),
  inlinePropsType: ({ code, raw, findings }) =>
    checkInlinePropsType(code, raw, findings),
};

/**
 * Every scope `scopeOf` can return must have a rule list, and every rule named
 * in one must exist. Checked at startup because the failure it prevents is a
 * file that reports PASS having been checked against nothing.
 */
function assertScopesCovered() {
  const scopes = ['primitive', 'feature', 'vault-ui', 'feature-library'];
  for (const scope of scopes) {
    if (!SCOPE_RULES[scope]) {
      throw new Error(
        `scopeOf can return '${scope}' but SCOPE_RULES has no entry for it. ` +
          'Add one saying which rules apply — a scope with no rules passes everything.',
      );
    }
  }
  for (const [scope, names] of Object.entries(SCOPE_RULES)) {
    for (const name of [...names, ...SHARED_RULES]) {
      if (!RULES[name]) {
        throw new Error(
          `SCOPE_RULES['${scope}'] names unknown rule '${name}'.`,
        );
      }
    }
  }
}

async function inspect(file, scope, barrels) {
  const rawFile = await fs.readFile(file, 'utf8');
  const raw = normalize(rawFile);
  const code = maskNonCode(raw);
  const findings = [];
  const context = { file, scope, barrels, code, raw, findings };

  for (const name of [...SHARED_RULES, ...SCOPE_RULES[scope]]) {
    RULES[name](context);
  }

  findings.sort((a, b) => a.line - b.line);
  return findings;
}

async function collectAll() {
  const roots = [
    'libs/web/ui/src/lib/components',
    'libs/web/vault-ui/src/lib',
    'libs/web/pages',
    ...featureLibraryRoots(),
  ];
  const out = [];
  const walk = async (dir) => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        await walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        // `.ts` as well as `.tsx`, because `scopeOf` is the authority on what is
        // in scope and it admits both: a Feature scope is every file under
        // `libs/web/pages/<route>/src/`, which is how `--staged` sees the `.ts`
        // hooks and policy modules beside the components. Collecting only
        // `.tsx` here made the verdict depend on how the checker was invoked —
        // a `components/index.ts` barrel failed pre-commit's `--staged` run and
        // was never collected by CI's `--all` run, so editing it blocked a
        // commit while the repo-wide gate stayed green. Out-of-scope files are
        // still filtered by `scopeOf` in main(), exactly as `.test.tsx` is.
        out.push(full);
      }
    }
  };
  for (const root of roots) await walk(root);
  return out.sort();
}

function collectStaged() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const output = execFileSync(
    'git',
    ['diff', '--cached', '--name-status', '--diff-filter=ACDMRT', '-z'],
    { cwd: root, encoding: 'utf8' },
  );
  process.chdir(root);

  const records = output.split('\0');
  const files = [];
  for (let index = 0; index < records.length; ) {
    const status = records[index++];
    if (!status) continue;

    const source = records[index++];
    if (!source) break;
    if (status.startsWith('R') || status.startsWith('C')) {
      const destination = records[index++];
      if (destination && scopeOf(destination)) files.push(destination);
    } else if (status !== 'D' && scopeOf(source)) {
      files.push(source);
    }
  }
  return files.sort();
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE);
    return;
  }

  const json = argv.includes('--json');
  const all = argv.includes('--all');
  const staged = argv.includes('--staged');
  const strictWarnings = argv.includes('--max-warnings=0');
  const validFlags = new Set([
    '--json',
    '--all',
    '--staged',
    '--max-warnings=0',
  ]);
  const unknownFlags = argv.filter(
    (argument) => argument.startsWith('--') && !validFlags.has(argument),
  );
  const explicitFiles = argv.filter((argument) => !argument.startsWith('--'));
  if (
    unknownFlags.length ||
    (all && staged) ||
    ((all || staged) && explicitFiles.length)
  ) {
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }

  let files = explicitFiles;

  if (all) files = await collectAll();
  assertScopesCovered();
  assertExportBasenameExemptions();

  if (staged) files = collectStaged();
  if (!files.length) {
    if (staged) {
      if (json) {
        process.stdout.write(
          `${JSON.stringify({ errors: 0, warnings: 0, results: [] }, null, 2)}\n`,
        );
      } else {
        process.stdout.write('No staged component files to check.\n');
      }
      return;
    }
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }

  // Barrel unreadable (wrong cwd, partial checkout) — skip that rule rather
  // than accuse every component of being unexported.
  const barrels = new Map();
  const barrelPaths = files
    .map((file) => {
      const scope = scopeOf(file);
      return scope ? barrelSpecOf(file, scope)?.barrel : undefined;
    })
    .filter(Boolean);
  for (const barrel of barrelPaths) {
    if (barrels.has(barrel)) continue;
    try {
      barrels.set(barrel, await fs.readFile(barrel, 'utf8'));
    } catch {
      barrels.set(barrel, null);
    }
  }

  const results = [];
  let errors = 0;
  let warnings = 0;
  let inspected = 0;
  let skipped = 0;

  for (const file of files) {
    const scope = scopeOf(file);
    if (!scope) {
      skipped += 1;
      results.push({
        file,
        skipped:
          'not a UI Primitive, Vault UI Component, Feature Library Component, or Feature Component',
        findings: [],
      });
      continue;
    }
    inspected += 1;
    let findings;
    try {
      findings = await inspect(file, scope, barrels);
    } catch (error) {
      findings = [
        {
          level: 'error',
          rule: 'unreadable',
          line: 1,
          message: error?.message ?? String(error),
        },
      ];
    }
    errors += findings.filter((f) => f.level === 'error').length;
    warnings += findings.filter((f) => f.level === 'warn').length;
    results.push({ file, scope, findings });
  }

  if (json) {
    process.stdout.write(
      `${JSON.stringify({ errors, warnings, results }, null, 2)}\n`,
    );
  } else {
    reportFindings(results, 'Component hygiene');
  }

  // A run that inspected nothing is almost always an invocation mistake, and
  // it is the exact failure this checker was found to have: every file fell
  // out of scope, the per-file SKIPPED lines scrolled past, and the summary
  // read "0 error(s), 0 warning(s)" — indistinguishable from a clean pass
  // (#290). The summary line already says so; so must the exit code, because
  // callers branch on the exit code and agents quote the last line.
  //
  // A mixed run is untouched: it exits on the merits of what it did check,
  // because there a skip is the scope filter working rather than a mistake.
  // `--staged` never reaches here with zero inspected files — it filters by
  // scope while selecting, and an empty selection returns above with 0, since
  // "no components staged" is a legitimate state, not a bad invocation.
  //
  // The message goes to stderr rather than into the JSON, whose top-level
  // keys are a published contract; a JSON consumer already sees every result
  // carrying `skipped`.
  //
  // Both conjuncts are load-bearing. `inspected === 0` alone is exact today,
  // because an empty file list already returned above and every file then
  // increments exactly one of the two counters — but if that early return ever
  // moves, `skipped > 0` is what stops this branch from firing on no input at
  // all and reporting "all 0 file(s) were out of scope".
  if (inspected === 0 && skipped > 0) {
    process.stderr.write(
      `Component hygiene: nothing was checked — all ${skipped} file(s) were out of scope. ` +
        'This is not a pass. Point the checker at a UI Primitive ' +
        '(libs/web/ui/src/lib/components/), a Vault UI Component ' +
        '(libs/web/vault-ui/src/lib/), a Feature Library Component ' +
        '(libs/web/<lib>/src/lib/ of a library tagged type:feature + scope:web), ' +
        'or a Feature Component ' +
        '(libs/web/pages/<route>/src/) — see docs/ui/GUIDELINES.md §1.\n',
    );
    process.exitCode = 1;
    return;
  }

  process.exitCode = errors > 0 || (strictWarnings && warnings > 0) ? 1 : 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
