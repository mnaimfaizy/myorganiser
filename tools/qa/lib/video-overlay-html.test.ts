// Contracts for the annotated MP4's overlay pages (PRD #1544), through
// video-overlay-html.ts's public exports: the band, each side's label and its
// caption strips (one per window of the paced timeline), their sizes and
// transparency, what each strip says, and that every string is escaped. The
// pages are only checked as HTML here; no browser renders them, and the colours
// are asserted as the design tokens' roles rather than resolved values. Pure:
// no process, no file, no browser.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  type AnnotatedVideoPlan,
  type VideoSide,
  type VideoStep,
  pacedTimeline,
} from './qa-combine.ts';
import {
  BEFORE_FIRST_STEP,
  CHECKED_HERE,
  type OverlayPage,
  videoOverlayPages,
} from './video-overlay-html.ts';
import type { Band } from './storyboard.ts';

const TOKENS = ':root{--navy:220 50% 20%;--space-md:12px}';

/** A step taken on `device`'s `tab`, `atMs` from the run's start. */
function stepAt(
  index: number,
  caption: string,
  atMs: number,
  device = 'A',
  tab = 'A',
): VideoStep {
  return {
    index,
    caption,
    atMs,
    device,
    tab,
    label:
      device === 'A' && tab === 'A'
        ? 'Device A'
        : `Device ${device} · tab ${tab}`,
  };
}

const BAND: Band = {
  id: 'S1',
  title: 'Save <an> item & more',
  result: 'PASS',
  commits: { before: 'abc1234', after: 'def5678' },
};

/**
 * Before: two steps, the second on device B's tab B1 (so it names its tab),
 * giving three strips. After: one step on the MP4's own tab, giving two.
 */
const BEFORE: VideoSide = {
  side: 'before',
  video: '/work/before.webm',
  device: 'A',
  tab: 'A',
  label: 'Device A',
  openedAtMs: 0,
  steps: [
    stepAt(1, 'open the form', 1500),
    stepAt(2, 'press "Save" & wait <now>', 4000, 'B', 'B1'),
  ],
};

const AFTER: VideoSide = {
  side: 'after',
  video: '/work/after.webm',
  device: 'A',
  tab: 'A',
  label: 'Device A',
  openedAtMs: 0,
  steps: [stepAt(1, 'confirm', 2000)],
};

const PLAN: AnnotatedVideoPlan = {
  band: BAND,
  sides: [BEFORE, AFTER],
  output: '/out/combined/S1.mp4',
};

/** Each side's recording length in seconds, in PLAN's order: Before is longer, so After holds its last frame. */
const LENGTHS = [6, 4];

/** The paced timeline of a plan, with each side's recording length taken in plan order. */
function timelineOf(plan: AnnotatedVideoPlan) {
  return pacedTimeline(
    plan.sides,
    plan.sides.map((_, i) => LENGTHS[i]),
  );
}

const pages = videoOverlayPages(PLAN, TOKENS, timelineOf(PLAN));

/** The pages' HTML, for checks that span every overlay. */
function everyPageHtml(): string[] {
  return [
    pages.band.html,
    ...pages.sides.flatMap((side) => [
      side.label.html,
      ...side.strips.map((strip) => strip.html),
    ]),
  ];
}

describe('the band overlay', () => {
  test('is one band per side wide, 96 pixels tall and opaque, holding the scenario id, title and result', () => {
    const band: OverlayPage = pages.band;
    assert.equal(band.width, 2560);
    assert.equal(band.height, 96);
    assert.equal(band.transparent, false);
    assert.ok(band.html.includes('style="width:2560px;height:96px"'));
    assert.ok(band.html.includes('S1 · Save &lt;an&gt; item &amp; more'));
    assert.match(band.html, /<span class="result"[^>]*>PASS<\/span>/);

    const onePlan = { ...PLAN, sides: [BEFORE] };
    const one = videoOverlayPages(onePlan, TOKENS, timelineOf(onePlan));
    assert.equal(one.band.width, 1280);
  });
});

describe('the label overlay', () => {
  test('each side has a transparent 1280 by 48 label reading BEFORE or AFTER, then its tab', () => {
    const [before, after] = pages.sides;
    assert.equal(before?.label.width, 1280);
    assert.equal(before?.label.height, 48);
    assert.equal(before?.label.transparent, true);
    assert.ok(before?.label.html.includes('BEFORE · Device A'));
    assert.ok(after?.label.html.includes('AFTER · Device A'));
  });

  test('a side label and a step tab label are escaped, so markup in a tab name cannot reach the page', () => {
    const hostilePlan: AnnotatedVideoPlan = {
      ...PLAN,
      sides: [
        {
          ...BEFORE,
          label: 'Device A <i>x</i>',
          steps: [
            {
              index: 1,
              caption: 'confirm',
              atMs: 2000,
              device: 'B<b>',
              tab: 'T"1',
              label: 'Device B<b> · tab T"1',
            },
          ],
        },
      ],
    };
    const hostile = videoOverlayPages(
      hostilePlan,
      TOKENS,
      timelineOf(hostilePlan),
    );
    const [side] = hostile.sides;
    assert.ok(
      side?.label.html.includes('BEFORE · Device A &lt;i&gt;x&lt;/i&gt;'),
      side?.label.html,
    );
    assert.equal(side?.label.html.includes('<i>x</i>'), false);
    const stepStrip = side?.strips[1];
    assert.ok(
      stepStrip?.html.includes('(Device B&lt;b&gt; · tab T&quot;1)'),
      stepStrip?.html,
    );
    const everyHtml = [
      hostile.band.html,
      side?.label.html ?? '',
      ...(side?.strips ?? []).map((strip) => strip.html),
    ];
    for (const html of everyHtml) {
      assert.equal(html.includes('<b>'), false, 'no raw <b> reaches a page');
    }
  });
});

