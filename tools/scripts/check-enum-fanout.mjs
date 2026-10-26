#!/usr/bin/env node
// Fails a scope that fans out over a guarded domain enum by hand instead of
// reaching the pinned table for it (ADR 0053).
//
//   node tools/scripts/check-enum-fanout.mjs [--print]
//
// TypeScript already catches the omission this exists to prevent — but only at
// call sites written to be caught. `satisfies Record<VaultBlobType, ...>` fails
// to compile when a seventh member appears; an object literal typed
// `Partial<Record<VaultBlobType, ...>>`, an if-chain over `key === VaultBlobType.X`,
// and a hand-written union of the member values all compile fine while covering
// five of six. Issue #512 lost grocery ciphertext that way, and the hardened
// export path was found dropping the Tasks blob the same way (#537).
//
// The corpus is parsed with the TypeScript parser rather than scanned with
// regexes, for two reasons a text scan got wrong:
//
//   1. **Findings are scope-local.** A file that iterates the table in one
//      function and hand-enumerates in another is a finding. A text scan can
//      only ask whether the table is named *somewhere* in the file, which
//      exempts exactly the files most likely to be wrong — `vaultExportImport.ts`
//      imports the table at the top and still omitted Tasks below it.
//   2. **Comments and strings are not code.** A comment naming the table, or a
//      JSDoc block quoting the rule, laundered a file under a text scan.
//
// No type-checker or program is built: this is a syntax-only parse, so it costs
// a few milliseconds per file and needs no tsconfig resolution.
//
// Exit 0 = every fan-out is pinned. Exit 1 = an unpinned fan-out. Exit 2 = the
// check could not run.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { GUARDED_ENUMS } from './lib/enum-fanout-guarded.ts';

const require = createRequire(import.meta.url);
const cwd = process.cwd();
const printOnly = process.argv.includes('--print');

const fail = (msg) => {
  console.error(`enum-fanout: ${msg}`);
  process.exit(2);
};

let ts;
try {
  ts = require('typescript');
} catch {
  fail('the typescript package is required to parse the corpus');
}

/**
 * How many distinct members make a scope a fan-out.
 *
 * Two is enough when the scope names the enum itself: `VaultBlobType.Tasks`
 * alone is a point use, but two of them is an enumeration. Bare member values
 * need three, because inside the value roots `.tasks` and `.subscriptions` are
 * also ordinary English property names and a pair of them can co-occur by
 * accident. Every real fan-out covers the whole set, so three costs no
 * coverage: the five-of-six omissions this check exists for all clear it.
 */
const QUALIFIED_THRESHOLD = 2;
const VALUE_THRESHOLD = 3;

/** Source files the rule applies to: tracked TypeScript that is not a test and not generated. */
function guardedSources() {
  let tracked;
  try {
    tracked = execFileSync('git', ['ls-files', '-z', '*.ts', '*.tsx'], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    fail(`could not list tracked files: ${error.message}`);
  }
  return tracked
    .split('\0')
    .filter(Boolean)
    .filter((path) => !/\.(test|spec)\.tsx?$/.test(path))
    .filter((path) => !path.startsWith('libs/app-api-client/'))
    .filter((path) => !path.startsWith('libs/api-specs/'));
}

/** Every member the guarded enum's const-object declares, read from source. */
function readMembers(guard) {
  const path = join(cwd, guard.definedIn);
  if (!existsSync(path)) fail(`${guard.definedIn} not found`);
  const source = readFileSync(path, 'utf8');
  const start = source.indexOf(`export const ${guard.enum} = {`);
  if (start === -1) {
    fail(
      `${guard.enum} is no longer declared as a const object in ${guard.definedIn}. ` +
        'Point the guard at wherever its members moved.',
    );
  }
  const end = source.indexOf('} as const;', start);
  if (end === -1) {
    fail(`${guard.enum} declaration in ${guard.definedIn} is unterminated`);
  }
  const members = [
    ...source.slice(start, end).matchAll(/^\s{4}(\w+)\s*:\s*'([^']+)'/gm),
  ].map((match) => ({ name: match[1], value: match[2] }));
  if (members.length === 0) fail(`${guard.enum} declares no members`);
  return members;
}

const parse = (path, text) =>
  ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

