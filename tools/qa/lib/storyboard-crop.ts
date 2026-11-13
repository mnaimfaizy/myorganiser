/**
 * Crop geometry for a Storyboard still (PRD #1544).
 *
 * A step's subject box becomes the part of the 1280×720 still that is shown:
 * the box plus padding, grown to a minimum size, then to a fixed aspect,
 * centred on the subject and moved, never shrunk, to stay inside the
 * viewport. The subject is drawn as one outline, with no dimming around it
 * (the prototype showed dimming doubling up when two outlines share a still).
 * With no subject, the still is shown full-frame with no outline.
 *
 * The aspect is the viewport's own, so the largest crop is the full frame and
 * every still in a column lines up at the same height.
 *
 * Pure.
 */
import { VIEWPORT } from './qa-run.ts';
import type { Box } from './qa-scenario.ts';

export const CROP = {
  /** Space kept around the subject on every side, in viewport pixels. */
  padding: 32,
  /** The smallest crop's width; its height follows from the aspect. */
  minWidth: 640,
} as const;

export interface Crop {
  /** The part of the still that is shown, in viewport pixels. */
  crop: Box;
  /** The subject, relative to the crop, or `null` when there is none to outline. */
  outline: Box | null;
}

export interface Viewport {
  width: number;
  height: number;
}

const FULL_FRAME = (viewport: Viewport): Crop => ({
  crop: { x: 0, y: 0, width: viewport.width, height: viewport.height },
  outline: null,
});

/** The part of `box` inside the viewport, or `null` if none of it is. */
function clipToViewport(box: Box, viewport: Viewport): Box | null {
  const left = Math.max(0, box.x);
  const top = Math.max(0, box.y);
  const right = Math.min(viewport.width, box.x + box.width);
  const bottom = Math.min(viewport.height, box.y + box.height);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function cropFor(
  subject: Box | null,
  viewport: Viewport = VIEWPORT,
): Crop {
  if (subject === null) return FULL_FRAME(viewport);
  const visible = clipToViewport(subject, viewport);
  if (visible === null) return FULL_FRAME(viewport);

  const aspect = viewport.width / viewport.height;
  let width = Math.max(visible.width + 2 * CROP.padding, CROP.minWidth);
  let height = Math.max(
    visible.height + 2 * CROP.padding,
    CROP.minWidth / aspect,
  );
  if (width / height > aspect) height = width / aspect;
  else width = height * aspect;
  if (width > viewport.width) {
    width = viewport.width;
    height = viewport.height;
  }
  width = Math.round(width);
  height = Math.round(height);

  const centreX = visible.x + visible.width / 2;
  const centreY = visible.y + visible.height / 2;
  const x = Math.round(clamp(centreX - width / 2, 0, viewport.width - width));
  const y = Math.round(
    clamp(centreY - height / 2, 0, viewport.height - height),
  );
  const crop = { x, y, width, height };

  // The crop always contains the visible subject: it is the padded subject
  // grown and moved inside the viewport, or the whole viewport.
  return {
    crop,
    outline: {
      x: visible.x - x,
      y: visible.y - y,
      width: visible.width,
      height: visible.height,
    },
  };
}
