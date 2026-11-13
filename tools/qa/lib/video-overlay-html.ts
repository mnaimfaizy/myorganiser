/**
 * Draws the overlays of a `Capture: video` scenario's annotated MP4 as HTML
 * pages, for `video-overlay-render.ts` to screenshot in Chromium (PRD
 * #1544), the same way the Storyboard is drawn. ffmpeg then only scales,
 * stacks and overlays the PNGs (`qa-combine.ts`); it never draws text.
 *
 * Three kinds of overlay, each at an exact pixel size:
 *
 *   - the band: the Storyboard's own band (`bandHtml`), across both sides;
 *   - each side's label: "BEFORE · Device B · tab B1", on a transparent
 *     page, for the top left of that side's panel;
 *   - each side's caption strips, one per caption window
 *     (`captionWindows`): the step's number and caption, with the tab it was
 *     taken on when that is not the MP4's tab, and the last step marked as
 *     the one the check is made on. The opening strip covers the time before
 *     step 1.
 *
 * Every string shown is one the caption check (`caption-privacy.ts`) has
 * already passed: the band's title, the steps' captions and labels, and each
 * side's MP4 tab label, which the runner adds to that check as one more
 * field. Colours and type come from the design tokens' stylesheets through
 * the Storyboard's own `roleColour` and `token`, so the reader's check of
 * those stylesheets covers these pages too.
 *
 * Pure: every string is escaped.
 */
import {
  type AnnotatedVideoPlan,
  type CaptionWindow,
  VIDEO_BAND_HEIGHT,
  VIDEO_LABEL_HEIGHT,
  VIDEO_PANEL,
  VIDEO_STRIP_HEIGHT,
  type VideoSide,
  captionWindows,
} from './qa-combine.ts';
import type { Side } from './qa-stack.ts';
import {
  STORYBOARD_STYLE,
  bandHtml,
  escapeHtml,
  inlineStylesheet,
  roleColour,
  token,
} from './storyboard-html.ts';

/** One overlay page and the PNG it becomes. */
export interface OverlayPage {
  html: string;
  width: number;
  height: number;
  /** True when the page's background is left out of the PNG (the label). */
  transparent: boolean;
}

/** The overlay pages one MP4 needs, in the order `buildAnnotatedVideoArgs` reads them. */
export interface VideoOverlayPages {
  band: OverlayPage;
  sides: { side: Side; label: OverlayPage; strips: OverlayPage[] }[];
}

/** Shown on the strip before a side's first step. */
export const BEFORE_FIRST_STEP = 'before step 1';

/** Marks the strip of the step the scenario's check is made on. */
export const CHECKED_HERE = '◆ checked here';

const SIDE_TAG = {
  before: 'BEFORE',
  after: 'AFTER',
} as const satisfies Record<Side, string>;

const OVERLAY_STYLE = `
html,body{margin:0;overflow:hidden}
body{width:auto}
.overlay-band .band{height:${VIDEO_BAND_HEIGHT}px;overflow:hidden;white-space:nowrap}
.overlay-band .band h1{overflow:hidden;text-overflow:ellipsis}
.overlay-label{background:transparent}
.overlay-label .tag{display:inline-block;margin:${token('space-sm')};background:${roleColour('navy')};color:${roleColour('navy-foreground')};font-size:${token('type-label-sm-size')};font-weight:${token('font-weight-semibold')};letter-spacing:${token('type-label-caps-tracking')};padding:${token('space-xs')} ${token('space-sm')};border-radius:${token('radius-sm')};white-space:nowrap}
.strip{box-sizing:border-box;height:${VIDEO_STRIP_HEIGHT}px;display:flex;align-items:center;gap:${token('space-sm')};padding:0 ${token('space-md')};background:${roleColour('card')};color:${roleColour('foreground')};border-top:1px solid ${roleColour('border')};font-size:${token('type-body-sm-size')};white-space:nowrap;overflow:hidden}
.strip.checked{background:${roleColour('warning-faint')}}
.strip .n{font-weight:${token('font-weight-bold')};color:${roleColour('foreground-supporting')}}
.strip .caption{overflow:hidden;text-overflow:ellipsis}
.strip .where,.strip .waiting{color:${roleColour('foreground-supporting')};font-size:${token('type-caption-size')}}
.strip .checked-tag{color:${roleColour('warning-text')};font-weight:${token('font-weight-semibold')};font-size:${token('type-caption-size')}}
`;

function page(
  tokenCss: string,
  bodyClass: string,
  width: number,
  height: number,
  body: string,
): string {
  const tokens = inlineStylesheet(tokenCss);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${tokens}</style><style>${STORYBOARD_STYLE}</style><style>${OVERLAY_STYLE}</style></head><body class="${bodyClass}" style="width:${width}px;height:${height}px">${body}</body></html>`;
}

/** A side's label: its side, and the MP4's tab on that side. */
export function labelText(side: VideoSide): string {
  return `${SIDE_TAG[side.side]} · ${side.label}`;
}

function stripHtml(
  side: VideoSide,
  window: CaptionWindow,
  lastIndex: number,
): string {
  const { step } = window;
  if (step === null) {
    return `<div class="strip" data-step="0"><span class="waiting">${escapeHtml(BEFORE_FIRST_STEP)}</span></div>`;
  }
  const checked = step.index === lastIndex;
  const elsewhere =
    step.device !== side.device || step.tab !== side.tab
      ? `<span class="where">(${escapeHtml(step.label)})</span>`
      : '';
  const tag = checked
    ? `<span class="checked-tag">${escapeHtml(CHECKED_HERE)}</span>`
    : '';
  return `<div class="strip${checked ? ' checked' : ''}" data-step="${step.index}"><span class="n">${step.index}</span><span class="caption">${escapeHtml(step.caption)}</span>${elsewhere}${tag}</div>`;
}

/** Every overlay page one annotated MP4 needs, with `tokenCss` inlined. */
export function videoOverlayPages(
  plan: AnnotatedVideoPlan,
  tokenCss: string,
): VideoOverlayPages {
  const { width } = VIDEO_PANEL;
  const bandWidth = width * plan.sides.length;
  return {
    band: {
      html: page(
        tokenCss,
        'overlay-band',
        bandWidth,
        VIDEO_BAND_HEIGHT,
        bandHtml(plan.band),
      ),
      width: bandWidth,
      height: VIDEO_BAND_HEIGHT,
      transparent: false,
    },
    sides: plan.sides.map((side) => {
      const lastIndex = Math.max(0, ...side.steps.map((step) => step.index));
      return {
        side: side.side,
        label: {
          html: page(
            tokenCss,
            'overlay-label',
            width,
            VIDEO_LABEL_HEIGHT,
            `<span class="tag" data-side="${side.side}">${escapeHtml(labelText(side))}</span>`,
          ),
          width,
          height: VIDEO_LABEL_HEIGHT,
          transparent: true,
        },
        strips: captionWindows(side).map((window) => ({
          html: page(
            tokenCss,
            'overlay-strip',
            width,
            VIDEO_STRIP_HEIGHT,
            stripHtml(side, window, lastIndex),
          ),
          width,
          height: VIDEO_STRIP_HEIGHT,
          transparent: false,
        })),
      };
    }),
  };
}