/** Does this type node mention `Record<Enum, ...>`? That is the pin. */
function isPinType(node, enumName) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (
      ts.isTypeReferenceNode(n) &&
      n.typeName.getText() === 'Record' &&
      n.typeArguments?.[0]?.getText().trim() === enumName
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** A node is pinned when it, or an enclosing expression, carries a pin type. */
function isPinned(node, enumName) {
  for (let n = node; n; n = n.parent) {
    if (
      (ts.isSatisfiesExpression(n) || ts.isAsExpression(n)) &&
      isPinType(n.type, enumName)
    ) {
      return true;
    }
    if (ts.isVariableDeclaration(n) && n.type && isPinType(n.type, enumName)) {
      return true;
    }
    if (ts.isFunctionLike(n)) break;
  }
  return false;
}

/**
 * The scopes a fan-out is judged in: every function-like declaration, plus each
 * top-level statement that is not one. Judging per scope rather than per file
 * is the point — a file may iterate the table in one function and still
 * hand-enumerate in the next.
 */
function scopesOf(sourceFile) {
  const scopes = [];
  const moduleStatements = [];

  const visit = (node) => {
    if (ts.isFunctionLike(node) && node.body) {
      scopes.push({ node, name: scopeName(node) });
      ts.forEachChild(node.body, visit);
      return;
    }
    ts.forEachChild(node, visit);
  };

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionLike(statement) && statement.body) {
      scopes.push({ node: statement, name: scopeName(statement) });
      ts.forEachChild(statement.body, visit);
    } else {
      moduleStatements.push(statement);
      visit(statement);
    }
  }

  // Every top-level statement that is not a function is judged as one scope.
  // A fan-out written as a run of sibling `if`s — which is what
  // `envelopeFromLocalVault` was — spreads across several statements, and
  // scoring each one alone would put every member below the threshold.
  if (moduleStatements.length > 0) {
    scopes.push({
      node: sourceFile,
      name: '(module scope)',
      only: moduleStatements,
    });
  }
  return scopes;
}

function scopeName(node) {
  if (node.name?.getText) return node.name.getText();
  for (let n = node; n; n = n.parent) {
    if (ts.isVariableDeclaration(n) && n.name?.getText) return n.name.getText();
    if (ts.isTypeAliasDeclaration(n) && n.name?.getText) {
      return n.name.getText();
    }
  }
  return '(module scope)';
}

/**
 * Members a scope names, and whether it reaches the pinned table. Nested
 * function bodies are excluded so an inner scope's work is not attributed to
 * its parent — each is judged on its own.
 */
