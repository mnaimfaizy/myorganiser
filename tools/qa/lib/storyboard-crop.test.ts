// Contracts for a Storyboard still's crop (PRD #1544; minimum width and outline
// ring from issue #1556), exercised through storyboard-crop.ts's `cropFor`. The
// default viewport is 1280x720, with 32px of padding and a 960px minimum width
// at the viewport's 16:9 aspect, so the smallest crop is 960x540. The outline is
// the subject grown by 7px (4px gap + 3px stroke) on every side, and the crop is
// sized from that ring.
//
// Viewport-edge rule: a subject that touches a viewport edge has no pixels
// beyond that edge, so the crop is clamped to the viewport. The outline still
// sits 7px outside the subject, so on that side it runs past the crop and is
// clipped at the viewport edge. "The subject" in that rule is the part of it
// inside the viewport. Pure: nothing here touches disk or a browser.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Box } from './qa-scenario.ts';
import { type Crop, cropFor } from './storyboard-crop.ts';

const VIEWPORT = { width: 1280, height: 720 };
const PADDING = 32;
const GAP = 4;
const STROKE = 3;

/** Each subject, the crop and outline it must produce on the default viewport. */
const CASES: {
  name: string;
  subject: Box | null;
  crop: Box;
  outline: Box | null;
}[] = [
  {
    name: 'a small subject gets the minimum size, centred on it',
    subject: { x: 600, y: 300, width: 40, height: 20 },
    crop: { x: 140, y: 40, width: 960, height: 540 },
    outline: { x: 453, y: 253, width: 54, height: 34 },
  },
  {
    name: 'a subject at the top-left is clamped to the left and top; its outline runs past the crop on those sides, clipped at the viewport edge',
    subject: { x: 0, y: 0, width: 40, height: 20 },
    crop: { x: 0, y: 0, width: 960, height: 540 },
    outline: { x: -7, y: -7, width: 54, height: 34 },
  },
  {
    name: 'a subject at the bottom-right is clamped to the right and bottom; its outline runs past the crop on those sides, clipped at the viewport edge',
    subject: { x: 1240, y: 700, width: 40, height: 20 },
    crop: { x: 320, y: 180, width: 960, height: 540 },
    outline: { x: 913, y: 513, width: 54, height: 34 },
  },
  {
    name: 'a wide subject: padding sets the width, the aspect the height, clamped at the top',
    subject: { x: 100, y: 100, width: 1000, height: 50 },
    crop: { x: 61, y: 0, width: 1078, height: 606 },
    outline: { x: 32, y: 93, width: 1014, height: 64 },
  },
  {
    name: 'a tall subject: padding sets the height, the aspect the width',
    subject: { x: 600, y: 100, width: 40, height: 500 },
    crop: { x: 106, y: 61, width: 1028, height: 578 },
    outline: { x: 487, y: 32, width: 54, height: 514 },
  },
  {
    name: 'the whole viewport is capped at the viewport; its outline runs past the crop on all four sides, clipped at the viewport edge',
    subject: { x: 0, y: 0, width: 1280, height: 720 },
    crop: { x: 0, y: 0, width: 1280, height: 720 },
    outline: { x: -7, y: -7, width: 1294, height: 734 },
  },
  {
    name: 'a subject partly off-screen is clipped to the viewport first; its outline runs past the crop on the left, clipped at the viewport edge',
    subject: { x: -20, y: 300, width: 100, height: 20 },
    crop: { x: 0, y: 40, width: 960, height: 540 },
    outline: { x: -7, y: 253, width: 94, height: 34 },
  },
  {
    name: 'a subject entirely off-screen shows the full frame with no outline',
    subject: { x: 2000, y: 2000, width: 10, height: 10 },
    crop: { x: 0, y: 0, width: 1280, height: 720 },
    outline: null,
  },
  {
    name: 'no subject shows the full frame with no outline',
    subject: null,
    crop: { x: 0, y: 0, width: 1280, height: 720 },
    outline: null,
  },
];

const fits = (box: Box): boolean =>
  box.x >= 0 &&
  box.y >= 0 &&
  box.x + box.width <= VIEWPORT.width &&
  box.y + box.height <= VIEWPORT.height;

