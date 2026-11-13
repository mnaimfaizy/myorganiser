/**
 * Draws a Storyboard model as one HTML page, 1280 px wide, for
 * `storyboard-render.ts` to screenshot in Chromium (PRD #1544). Real fonts
 * and any text, with colours and type from `@myorganiser/design-tokens`.
 *
 * The layout is the prototype the PRD's Further Notes settled: a dark band
 * with the scenario and its graded result, one side card per side, then one
 * row per step with Before beside After, each still cropped to its subject
 * (`storyboard-crop.ts`) with one outline and no dimming. A side that took
 * no step at a row is marked "no step", never left blank.
 *
 * Colours, type, spacing and radii come from the design tokens' generated
 * stylesheets (`roles.css`, `tokens.css`), which the caller reads
 * (`storyboard-palette.ts`) and this page inlines; every rule reaches them
 * through `var(--…)`, never a literal colour. The custom properties the page uses
 * are listed once, in `STORYBOARD_VARIABLES`, which the reader checks the
 * stylesheets against. A role is a bare HSL triple (ADR 0065), so a colour
 * is `hsl(var(--role))`.
 *
 * Pure: every string is escaped, and a still is referenced by the URL the
 * caller gives for it.
 */
import type { ScenarioResult } from './grade-scenarios.ts';
import { VIEWPORT } from './qa-run.ts';
import type { StepRecord } from './qa-scenario.ts';
import type { Side } from './qa-stack.ts';
import { SIDES } from './qa-switch.ts';
import { cropFor } from './storyboard-crop.ts';
import {
  MARK_TEXT,
  type Mark,
  type SideCard,
  type Storyboard,
  type StoryboardRow,
} from './storyboard.ts';

/** Every Semantic Role the page colours with, by its custom-property name. */
export const STORYBOARD_COLOURS = [
  'background',
  'foreground',
  'card',
  'border',
  'border-strong',
  'subtle',
  'foreground-supporting',
  'navy',
  'navy-foreground',
  'navy-muted-foreground',
  'success',
  'success-foreground',
  'success-soft',
  'success-text',
  'destructive',
  'destructive-foreground',
  'destructive-soft',
  'destructive-text',
  'warning',
  'warning-foreground',
  'warning-faint',
  'warning-text',
  'info',
  'info-foreground',
  'brand',
  'brand-foreground',
] as const;
type Colour = (typeof STORYBOARD_COLOURS)[number];

/** Every non-colour token the page uses: type, spacing and radii. */
export const STORYBOARD_TOKENS = [
  'font-body',
  'font-weight-semibold',
  'font-weight-bold',
  'type-title-size',
  'type-body-sm-size',
  'type-control-sm-size',
  'type-caption-size',
  'type-label-caps-size',
  'type-label-caps-tracking',
  'type-label-sm-size',
  'space-xs',
  'space-sm',
  'space-md',
  'space-lg',
  'space-2xl',
  'radius-sm',
  'radius-md',
] as const;
type Token = (typeof STORYBOARD_TOKENS)[number];

/** Every custom property the page uses: the tokens' stylesheets must declare each. */
export const STORYBOARD_VARIABLES: readonly string[] = [
  ...STORYBOARD_COLOURS,
  ...STORYBOARD_TOKENS,
];

/** A Semantic Role as a CSS colour (a role is a bare HSL triple, ADR 0065). */
const roleColour = (name: Colour): string => `hsl(var(--${name}))`;

/** A type, spacing or radius token as a CSS value. */
const token = (name: Token): string => `var(--${name})`;

/** The badge colours each graded result is shown in. */
const RESULT_TONE = {
  PASS: {
    background: roleColour('success'),
    color: roleColour('success-foreground'),
  },
  'FAIL: regression': {
    background: roleColour('destructive'),
    color: roleColour('destructive-foreground'),
  },
  'FAIL: pre-existing': {
    background: roleColour('warning'),
    color: roleColour('warning-foreground'),
  },
  'Not proven': {
    background: roleColour('warning'),
    color: roleColour('warning-foreground'),
  },
  'Left for a person': {
    background: roleColour('info'),
    color: roleColour('info-foreground'),
  },
} as const satisfies Record<
  ScenarioResult,
  { background: string; color: string }
>;

const MARK_TONE = {
  'as-expected': {
    background: roleColour('success-soft'),
    color: roleColour('success-text'),
  },
  'not-as-expected': {
    background: roleColour('destructive-soft'),
    color: roleColour('destructive-text'),
  },
} as const satisfies Record<Mark, { background: string; color: string }>;

/** How each side is named on the page, and which commit it ran on. */
const SIDE_WORDS = {
  before: { name: 'Before', commit: 'merge-base' },
  after: { name: 'After', commit: 'head' },
} as const satisfies Record<Side, { name: string; commit: string }>;

const sideTag = (side: Side): string => SIDE_WORDS[side].name.toUpperCase();

