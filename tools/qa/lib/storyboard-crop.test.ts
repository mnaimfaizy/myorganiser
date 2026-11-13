// Contracts for a Storyboard still's crop (PRD #1544), exercised through
// storyboard-crop.ts's `cropFor`. The default viewport is 1280x720, with 32px
// of padding and a 640px minimum width at the viewport's 16:9 aspect, so the
// smallest crop is 640x360. Pure: nothing here touches disk or a browser.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Box } from './qa-scenario.ts';
import { type Crop, cropFor } from './storyboard-crop.ts';

const VIEWPORT = { width: 1280, height: 720 };

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
    crop: { x: 300, y: 130, width: 640, height: 360 },
    outline: { x: 300, y: 170, width: 40, height: 20 },
  },
  {
    name: 'a subject at the top-left is clamped to the left and top',
    subject: { x: 0, y: 0, width: 40, height: 20 },
    crop: { x: 0, y: 0, width: 640, height: 360 },
    outline: { x: 0, y: 0, width: 40, height: 20 },
  },
  {
    name: 'a subject at the bottom-right is clamped to the right and bottom',
    subject: { x: 1240, y: 700, width: 40, height: 20 },
    crop: { x: 640, y: 360, width: 640, height: 360 },
    outline: { x: 600, y: 340, width: 40, height: 20 },
  },
  {
    name: 'a wide subject: padding sets the width, the aspect the height, clamped at the top',
    subject: { x: 100, y: 100, width: 1000, height: 50 },
    crop: { x: 68, y: 0, width: 1064, height: 599 },
    outline: { x: 32, y: 100, width: 1000, height: 50 },
  },
  {
    name: 'a tall subject: padding sets the height, the aspect the width',
    subject: { x: 600, y: 100, width: 40, height: 500 },
    crop: { x: 119, y: 68, width: 1003, height: 564 },
    outline: { x: 481, y: 32, width: 40, height: 500 },
  },
  {
    name: 'the whole viewport is capped at the viewport',
    subject: { x: 0, y: 0, width: 1280, height: 720 },
    crop: { x: 0, y: 0, width: 1280, height: 720 },
    outline: { x: 0, y: 0, width: 1280, height: 720 },
  },
  {
    name: 'a subject partly off-screen is clipped to the viewport first',
    subject: { x: -20, y: 300, width: 100, height: 20 },
    crop: { x: 0, y: 130, width: 640, height: 360 },
    outline: { x: 0, y: 170, width: 80, height: 20 },
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

describe('cropFor: the exact crop and outline on the default viewport', () => {
  for (const { name, subject, crop, outline } of CASES) {
    test(name, () => {
      assert.deepEqual(cropFor(subject), { crop, outline } satisfies Crop);
    });
  }
});

describe('cropFor: properties every crop keeps', () => {
  const fits = (box: Box): boolean =>
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= VIEWPORT.width &&
    box.y + box.height <= VIEWPORT.height;

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
        x: subject.x - 32,
        y: subject.y - 32,
        width: subject.width + 64,
        height: subject.height + 64,
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

describe('cropFor: a custom viewport', () => {
  test('crops to the given viewport, keeping its aspect and capping at its size', () => {
    const small = { width: 800, height: 600 };
    assert.deepEqual(
      cropFor({ x: 100, y: 100, width: 40, height: 20 }, small),
      {
        crop: { x: 0, y: 0, width: 640, height: 480 },
        outline: { x: 100, y: 100, width: 40, height: 20 },
      },
    );
    assert.deepEqual(cropFor(null, small), {
      crop: { x: 0, y: 0, width: 800, height: 600 },
      outline: null,
    });
  });
});