describe('cropFor: the exact crop and outline on the default viewport', () => {
  for (const { name, subject, crop, outline } of CASES) {
    test(name, () => {
      assert.deepEqual(cropFor(subject), { crop, outline } satisfies Crop);
    });
  }
});

describe('cropFor: properties every crop keeps', () => {
  test('every crop lies inside the viewport, and its width is within 1px of 16:9', () => {
    for (const { name, subject } of CASES) {
      const { crop } = cropFor(subject);
      assert.ok(fits(crop), `${name}: crop ${JSON.stringify(crop)}`);
      assert.ok(
        Math.abs(crop.width - (crop.height * 16) / 9) <= 1,
        `${name}: aspect of ${JSON.stringify(crop)}`,
      );
    }
  });

  test('the crop contains the padded subject whenever the padded subject fits the viewport', () => {
    for (const { name, subject } of CASES) {
      if (subject === null) continue;
      const padded = {
        x: subject.x - PADDING,
        y: subject.y - PADDING,
        width: subject.width + 2 * PADDING,
        height: subject.height + 2 * PADDING,
      };
      if (!fits(padded)) continue;
      const { crop } = cropFor(subject);
      assert.ok(
        crop.x <= padded.x &&
          crop.y <= padded.y &&
          crop.x + crop.width >= padded.x + padded.width &&
          crop.y + crop.height >= padded.y + padded.height,
        `${name}: crop ${JSON.stringify(crop)} does not contain ${JSON.stringify(padded)}`,
      );
    }
  });
});

