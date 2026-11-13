// Contracts for the Storyboard page's HTML (PRD #1544), exercised through
// storyboard-html.ts's `storyboardHtml` on a model built by `buildStoryboard`.
// Pure: nothing here starts a browser or touches disk.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { ExpectedResults, StepRecord } from './qa-scenario.ts';
import type { Side } from './qa-stack.ts';
import { BEFORE_SAME_STEP, storyboardHtml } from './storyboard-html.ts';
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

/** A fix: Before is expected to show the defect, After the fix. */
const DIFFERENT_EXPECTED: ExpectedResults = {
  before: 'the defect shows',
  after: 'the fix shows',
};

function page(
  sides: Partial<Record<Side, StoryboardSideInput>>,
  tokenCss = TOKENS,
  title = 'Save an item',
  expected: ExpectedResults = DIFFERENT_EXPECTED,
): string {
  return storyboardHtml(
    buildStoryboard({
      id: 'S1',
      title,
      expected,
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

  test('identical expected results that both sides observed draw one After column, with the alike text leading the band meta', () => {
    const html = page(
      {
        before: {
          outcome: 'pass',
          observed: 'the same label',
          steps: [step('before', 1), step('before', 2)],
        },
        after: {
          outcome: 'pass',
          observed: 'the same label',
          steps: [step('after', 1), step('after', 2)],
        },
      },
      TOKENS,
      'Save an item',
      { before: 'the same label', after: 'the same label' },
    );
    assert.ok(html.includes('<body style="--columns:1">'), 'one column');
    assert.ok(
      html.includes(
        '<div class="meta">Before and After alike · Before aaaaaaa (merge-base)',
      ),
      'the alike text leads the band meta, before the commits',
    );
    assert.equal(countOf(html, 'Before and After alike'), 1);
    assert.equal(countOf(html, '<div class="still" data-side="before"'), 0);
    assert.equal(countOf(html, '<div class="still" data-side="after"'), 2);
  });

  test('alike with differing captions: each row carries a Before note naming the Before caption', () => {
    const html = page(
      {
        before: {
          outcome: 'pass',
          observed: 'the same label',
          steps: [
            step('before', 1, 'the before caption'),
            step('before', 2, 'the before caption two'),
          ],
        },
        after: {
          outcome: 'pass',
          observed: 'the same label',
          steps: [
            step('after', 1, 'the after caption'),
            step('after', 2, 'the after caption two'),
          ],
        },
      },
      TOKENS,
      'Save an item',
      { before: 'the same label', after: 'the same label' },
    );
    assert.equal(countOf(html, 'class="before-note"'), 2);
    assert.ok(
      html.includes(
        '<div class="before-note" data-side="before">Before: the before caption</div>',
      ),
    );
    assert.ok(
      html.includes(
        '<div class="before-note" data-side="before">Before: the before caption two</div>',
      ),
    );
    // Each note sits inside its own row, after that row's stills.
    const rows = html.split('<section class="row').slice(1);
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(countOf(row, 'class="before-note"'), 1);
    }
  });

  test('alike with matching captions: each row carries the "Before: same step" note', () => {
    const html = page(
      {
        before: {
          outcome: 'pass',
          observed: 'the same label',
          steps: [step('before', 1), step('before', 2)],
        },
        after: {
          outcome: 'pass',
          observed: 'the same label',
          steps: [step('after', 1), step('after', 2)],
        },
      },
      TOKENS,
      'Save an item',
      { before: 'the same label', after: 'the same label' },
    );
    assert.equal(BEFORE_SAME_STEP, 'Before: same step');
    assert.equal(
      countOf(
        html,
        `<div class="before-note" data-side="before">${BEFORE_SAME_STEP}</div>`,
      ),
      2,
    );
    assert.equal(countOf(html, 'class="before-note"'), 2);
    assert.equal(html.includes('Before: step 1'), false);
  });

  test('a two-column or After-only Storyboard draws no Before note', () => {
    const twoColumn = page({
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
    const afterOnly = page(
      {
        after: {
          outcome: 'pass',
          observed: 'the fix shows here',
          steps: [step('after', 1), step('after', 2)],
        },
      },
      TOKENS,
      'Save an item',
      { after: 'the fix shows' },
    );
    // Each page has rows drawn, so the absence is not an empty page.
    assert.equal(countOf(twoColumn, 'class="row'), 1);
    assert.equal(countOf(afterOnly, 'class="row'), 2);
    for (const html of [twoColumn, afterOnly]) {
      assert.equal(countOf(html, 'class="before-note"'), 0);
      assert.equal(html.includes(BEFORE_SAME_STEP), false);
    }
  });

  test('different expected results draw two columns and no alike text', () => {
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
    assert.ok(html.includes('<body style="--columns:2">'), 'two columns');
    assert.equal(html.includes('Before and After alike'), false);
    assert.equal(countOf(html, '<div class="still" data-side="before"'), 1);
  });

  test('an After-only feature draws one column and no "no step on BEFORE" cell', () => {
    const html = page(
      {
        after: {
          outcome: 'pass',
          observed: 'the fix shows here',
          steps: [step('after', 1), step('after', 2)],
        },
      },
      TOKENS,
      'Save an item',
      { after: 'the fix shows' },
    );
    assert.ok(html.includes('<body style="--columns:1">'), 'one column');
    assert.equal(html.includes('no step on BEFORE'), false);
    assert.equal(countOf(html, '<div class="still" data-side="after"'), 2);
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