/** The line every Storyboard ends with, saying how its stills were made. */
export const STORYBOARD_FOOTER =
  'QA Accounts only · each still is cropped to its step’s subject, and the outline marks the element the step is about';

/** Shown on a still taken after settling timed out. */
export const NOT_SETTLED = 'not settled';

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

const pct = (part: number, whole: number): string =>
  `${((part / whole) * 100).toFixed(4)}%`;

const STYLE = `
*{box-sizing:border-box}
body{margin:0;width:${VIEWPORT.width}px;background:${roleColour('card')};color:${roleColour('foreground')};font-family:${token('font-body')};font-size:${token('type-body-sm-size')};line-height:1.4}
.band{background:${roleColour('navy')};color:${roleColour('navy-foreground')};padding:${token('space-md')} ${token('space-lg')}}
.band .top{display:flex;align-items:center;gap:${token('space-md')}}
.band h1{font-size:${token('type-title-size')};margin:0;font-weight:${token('font-weight-bold')}}
.result{font-weight:${token('font-weight-bold')};font-size:${token('type-control-sm-size')};padding:${token('space-xs')} ${token('space-sm')};border-radius:${token('radius-md')};white-space:nowrap}
.band .meta{color:${roleColour('navy-muted-foreground')};font-size:${token('type-caption-size')};margin-top:${token('space-xs')}}
.cards{display:grid;grid-template-columns:repeat(var(--columns),1fr);gap:${token('space-md')};padding:${token('space-md')} ${token('space-lg')}}
.card{border:1px solid ${roleColour('border')};border-radius:${token('radius-md')};padding:${token('space-sm')} ${token('space-md')}}
.card h2{margin:0 0 ${token('space-xs')};font-size:${token('type-label-caps-size')};letter-spacing:${token('type-label-caps-tracking')};color:${roleColour('foreground-supporting')}}
.card p{font-size:${token('type-control-sm-size')};margin:${token('space-xs')} 0}
.card b{font-weight:${token('font-weight-semibold')}}
.mark{display:inline-block;margin-top:${token('space-sm')};font-weight:${token('font-weight-semibold')};font-size:${token('type-caption-size')};padding:${token('space-xs')} ${token('space-sm')};border-radius:${token('radius-sm')}}
.row{display:grid;grid-template-columns:${token('space-2xl')} 1fr;gap:0 ${token('space-sm')};padding:${token('space-md')} ${token('space-lg')};border-top:1px solid ${roleColour('border')}}
.row .n{grid-row:span 2;font-size:${token('type-title-size')};font-weight:${token('font-weight-bold')};color:${roleColour('foreground-supporting')};text-align:center}
.row .caption{margin-bottom:${token('space-sm')}}
.row.checked{background:${roleColour('warning-faint')}}
.row .checked-tag{color:${roleColour('warning-text')};font-weight:${token('font-weight-semibold')};font-size:${token('type-caption-size')};margin-left:${token('space-sm')}}
.stills{display:grid;grid-template-columns:repeat(var(--columns),1fr);gap:${token('space-md')}}
.still{position:relative;border:1px solid ${roleColour('border')};border-radius:${token('radius-md')};overflow:hidden;background:${roleColour('background')}}
.still img{position:absolute;max-width:none}
.outline{position:absolute;border:3px solid ${roleColour('warning')};border-radius:${token('radius-md')}}
.tags{position:absolute;left:${token('space-sm')};top:${token('space-sm')};display:flex;gap:${token('space-xs')}}
.label,.unsettled,.side-tag{font-size:${token('type-label-caps-size')};font-weight:${token('font-weight-semibold')};padding:${token('space-xs')} ${token('space-sm')};border-radius:${token('radius-sm')}}
.label{background:${roleColour('brand')};color:${roleColour('brand-foreground')}}
.unsettled{background:${roleColour('destructive')};color:${roleColour('destructive-foreground')}}
.side-tag{position:absolute;right:${token('space-sm')};top:${token('space-sm')};background:${roleColour('navy')};color:${roleColour('navy-foreground')};font-size:${token('type-label-sm-size')};letter-spacing:${token('type-label-caps-tracking')}}
.cell-caption{position:absolute;left:0;right:0;bottom:0;background:${roleColour('card')};color:${roleColour('foreground-supporting')};font-size:${token('type-caption-size')};padding:${token('space-xs')} ${token('space-sm')};border-top:1px solid ${roleColour('border')}}
.no-step{display:flex;align-items:center;justify-content:center;aspect-ratio:16/9;border:1px dashed ${roleColour('border-strong')};border-radius:${token('radius-md')};color:${roleColour('foreground-supporting')};font-size:${token('type-control-sm-size')};background:${roleColour('subtle')}}
.before-note{grid-column:2;margin-top:${token('space-xs')};color:${roleColour('foreground-supporting')};font-size:${token('type-control-sm-size')}}
.foot{padding:${token('space-sm')} ${token('space-lg')} ${token('space-md')};color:${roleColour('foreground-supporting')};font-size:${token('type-label-caps-size')};border-top:1px solid ${roleColour('border')}}
`;