describe('cropFor: issue #1556 acceptance', () => {
  test('a small element gets a crop at least 960 wide, 16:9, inside the viewport', () => {
    const smalls: Box[] = [
      { x: 600, y: 300, width: 40, height: 20 },
      { x: 0, y: 0, width: 40, height: 20 },
      { x: 1240, y: 700, width: 40, height: 20 },
      { x: 600, y: 100, width: 40, height: 20 },
    ];
    for (const subject of smalls) {
      const { crop } = cropFor(subject);
      assert.ok(crop.width >= 960, `crop ${JSON.stringify(crop)}`);
      assert.ok(fits(crop), `crop ${JSON.stringify(crop)} leaves the viewport`);
      assert.ok(
        Math.abs(crop.width - (crop.height * 16) / 9) <= 1,
        `aspect of ${JSON.stringify(crop)}`,
      );
    }
  });

  test('a large element keeps the padding on every side, and its outline clears it by the gap and stroke', () => {
    const larges: Box[] = [
      { x: 100, y: 100, width: 1000, height: 50 },
      { x: 600, y: 100, width: 40, height: 500 },
    ];
    for (const subject of larges) {
      const { crop, outline } = cropFor(subject);
      assert.ok(outline !== null, 'a subject has an outline');
      const ring = {
        x: crop.x + outline.x,
        y: crop.y + outline.y,
        width: outline.width,
        height: outline.height,
      };
      const subjectRight = subject.x + subject.width;
      const subjectBottom = subject.y + subject.height;

      assert.ok(subject.x - crop.x >= PADDING, 'left padding');
      assert.ok(subject.y - crop.y >= PADDING, 'top padding');
      assert.ok(crop.x + crop.width - subjectRight >= PADDING, 'right padding');
      assert.ok(
        crop.y + crop.height - subjectBottom >= PADDING,
        'bottom padding',
      );

      const clear = GAP + STROKE;
      assert.ok(
        subject.x - ring.x >= clear,
        'outline clears subject on the left',
      );
      assert.ok(
        subject.y - ring.y >= clear,
        'outline clears subject on the top',
      );
      assert.ok(
        ring.x + ring.width - subjectRight >= clear,
        'outline clears subject on the right',
      );
      assert.ok(
        ring.y + ring.height - subjectBottom >= clear,
        'outline clears subject on the bottom',
      );
      assert.ok(
        ring.x >= crop.x &&
          ring.y >= crop.y &&
          ring.x + ring.width <= crop.x + crop.width &&
          ring.y + ring.height <= crop.y + crop.height,
        'outline sits inside the crop',
      );
    }
  });

  test('an element on the viewport edge is clamped to it, not moved inside', () => {
    const topLeft = cropFor({ x: 0, y: 0, width: 40, height: 20 }).crop;
    assert.deepEqual([topLeft.x, topLeft.y], [0, 0]);

    const bottomRight = cropFor({
      x: 1240,
      y: 700,
      width: 40,
      height: 20,
    }).crop;
    assert.equal(bottomRight.x + bottomRight.width, VIEWPORT.width);
    assert.equal(bottomRight.y + bottomRight.height, VIEWPORT.height);
  });

  test('a subject touching a viewport edge keeps the outline clear of it by the gap and stroke, even where the outline runs past the crop', () => {
    // Each subject, with its part inside the viewport (the edge rule in the header).
    const edgeSubjects: { subject: Box; visible: Box }[] = [
      {
        subject: { x: 0, y: 0, width: 40, height: 20 },
        visible: { x: 0, y: 0, width: 40, height: 20 },
      },
      {
        subject: { x: 1240, y: 700, width: 40, height: 20 },
        visible: { x: 1240, y: 700, width: 40, height: 20 },
      },
      {
        subject: { x: 0, y: 0, width: 1280, height: 720 },
        visible: { x: 0, y: 0, width: 1280, height: 720 },
      },
      {
        subject: { x: -20, y: 300, width: 100, height: 20 },
        visible: { x: 0, y: 300, width: 80, height: 20 },
      },
    ];
    const clear = GAP + STROKE;
    for (const { subject, visible } of edgeSubjects) {
      const { crop, outline } = cropFor(subject);
      assert.ok(outline !== null, 'a subject has an outline');
      const ring = {
        x: crop.x + outline.x,
        y: crop.y + outline.y,
        width: outline.width,
        height: outline.height,
      };
      const visibleRight = visible.x + visible.width;
      const visibleBottom = visible.y + visible.height;
      const label = JSON.stringify(subject);

      assert.ok(visible.x - ring.x >= clear, `${label}: clears on the left`);
      assert.ok(visible.y - ring.y >= clear, `${label}: clears on the top`);
      assert.ok(
        ring.x + ring.width - visibleRight >= clear,
        `${label}: clears on the right`,
      );
      assert.ok(
        ring.y + ring.height - visibleBottom >= clear,
        `${label}: clears on the bottom`,
      );

      // Where the subject touches a viewport edge, the outline runs past the
      // crop on that side: the crop is clamped, the ring is not.
      if (visible.x === 0) assert.ok(ring.x < crop.x, `${label}: left`);
      if (visible.y === 0) assert.ok(ring.y < crop.y, `${label}: top`);
      if (visibleRight === VIEWPORT.width)
        assert.ok(ring.x + ring.width > crop.x + crop.width, `${label}: right`);
      if (visibleBottom === VIEWPORT.height)
        assert.ok(
          ring.y + ring.height > crop.y + crop.height,
          `${label}: bottom`,
        );
    }
  });

  test('an element wider than the viewport falls back to the full frame, and one off-screen to the full frame with no outline', () => {
    const wider = cropFor({ x: -100, y: 300, width: 1500, height: 40 });
    assert.deepEqual(wider.crop, { x: 0, y: 0, width: 1280, height: 720 });
    assert.notEqual(wider.outline, null);

    const offScreen = cropFor({ x: 2000, y: 2000, width: 10, height: 10 });
    assert.deepEqual(offScreen, {
      crop: { x: 0, y: 0, width: 1280, height: 720 },
      outline: null,
    });
  });
});

describe('cropFor: a custom viewport', () => {
  test('crops to the given viewport, keeping its own aspect', () => {
    assert.deepEqual(
      cropFor(
        { x: 600, y: 300, width: 40, height: 20 },
        { width: 1600, height: 1000 },
      ),
      {
        crop: { x: 140, y: 10, width: 960, height: 600 },
        outline: { x: 453, y: 283, width: 54, height: 34 },
      },
    );
  });

  test('a viewport narrower than the minimum width shows the whole viewport', () => {
    const small = { width: 800, height: 600 };
    assert.deepEqual(
      cropFor({ x: 100, y: 100, width: 40, height: 20 }, small),
      {
        crop: { x: 0, y: 0, width: 800, height: 600 },
        outline: { x: 93, y: 93, width: 54, height: 34 },
      },
    );
    assert.deepEqual(cropFor(null, small), {
      crop: { x: 0, y: 0, width: 800, height: 600 },
      outline: null,
    });
  });
});