describe('the caption strips', () => {
  test('each side has one opaque 1280 by 56 strip per caption window, the opening strip included', () => {
    const [before, after] = pages.sides;
    assert.equal(before?.strips.length, 3);
    assert.equal(after?.strips.length, 2);
    for (const strip of [...(before?.strips ?? []), ...(after?.strips ?? [])]) {
      assert.equal(strip.width, 1280);
      assert.equal(strip.height, 56);
      assert.equal(strip.transparent, false);
    }
  });

  test('the opening strip says before step 1, and a step strip shows its number and caption', () => {
    const [before] = pages.sides;
    const [opening, first] = before?.strips ?? [];
    assert.ok(opening?.html.includes(BEFORE_FIRST_STEP));
    assert.ok(opening?.html.includes('data-step="0"'));
    assert.ok(first?.html.includes('data-step="1"'));
    assert.ok(first?.html.includes('open the form'));
  });

  test('there is one strip per caption window of the paced timeline, and a first step at 0 on both sides drops the opening strip', () => {
    const timeline = timelineOf(PLAN);
    assert.deepEqual(
      pages.sides.map((side) => side.strips.length),
      timeline.sides.map((side) => side.windows.length),
    );

    const atZero: AnnotatedVideoPlan = {
      ...PLAN,
      sides: [
        {
          ...BEFORE,
          steps: [
            stepAt(1, 'open the form', 0),
            stepAt(2, 'press "Save" & wait <now>', 2000, 'B', 'B1'),
          ],
        },
        { ...AFTER, steps: [stepAt(1, 'confirm', 0)] },
      ],
    };
    const shifted = videoOverlayPages(atZero, TOKENS, timelineOf(atZero));
    for (const side of shifted.sides) {
      assert.equal(side.strips.length, side.side === 'before' ? 2 : 1);
      assert.ok(side.strips[0]?.html.includes('data-step="1"'));
      assert.equal(
        side.strips.some((strip) => strip.html.includes('data-step="0"')),
        false,
        `${side.side} has no opening strip`,
      );
    }
  });

  test('a side with no steps has one opening strip, at data-step 0, and no step strips', () => {
    const emptyPlan: AnnotatedVideoPlan = {
      ...PLAN,
      sides: [{ ...AFTER, steps: [] }],
    };
    const empty = videoOverlayPages(emptyPlan, TOKENS, timelineOf(emptyPlan));
    const strips = empty.sides[0]?.strips ?? [];
    assert.equal(strips.length, 1);
    assert.ok(strips[0]?.html.includes('data-step="0"'));
    assert.ok(strips[0]?.html.includes(BEFORE_FIRST_STEP));
  });

  test('a caption is escaped, so markup in a step cannot reach the page', () => {
    const second = pages.sides[0]?.strips[2];
    assert.ok(
      second?.html.includes('press &quot;Save&quot; &amp; wait &lt;now&gt;'),
      second?.html,
    );
    assert.equal(second?.html.includes('<now>'), false);
  });

  test('a step on another tab names that tab, and a step on the MP4 tab does not', () => {
    const [before] = pages.sides;
    const [, onTabA, onTabB1] = before?.strips ?? [];
    assert.ok(onTabB1?.html.includes('(Device B · tab B1)'));
    assert.equal(onTabA?.html.includes('class="where"'), false);
  });

  test('only the last step of each side is marked as the one the check is made on', () => {
    const [before, after] = pages.sides;
    const marked = everyPageHtml().filter((html) =>
      html.includes(CHECKED_HERE),
    );
    assert.equal(marked.length, 2, 'one marked strip per side');
    assert.ok(before?.strips[2]?.html.includes(CHECKED_HERE));
    assert.equal(before?.strips[1]?.html.includes(CHECKED_HERE), false);
    assert.ok(after?.strips[1]?.html.includes(CHECKED_HERE));
    assert.equal(after?.strips[0]?.html.includes(CHECKED_HERE), false);
  });
});

describe('the overlay stylesheet', () => {
  test('no page carries a literal colour: every colour is a Semantic Role variable', () => {
    for (const html of everyPageHtml()) {
      assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(html), false, 'hex colour');
      assert.equal(/\brgba?\(/.test(html), false, 'rgb colour');
      assert.equal(/\bhsla?\((?!var\()/.test(html), false, 'hsl colour');
    }
    assert.ok(pages.band.html.includes('hsl(var(--navy))'));
  });

  test('the token stylesheet cannot close its own style element', () => {
    const hostile = videoOverlayPages(
      PLAN,
      '</style><script>alert(1)</script>',
      timelineOf(PLAN),
    );
    assert.ok(
      hostile.band.html.includes('<\\/style><script>alert(1)<\\/script>'),
    );
    assert.equal(hostile.band.html.includes('</style><script>'), false);
  });
});
