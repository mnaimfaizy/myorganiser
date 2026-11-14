// Contracts for the Storyboard page's design tokens (PRD #1544), exercised
// through storyboard-palette.ts's exports. The first test reads the real
// generated stylesheets on purpose; the others use CSS text or a temporary
// repository root. Nothing here starts a browser.
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  TOKEN_STYLESHEETS,
  missingVariables,
  readTokenCss,
} from './storyboard-palette.ts';

/** tools/qa/lib/ is three levels below the repository root. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('readTokenCss: the real generated stylesheets', () => {
  test('returns the stylesheets text, declaring every variable the page uses', () => {
    const css = readTokenCss(REPO_ROOT);
    assert.equal(typeof css, 'string');
    assert.deepEqual(missingVariables(css), []);
  });
});

describe('missingVariables', () => {
  test('lists exactly the variable the real text no longer declares when its --navy declaration is removed', () => {
    const css = readTokenCss(REPO_ROOT).replaceAll(/--navy:[^;]*;/g, '');
    assert.deepEqual(missingVariables(css), ['navy']);
  });

  test('counts a variable that is only used, never declared, as missing', () => {
    assert.deepEqual(missingVariables('.label{color: var(--navy)}', ['navy']), [
      'navy',
    ]);
  });

  test('checks only the custom list it is given, and a prefix of a declared name is not a match', () => {
    assert.deepEqual(
      missingVariables(':root{--a: 1; --b: 2; --ab: 3}', ['a', 'c', 'b']),
      ['c'],
    );
    assert.deepEqual(missingVariables(':root{--ab: 3}', ['a']), ['a']);
  });
});

describe('readTokenCss: a repository root that does not declare a variable', () => {
  test('throws an Error naming the missing variable, and removes its temporary root', () => {
    const root = mkdtempSync(join(tmpdir(), 'storyboard-palette-'));
    try {
      for (const path of TOKEN_STYLESHEETS) {
        const text = readFileSync(join(REPO_ROOT, path), 'utf8');
        const target = join(root, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(
          target,
          path.endsWith('tokens.css')
            ? text.replaceAll(/--font-body:[^;]*;/g, '')
            : text,
        );
      }
      assert.throws(
        () => readTokenCss(root),
        (error: unknown) =>
          error instanceof Error &&
          /do not declare --font-body, which the Storyboard page uses/.test(
            error.message,
          ),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    assert.equal(existsSync(root), false, 'the temporary root is removed');
  });
});
