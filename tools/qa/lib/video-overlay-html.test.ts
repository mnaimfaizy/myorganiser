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
  VIDEO_STRIP_HEIGHT,
  pacedTimeline,
} from './qa-combine.ts';
import {
  BEFORE_FIRST_STEP,
  CHECKED_HERE,
  NO_CLOCK_NOTE,
  type OverlayPage,
  timingText,
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
  test('each side has one opaque 1280 wide strip of VIDEO_STRIP_HEIGHT per caption window, the opening strip included', () => {
    const [before, after] = pages.sides;
    assert.equal(before?.strips.length, 3);
    assert.equal(after?.strips.length, 2);
    for (const strip of [...(before?.strips ?? []), ...(after?.strips ?? [])]) {
      assert.equal(strip.width, 1280);
      assert.equal(strip.height, VIDEO_STRIP_HEIGHT);
      assert.equal(strip.transparent, false);
      assert.ok(
        strip.html.includes(
          `style="width:1280px;height:${VIDEO_STRIP_HEIGHT}px"`,
        ),
        strip.html,
      );
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

/** The run's wall clock start: 2 January 2026, 03:04:05 UTC. */
const START = Date.UTC(2026, 0, 2, 3, 4, 5);

/** A caption long enough to need most of a strip's width, with no markup in it. */
const LONG_CAPTION =
  'open the saved item, check every field against the form, then wait for the confirmation to appear before leaving the page';

/**
 * PLAN with both sides' clocks saved and its zone pinned to UTC. Before's step 1
 * is at 1.5 s and After's at 2 s, so After is 0.5 s later on the same step.
 */
const CLOCKED: AnnotatedVideoPlan = {
  ...PLAN,
  timeZone: 'UTC',
  sides: [
    { ...BEFORE, startedAtMs: START },
    { ...AFTER, startedAtMs: START + 1000 },
  ],
};
const clockedPages = videoOverlayPages(CLOCKED, TOKENS, timelineOf(CLOCKED));

describe("timingText: what a step's timing line says", () => {
  test("the wall clock, the elapsed time and After's difference, joined by middle dots", () => {
    assert.equal(
      timingText(
        { elapsedMs: 1500, clockMs: START + 1500, differenceMs: 500 },
        'UTC',
      ),
      '03:04:06 UTC · 0:01.5 elapsed · After +0.5 s',
    );
  });

  test('with no clock, the note stands in for the clock; with no difference there is no After part', () => {
    assert.equal(
      timingText({ elapsedMs: 1500 }, 'UTC'),
      'clock time unavailable: older run · 0:01.5 elapsed',
    );
    assert.equal(NO_CLOCK_NOTE, 'clock time unavailable: older run');
  });
});

describe('the timing line of a caption strip', () => {
  test("a step's strip has a second line: the wall clock in the plan's zone, then the elapsed time", () => {
    const [, beforeStep1] = clockedPages.sides[0]?.strips ?? [];
    assert.ok(
      beforeStep1?.html.includes(
        '<span class="timing">03:04:06 UTC · 0:01.5 elapsed</span>',
      ),
      beforeStep1?.html,
    );
    assert.equal(
      beforeStep1?.html.includes('After'),
      false,
      'Before has no difference',
    );
  });

  test("After's strip adds its difference from Before at the same step", () => {
    const [, afterStep1] = clockedPages.sides[1]?.strips ?? [];
    assert.ok(
      afterStep1?.html.includes(
        '<span class="timing">03:04:08 UTC · 0:02.0 elapsed · After +0.5 s</span>',
      ),
      afterStep1?.html,
    );
  });

  test('a side with no saved start shows the note in place of the clock, and still shows its elapsed time and difference', () => {
    const [, beforeStep1] = pages.sides[0]?.strips ?? [];
    const [, afterStep1] = pages.sides[1]?.strips ?? [];
    assert.ok(
      beforeStep1?.html.includes(
        '<span class="timing">clock time unavailable: older run · 0:01.5 elapsed</span>',
      ),
      beforeStep1?.html,
    );
    assert.ok(
      afterStep1?.html.includes(
        '<span class="timing">clock time unavailable: older run · 0:02.0 elapsed · After +0.5 s</span>',
      ),
      afterStep1?.html,
    );
  });

  test("the clock is written in the plan's zone, so the same instant reads in another zone", () => {
    const sydney: AnnotatedVideoPlan = {
      ...CLOCKED,
      timeZone: 'Australia/Sydney',
    };
    const out = videoOverlayPages(sydney, TOKENS, timelineOf(sydney));
    const [, beforeStep1] = out.sides[0]?.strips ?? [];
    assert.ok(
      beforeStep1?.html.includes('14:04:06 AEDT · 0:01.5 elapsed'),
      beforeStep1?.html,
    );
  });

  test('a single-side run shows its clock and elapsed time, and no difference', () => {
    const alone: AnnotatedVideoPlan = {
      ...CLOCKED,
      sides: [{ ...AFTER, startedAtMs: START + 1000 }],
    };
    const out = videoOverlayPages(alone, TOKENS, timelineOf(alone));
    const [, step1] = out.sides[0]?.strips ?? [];
    assert.ok(
      step1?.html.includes(
        '<span class="timing">03:04:08 UTC · 0:02.0 elapsed</span>',
      ),
      step1?.html,
    );
    assert.equal(step1?.html.includes('After +'), false);
  });

  test('the timing span holds exactly the timing text, with no markup inside it', () => {
    const [, step1] = clockedPages.sides[1]?.strips ?? [];
    const timing = /<span class="timing">([^<]*)<\/span>/.exec(
      step1?.html ?? '',
    );
    // After's clock starts at START + 1000, so its 2 s step is at START + 3000.
    assert.equal(
      timing?.[1],
      timingText(
        { elapsedMs: 2000, clockMs: START + 3000, differenceMs: 500 },
        'UTC',
      ),
    );
  });

  test('a step strip is two lines, the caption first and whole on its own line, and the opening strip is one line', () => {
    const long: AnnotatedVideoPlan = {
      ...CLOCKED,
      sides: [
        {
          ...BEFORE,
          startedAtMs: START,
          steps: [
            { ...BEFORE.steps[0], caption: LONG_CAPTION },
            BEFORE.steps[1],
          ],
        },
        AFTER,
      ],
    };
    const out = videoOverlayPages(long, TOKENS, timelineOf(long));
    const [opening, step1, step2] = out.sides[0]?.strips ?? [];
    assert.equal(
      (opening?.html.match(/class="line"/g) ?? []).length,
      1,
      'the opening strip is one line',
    );
    for (const strip of [step1, step2]) {
      assert.equal(
        (strip?.html.match(/class="line"/g) ?? []).length,
        2,
        'a step strip is two lines',
      );
    }
    assert.ok(
      step1?.html.includes(
        `<div class="line"><span class="n">1</span><span class="caption">${LONG_CAPTION}</span>`,
      ),
      step1?.html,
    );
    assert.ok(
      (step1?.html.indexOf('class="caption"') ?? -1) <
        (step1?.html.indexOf('class="timing"') ?? 0),
      'the caption line comes before the timing line',
    );
  });
});

describe('the timing line when only one side has a saved clock start', () => {
  test('a side without a clock start shows the note with its elapsed time, and After adds its difference; the side with a clock shows its clock', () => {
    // Before has its clock (step 1 at 1.5 s, 03:04:06 UTC); After has none
    // (step 1 at 2.0 s), so its strip shows the note and the difference.
    const mixed: AnnotatedVideoPlan = {
      ...PLAN,
      timeZone: 'UTC',
      sides: [{ ...BEFORE, startedAtMs: START }, AFTER],
    };
    const out = videoOverlayPages(mixed, TOKENS, timelineOf(mixed));
    const [, beforeStep1] = out.sides[0]?.strips ?? [];
    const [, afterStep1] = out.sides[1]?.strips ?? [];
    assert.ok(
      beforeStep1?.html.includes(
        '<span class="timing">03:04:06 UTC · 0:01.5 elapsed</span>',
      ),
      beforeStep1?.html,
    );
    assert.equal(beforeStep1?.html.includes(NO_CLOCK_NOTE), false);
    assert.ok(
      afterStep1?.html.includes(
        `<span class="timing">${NO_CLOCK_NOTE} · 0:02.0 elapsed · After +0.5 s</span>`,
      ),
      afterStep1?.html,
    );

    // The other way round: After has its clock, Before has none.
    const reversed: AnnotatedVideoPlan = {
      ...PLAN,
      timeZone: 'UTC',
      sides: [BEFORE, { ...AFTER, startedAtMs: START + 1000 }],
    };
    const back = videoOverlayPages(reversed, TOKENS, timelineOf(reversed));
    const [, noClockStep1] = back.sides[0]?.strips ?? [];
    const [, clockStep1] = back.sides[1]?.strips ?? [];
    assert.ok(
      noClockStep1?.html.includes(
        `<span class="timing">${NO_CLOCK_NOTE} · 0:01.5 elapsed</span>`,
      ),
      noClockStep1?.html,
    );
    assert.ok(
      clockStep1?.html.includes(
        '<span class="timing">03:04:08 UTC · 0:02.0 elapsed · After +0.5 s</span>',
      ),
      clockStep1?.html,
    );
  });
});

describe('the checked step on the strips', () => {
  test("the strip of a step marked checked carries the checked class and tag; the last step's strip does not, and the other side keeps its last step", () => {
    const plan: AnnotatedVideoPlan = {
      ...PLAN,
      sides: [
        {
          ...BEFORE,
          steps: [{ ...BEFORE.steps[0], checked: true }, BEFORE.steps[1]],
        },
        AFTER,
      ],
    };
    const out = videoOverlayPages(plan, TOKENS, timelineOf(plan));
    const [, marked, last] = out.sides[0].strips;
    assert.ok(marked?.html.includes('class="strip checked"'), marked?.html);
    assert.ok(marked?.html.includes(CHECKED_HERE), marked?.html);
    assert.equal(last?.html.includes(CHECKED_HERE), false, last?.html);
    assert.equal(last?.html.includes('class="strip checked"'), false);
    assert.ok(out.sides[1].strips.at(-1)?.html.includes(CHECKED_HERE));
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