function inspectScope(scope, guard, members, useValues) {
  const qualified = new Set();
  const values = new Set();
  const unpinned = new Set();
  let reaches = false;

  const valueOf = new Map(members.map((m) => [m.value, m.name]));
  const nameOf = new Set(members.map((m) => m.name));

  const visit = (node, isRoot) => {
    if (!isRoot && ts.isFunctionLike(node) && node.body) return;

    if (ts.isIdentifier(node) && guard.reach.includes(node.text)) {
      reaches = true;
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === guard.enum &&
      nameOf.has(node.name.text)
    ) {
      qualified.add(node.name.text);
      if (!isPinned(node, guard.enum)) unpinned.add(node.name.text);
    }

    if (useValues) {
      // A member value used as an object-literal key, a property name, or a
      // string literal in a union — the three shapes a fan-out written without
      // the enum takes.
      let value;
      if (
        (ts.isPropertyAssignment(node) ||
          ts.isPropertySignature(node) ||
          ts.isShorthandPropertyAssignment(node)) &&
        node.name &&
        (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
      ) {
        value = node.name.text;
      } else if (ts.isPropertyAccessExpression(node)) {
        value = node.name.text;
      } else if (
        ts.isStringLiteral(node) &&
        (ts.isLiteralTypeNode(node.parent) ||
          ts.isArrayLiteralExpression(node.parent) ||
          ts.isElementAccessExpression(node.parent))
      ) {
        value = node.text;
      }
      if (value && valueOf.has(value)) {
        values.add(valueOf.get(value));
        if (!isPinned(node, guard.enum)) unpinned.add(valueOf.get(value));
      }
    }

    ts.forEachChild(node, (child) => visit(child, false));
  };

  if (scope.only) {
    for (const statement of scope.only) visit(statement, false);
  } else {
    visit(scope.node, true);
  }
  return { qualified, values, unpinned, reaches };
}

const findings = [];

for (const guard of GUARDED_ENUMS) {
  const members = readMembers(guard);
  const pinPath = join(cwd, guard.pin);
  if (!existsSync(pinPath)) {
    fail(`${guard.enum}: pinned table ${guard.pin} not found`);
  }
  const pinFile = parse(guard.pin, readFileSync(pinPath, 'utf8'));
  let pinFound = false;
  const findPin = (node) => {
    if (
      (ts.isSatisfiesExpression(node) || ts.isAsExpression(node)) &&
      isPinType(node.type, guard.enum)
    ) {
      pinFound = true;
    }
    ts.forEachChild(node, findPin);
  };
  findPin(pinFile);
  if (!pinFound) {
    findings.push(
      `${guard.pin}: no \`satisfies Record<${guard.enum}, ...>\` clause. ` +
        'The pinned table is what makes every other call site safe; without it ' +
        'nothing fails when a member is added.',
    );
  }

  if (printOnly) {
    console.log(
      `${guard.enum}: ${members.length} members ` +
        `(${members.map((m) => m.name).join(', ')})`,
    );
    console.log(`  pinned by ${guard.pin}`);
    console.log(
      `  value roots: ${(guard.valueRoots ?? []).join(', ') || 'none'}`,
    );
    for (const site of guard.declarationSites ?? []) {
      console.log(`  declares (exempt): ${site.path}`);
    }
  }

  const declared = new Map(
    (guard.declarationSites ?? []).map((site) => [site.path, site.reason]),
  );
  for (const [path, reason] of declared) {
    if (!existsSync(join(cwd, path))) {
      fail(
        `${guard.enum}: declaration site ${path} does not exist. ` +
          'An exemption naming something that is gone is a hole nobody sees.',
      );
    }
    if (!reason || !reason.trim()) {
      fail(`${guard.enum}: declaration site ${path} carries no reason`);
    }
  }

  const sources = guardedSources();
  for (const path of sources) {
    if (path === guard.pin) continue;
    if (declared.has(path)) continue;
    const text = readFileSync(join(cwd, path), 'utf8');
    // Cheap pre-filter: a file mentioning neither the enum nor any member value
    // cannot contain a fan-out, and parsing every tracked file would dominate
    // the runtime.
    const useValues = (guard.valueRoots ?? []).some((root) =>
      path.startsWith(root),
    );
    if (!text.includes(guard.enum) && !useValues) continue;

    let sourceFile;
    try {
      sourceFile = parse(path, text);
    } catch (error) {
      fail(`could not parse ${path}: ${error.message}`);
    }

    for (const scope of scopesOf(sourceFile)) {
      const { qualified, values, unpinned, reaches } = inspectScope(
        scope,
        guard,
        members,
        useValues,
      );
      if (reaches) continue;

      const named = new Set([...qualified, ...values]);
      const overQualified = qualified.size >= QUALIFIED_THRESHOLD;
      const overValues = named.size >= VALUE_THRESHOLD;
      if (!overQualified && !overValues) continue;
      if (unpinned.size === 0) continue;

      const anchor = scope.only ? scope.only[0] : scope.node;
      const line =
        sourceFile.getLineAndCharacterOfPosition(anchor.getStart(sourceFile))
          .line + 1;
      findings.push(
        `${path}:${line} (${scope.name}): names ${named.size} of ` +
          `${members.length} ${guard.enum} members ` +
          `(${[...named].sort().join(', ')}) without reaching the pinned table.\n` +
          `      A hand-enumerated fan-out compiles fine while handling some ` +
          `members and not others, and ${guard.why}.\n` +
          `      Iterate ${guard.reach[0]} from ${guard.pin}, or pin this site ` +
          `with its own \`satisfies Record<${guard.enum}, ...>\` clause (ADR 0053).`,
      );
    }
  }
}

if (findings.length > 0) {
  console.error('enum-fanout: unpinned fan-out over a guarded enum\n');
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}

console.log(
  `enum-fanout: OK — ${GUARDED_ENUMS.length} guarded enum(s), every fan-out pinned`,
);