function bandHtml(storyboard: Storyboard): string {
  const { id, title, result, commits, alike } = storyboard.band;
  const tone = RESULT_TONE[result];
  const meta = SIDES.map(
    (side) =>
      `${SIDE_WORDS[side].name} ${escapeHtml(shortSha(commits[side]))} (${SIDE_WORDS[side].commit})`,
  ).join(' · ');
  return `<header class="band"><div class="top"><h1>${escapeHtml(`${id} · ${title}`)}</h1><span class="result" style="background:${tone.background};color:${tone.color}">${escapeHtml(result)}</span></div><div class="meta">${alike ? `${escapeHtml(alike)} · ` : ''}${meta}</div></header>`;
}

function cardHtml(card: SideCard): string {
  const tone = MARK_TONE[card.mark];
  return `<section class="card" data-side="${card.side}"><h2>${sideTag(card.side)} · ${SIDE_WORDS[card.side].commit}</h2><p><b>Expected:</b> ${escapeHtml(card.expected)}</p><p><b>Observed:</b> ${escapeHtml(card.observed)}</p><span class="mark" data-mark="${card.mark}" style="background:${tone.background};color:${tone.color}">${escapeHtml(MARK_TEXT[card.mark])}</span></section>`;
}

function stillHtml(
  side: Side,
  step: StepRecord | null,
  rowCaption: string,
  stillUrl: (step: StepRecord) => string,
): string {
  if (step === null) {
    return `<div class="no-step" data-side="${side}">no step on ${sideTag(side)}</div>`;
  }
  const { crop, outline } = cropFor(step.subject);
  // The still is the full viewport; the crop is scaled to fill the cell.
  const image = `<img src="${escapeHtml(stillUrl(step))}" alt="" style="width:${pct(VIEWPORT.width, crop.width)};left:-${pct(crop.x, crop.width)};top:-${pct(crop.y, crop.height)}">`;
  const box = outline
    ? `<div class="outline" style="left:${pct(outline.x, crop.width)};top:${pct(outline.y, crop.height)};width:${pct(outline.width, crop.width)};height:${pct(outline.height, crop.height)}"></div>`
    : '';
  const ownCaption =
    step.caption === rowCaption
      ? ''
      : `<div class="cell-caption">${escapeHtml(step.caption)}</div>`;
  const unsettled =
    step.settled === false
      ? `<span class="unsettled">${NOT_SETTLED}</span>`
      : '';
  return `<div class="still" data-side="${side}" style="aspect-ratio:${crop.width}/${crop.height}">${image}${box}<span class="tags"><span class="label">${escapeHtml(step.label)}</span>${unsettled}</span><span class="side-tag">${sideTag(side)}</span>${ownCaption}</div>`;
}

/** The Before line a "Before and After alike" row carries for its step. */
export const BEFORE_SAME_STEP = 'Before: same step';

function beforeNoteHtml(row: StoryboardRow, caption: string): string {
  const before = row.cells.before;
  // Unequal step counts are a model problem, so no page is drawn with a
  // missing Before cell; this guard only keeps the type honest.
  if (before === null) return '';
  const text =
    before.caption === caption ? BEFORE_SAME_STEP : `Before: ${before.caption}`;
  return `<div class="before-note" data-side="before">${escapeHtml(text)}</div>`;
}

function rowHtml(
  row: StoryboardRow,
  columns: readonly Side[],
  alike: boolean,
  stillUrl: (step: StepRecord) => string,
): string {
  const caption = (row.cells.after ?? row.cells.before)?.caption ?? '';
  const checked = row.checked
    ? '<span class="checked-tag">◆ checked here</span>'
    : '';
  const stills = columns
    .map((side) => stillHtml(side, row.cells[side], caption, stillUrl))
    .join('');
  return `<section class="row${row.checked ? ' checked' : ''}"><div class="n">${row.index}</div><div class="caption">${escapeHtml(caption)}${checked}</div><div class="stills">${stills}</div>${alike ? beforeNoteHtml(row, caption) : ''}</section>`;
}

/**
 * The Storyboard as a standalone HTML page. `stillUrl` gives each step's
 * image source; `tokenCss` is the design tokens' stylesheets, inlined.
 */
export function storyboardHtml(
  storyboard: Storyboard,
  stillUrl: (step: StepRecord) => string,
  tokenCss: string,
): string {
  const { band, columns, sides, rows } = storyboard;
  // A stylesheet's text cannot close its own <style> element.
  const tokens = tokenCss.replaceAll('</', '<\\/');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(`${band.id} · ${band.title}`)}</title><style>${tokens}</style><style>${STYLE}</style></head><body style="--columns:${columns.length}">${bandHtml(storyboard)}<div class="cards">${sides.map(cardHtml).join('')}</div>${rows.map((row) => rowHtml(row, columns, band.alike !== undefined, stillUrl)).join('')}<footer class="foot">${escapeHtml(STORYBOARD_FOOTER)}</footer></body></html>`;
}
