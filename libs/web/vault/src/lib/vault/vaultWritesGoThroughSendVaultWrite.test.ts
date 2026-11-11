import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import * as ts from 'typescript';

/**
 * Guard for #1489: every `putVaultMeta` / `putVaultBlob` use in the library
 * must sit inside a `sendVaultWrite(` call. A PUT sent around it lets a read
 * issued after the write join a request sent before it.
 *
 * Scope: `libs/web/vault/src` only. Mobile (`libs/mobile/feat/vault/src/sync.ts`)
 * builds no shared-read wrapper, so it has nothing to forget.
 *
 * Matching rule, on the TypeScript AST (`ts.createSourceFile`), so a comment or
 * a string can never count as a wrap:
 * - Flagged: every property access named `putVaultMeta` or `putVaultBlob`, every
 *   element access with that string literal, and every destructuring binding of
 *   either name.
 * - Passes only when the use is a property access that is the direct callee of
 *   a call, and that call sits in the argument list of a call whose callee is
 *   the identifier `sendVaultWrite`. A `.call(...)`, an alias, or the bracket
 *   form fails. Write the call with a dot so the guard can see it.
 * - Not flagged: type positions (a `'putVaultMeta'` in a `Pick<>` union) and
 *   property-assignment keys (the wrapper's own `putVaultMeta: (…) =>`). Neither
 *   is a property access, element access, or binding.
 */

const PUT_NAMES = new Set(['putVaultMeta', 'putVaultBlob']);

type PutUse = {
  file: string;
  line: number;
  /** A property access that is the direct callee of a call. */
  isCallee: boolean;
  /** Inside the argument list of a `sendVaultWrite(` call. */
  wrapped: boolean;
};

function isPutName(name: string | undefined): boolean {
  return name !== undefined && PUT_NAMES.has(name);
}

/** Whether `node` sits in the argument list of a `sendVaultWrite(` call. */
function insideSendVaultWrite(node: ts.Node): boolean {
  let child: ts.Node = node;
  let parent: ts.Node | undefined = node.parent;
  while (parent) {
    if (
      ts.isCallExpression(parent) &&
      ts.isIdentifier(parent.expression) &&
      parent.expression.text === 'sendVaultWrite' &&
      parent.arguments.some((argument) => argument === child)
    ) {
      return true;
    }
    child = parent;
    parent = parent.parent;
  }
  return false;
}

function scanSource(file: string, text: string): PutUse[] {
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const uses: PutUse[] = [];

  const record = (node: ts.Node, isCallee: boolean) => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    uses.push({
      file,
      line: line + 1,
      isCallee,
      wrapped: isCallee && insideSendVaultWrite(node),
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && isPutName(node.name.text)) {
      const isCallee =
        ts.isCallExpression(node.parent) && node.parent.expression === node;
      record(node, isCallee);
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      isPutName(node.argumentExpression.text)
    ) {
      record(node, false);
    } else if (
      ts.isBindingElement(node) &&
      (isPutName(
        node.propertyName && ts.isIdentifier(node.propertyName)
          ? node.propertyName.text
          : undefined,
      ) ||
        (ts.isIdentifier(node.name) && isPutName(node.name.text)))
    ) {
      record(node, false);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return uses;
}

function nonTestTypeScriptFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return nonTestTypeScriptFiles(path);
    const isTest = /\.(test|spec|testutil)\.ts$|\.d\.ts$/.test(entry);
    return entry.endsWith('.ts') && !isTest ? [path] : [];
  });
}

const SRC_ROOT = join(__dirname, '..', '..');

function scanLibrary(): PutUse[] {
  return nonTestTypeScriptFiles(SRC_ROOT).flatMap((path) =>
    scanSource(relative(SRC_ROOT, path), readFileSync(path, 'utf8')),
  );
}

describe('putVaultMeta and putVaultBlob uses in the library', () => {
  it('should find the known put call sites when it scans the library sources', () => {
    const calls = scanLibrary().filter((use) => use.isCallee);
    const count = (file: string) =>
      calls.filter((use) => use.file === join('lib', 'vault', file)).length;

    // serverVaultSync.ts: two per put helper (first PUT and 409 retry) and the
    // wrapper's own two pass-throughs. vaultConverge.ts: the push's send().
    expect(count('serverVaultSync.ts')).toBeGreaterThanOrEqual(6);
    expect(count('vaultConverge.ts')).toBeGreaterThanOrEqual(1);
  });

  it('should report no put use outside a sendVaultWrite call when it scans the library sources', () => {
    const uncovered = scanLibrary().filter((use) => !use.wrapped);

    expect(uncovered.map((use) => `${use.file}:${use.line}`)).toEqual([]);
  });

  it('should flag every bypass probe and accept a wrapped call when it scans inline sources', () => {
    // Each probe holds exactly one unwrapped use, which the checker must flag.
    const bypassProbes: Array<{ probe: string; source: string }> = [
      {
        probe: 'a comment naming sendVaultWrite before a bare call',
        source:
          '// sendVaultWrite(() => api.putVaultMeta({}))\napi.putVaultMeta({});',
      },
      {
        probe: 'a JSDoc naming sendVaultWrite before a bare call',
        source:
          '/** sendVaultWrite(() => api.putVaultBlob({})) */\napi.putVaultBlob({});',
      },
      {
        probe: 'a string literal naming sendVaultWrite',
        source: 'const hint = "use sendVaultWrite(";\napi.putVaultMeta({});',
      },
      {
        probe: 'an alias of the method',
        source: 'const put = api.putVaultMeta;\nput({});',
      },
      {
        probe: 'the bracket form',
        source: 'api["putVaultMeta"]({});',
      },
      {
        probe: 'a destructured method',
        source: 'const { putVaultBlob } = api;\nputVaultBlob({});',
      },
      {
        probe: '.call on the method',
        source: 'api.putVaultMeta.call(api, {});',
      },
    ];

    for (const { probe, source } of bypassProbes) {
      const unwrapped = scanSource('probe.ts', source).filter(
        (use) => !use.wrapped,
      );
      expect({ probe, unwrapped: unwrapped.length }).toEqual({
        probe,
        unwrapped: 1,
      });
    }

    // The accepted shape: a direct call inside sendVaultWrite's arguments.
    const wrapped = scanSource(
      'probe.ts',
      'const response = await sendVaultWrite(() => api.putVaultMeta({ putVaultMetaRequest }));',
    );
    expect(wrapped.map((use) => use.wrapped)).toEqual([true]);

    // Type positions and property-assignment keys are never uses.
    const ignored = scanSource(
      'probe.ts',
      "type Writes = Pick<VaultApi, 'putVaultMeta' | 'putVaultBlob'>;\nconst wrapper = { putVaultMeta: () => 1 };",
    );
    expect(ignored).toEqual([]);
  });
});
