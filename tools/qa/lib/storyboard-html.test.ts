// Contracts for the Storyboard page's HTML (PRD #1544), exercised through
// storyboard-html.ts's `storyboardHtml` on a model built by `buildStoryboard`.
// Pure: nothing here starts a browser or touches disk.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { StepRecord } from './qa-scenario.ts';
import type { Side } from './qa-stack.ts';
import { storyboardHtml } from './storyboard-html.ts';
import { type StoryboardSideInput, buildStoryboard } from './storyboard.ts';

const COMMITS = { before: 'a'.repeat(40), after: 'b'.repeat(40) };
/** A token stylesheet with no hex colour, so the no-hex check reads the page alone. */
const TOKENS = ':root{--font-body:sans-serif;--navy:222 47% 11%}';
const stillUrl = (step: StepRecord): string => `file:///out/${step.still}`;

const countOf = (text: string, needle: string): number =>
  text.split(needle).length - 1;

/** The `name: value` pairs in a CSS rule set or a style attribute. */
function declarationsIn(text: string): { name: string; value: string }[] {
  return [...text.matchAll(/([a-z-]+)\s*:\s*([^;}"]+)/g)].map(
    ([, name, value]) => ({ name, value: value.trim() }),
  );
}

function step(
  side: Side,
  index: number,
  caption = `step ${index}`,
): StepRecord {
  return {
    side,
    index,
    device: 'Desktop',
    tab: '',
    label: 'Device Desktop',
    caption,
    still: `steps/S1/${side}/${String(index).padStart(2, '0')}.png`,
    subject: null,
    atMs: 0,
  };
}

function page(
  sides: Partial<Record<Side, StoryboardSideInput>>,
  tokenCss = TOKENS,
  title = 'Save an item',
): string {
  return storyboardHtml(
    buildStoryboard({
      id: 'S1',
      title,
      expected: { before: 'the defect shows', after: 'the fix shows' },
      result: 'PASS',
      commits: COMMITS,
      sides,
    }),
    stillUrl,
    tokenCss,
  );
}

describe('storyboardHtml', () => {
  test('the title, captions, expected and observed text are HTML-escaped', () => {
    const html = page(
      {
        before: {
          outcome: 'fail',
          message: 'the defect shows here',
          steps: [step('before', 1, '<b>x</b>')],
        },
        after: {
          outcome: 'pass',
          observed: '<s>o</s>',
          steps: [step('after', 1, '<b>x</b>')],
        },
      },
      TOKENS,
      '<i>T</i>',
    );
    for (const escaped of [
      '&lt;i&gt;T&lt;/i&gt;',
      '&lt;b&gt;x&lt;/b&gt;',
      '&lt;s&gt;o&lt;/s&gt;',
    ]) {
      assert.ok(html.includes(escaped), escaped);
    }
    for (const raw of ['<i>T</i>', '<b>x</b>', '<s>o</s>']) {
      assert.equal(html.includes(raw), false, raw);
    }
  });

  test('a side with no step at a row shows "no step on <SIDE>", never a blank cell', () => {
    const html = page({
      before: {
        outcome: 'fail',
        message: 'the defect shows here',
        steps: [step('before', 1)],
      },
      after: {
        outcome: 'pass',
        observed: 'the fix shows here',
        steps: [step('after', 1), step('after', 2)],
      },
    });
    assert.ok(html.includes('no step on BEFORE'));
    assert.equal(html.includes('no step on AFTER'), false);
  });

  test('the token CSS is inlined, and a "</" in it cannot close the style element', () => {
    const tokens =
      ':root{--font-body:sans-serif}</style><script>alert(1)</script>';
    const html = page(
      {
        before: {
          outcome: 'fail',
          message: 'the defect shows here',
          steps: [step('before', 1)],
        },
        after: {
          outcome: 'pass',
          observed: 'the fix shows here',
          steps: [step('after', 1)],
        },
      },
      tokens,
    );
    assert.ok(
      html.includes(
        ':root{--font-body:sans-serif}<\\/style><script>alert(1)<\\/script>',
      ),
    );
    assert.equal(html.includes('</style><script>'), false);
  });

  test('the page has no hex colour outside the inlined token CSS', () => {
    const html = page({
      before: {
        outcome: 'fail',
        message: 'the defect shows here',
        steps: [step('before', 1)],
      },
      after: {
        outcome: 'pass',
        observed: 'the fix shows here',
        steps: [step('after', 1)],
      },
    });
    assert.ok(html.includes(TOKENS), 'the token CSS is inlined');
    assert.doesNotMatch(html.replace(TOKENS, ''), /#[0-9a-fA-F]{3,8}\b/);
  });

  test('every colour outside the inlined token CSS is a var(--…) reference', () => {
    const html = page({
      before: {
        outcome: 'fail',
        message: 'the defect shows here',
        steps: [step('before', 1)],
      },
      // A second After step leaves Before with no step: the dashed "no step" cell.
      after: {
        outcome: 'pass',
        observed: 'the fix shows here',
        steps: [step('after', 1), step('after', 2)],
      },
    }).replace(TOKENS, '');

    const declared = [
      ...html.matchAll(/<style>([\s\S]*?)<\/style>/g),
      ...html.matchAll(/style="([^"]*)"/g),
    ].flatMap(([, text]) => declarationsIn(text));
    const colourBearing = declared.filter(({ name }) =>
      /^(color|background|background-color|border(-[a-z]+)?)$/.test(name),
    );
    assert.ok(colourBearing.length > 10, 'the page declares colours to check');

    const literal = colourBearing.filter(({ value }) =>
      value
        .split(/\s+/)
        .some(
          (token) =>
            /^(#|rgba?\(|hsla?\()/.test(token) && !token.includes('var(--'),
        ),
    );
    assert.deepEqual(literal, []);
  });

  test("a cell whose caption differs from its row's caption shows its own caption", () => {
    const html = page({
      before: {
        outcome: 'fail',
        message: 'the defect shows here',
        steps: [step('before', 1, 'the before caption')],
      },
      after: {
        outcome: 'pass',
        observed: 'the fix shows here',
        steps: [step('after', 1, 'the after caption')],
      },
    });
    assert.ok(
      html.includes('<div class="cell-caption">the before caption</div>'),
    );
    // The After cell's caption is the row's caption, so it is not repeated.
    assert.equal(countOf(html, 'class="cell-caption"'), 1);
    assert.equal(
      html.includes('<div class="cell-caption">the after caption</div>'),
      false,
    );
  });

  test('only the last row carries the checked class and the "checked here" text', () => {
    const html = page({
      before: {
        outcome: 'fail',
        message: 'the defect shows here',
        steps: [step('before', 1), step('before', 2), step('before', 3)],
      },
      after: {
        outcome: 'pass',
        observed: 'the fix shows here',
        steps: [step('after', 1), step('after', 2), step('after', 3)],
      },
    });
    assert.equal(countOf(html, '<section class="row">'), 2);
    assert.equal(countOf(html, '<section class="row checked">'), 1);
    assert.ok(
      html.indexOf('<section class="row checked">') >
        html.lastIndexOf('<section class="row">'),
      'the checked row is the last one',
    );
    assert.equal(countOf(html, 'checked here'), 1);
  });

  test('a step taken unsettled shows "not settled" beside its label, and a settled step shows no such tag', () => {
    const html = page({
      before: {
        outcome: 'fail',
        message: 'the defect shows here',
        steps: [step('before', 1)],
      },
      after: {
        outcome: 'pass',
        observed: 'the fix shows here',
        steps: [{ ...step('after', 1), settled: false }],
      },
    });
    assert.ok(
      html.includes(
        '<span class="tags"><span class="label">Device Desktop</span><span class="unsettled">not settled</span></span>',
      ),
    );
    assert.equal(countOf(html, 'class="unsettled"'), 1);
  });

  test('every font-size, padding, gap, margin, border-radius and font-weight in the page styles is a token', () => {
    const html = page({
      before: {
        outcome: 'fail',
        message: 'the defect shows here',
        steps: [step('before', 1)],
      },
      after: {
        outcome: 'pass',
        observed: 'the fix shows here',
        steps: [step('after', 1)],
      },
    });
    const style = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)]
      .map(([, text]) => text)
      .find((text) => text.includes('box-sizing'));
    assert.ok(style !== undefined, 'the page styles are present');

    const SPACING_AND_TYPE =
      /^(font-size|font-weight|padding(-[a-z]+)?|gap|margin(-[a-z]+)?|border-radius)$/;
    // Values that need no token: zero, auto, one fractional column, and percentages.
    const NO_TOKEN = new Set(['0', 'auto', '1fr']);
    const checked = declarationsIn(style).filter(({ name }) =>
      SPACING_AND_TYPE.test(name),
    );
    assert.ok(checked.length > 10, 'the page styles declare values to check');

    const literal = checked.filter(({ value }) =>
      value
        .split(/\s+/)
        .some(
          (token) =>
            !token.includes('var(--') &&
            !NO_TOKEN.has(token) &&
            !/^\d+(\.\d+)?%$/.test(token),
        ),
    );
    assert.deepEqual(literal, []);
  });
});
