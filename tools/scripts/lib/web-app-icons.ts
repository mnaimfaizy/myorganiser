/**
 * Renders the web app's installable icons from the AppLogo shield and the
 * design-token build. Shared by the generator
 * (tools/scripts/generate-web-app-icons.mjs), which writes them, and the
 * check (tools/scripts/check-web-app-icons.ts), which compares them with the
 * committed files — so the check renders exactly what the generator would.
 *
 * The icon has one source and it is not in this file: the shield and check
 * paths are read out of the exported `SHIELD_PATH` / `CHECK_PATH` /
 * `CHECK_STROKE_WIDTH` constants in
 * libs/web/ui/src/lib/components/AppLogo/AppLogo.tsx, and every colour out of
 * the design-token build. This module only decides how the mark sits on each
 * icon's canvas, and throws if it cannot find a value it reads.
 *
 * The icons, in apps/web/public/icons/:
 * - icon-192.png, icon-512.png — transparent "any"-purpose icons, the shield
 *   at the same proportions as the existing favicon.
 * - icon-512-maskable.png — opaque full-bleed background with the shield kept
 *   inside the maskable-icon safe zone (a centred circle, 40% of the icon's
 *   radius per the Web App Manifest spec; this module targets 36% for margin).
 * - apple-touch-icon.png — opaque full-bleed background, 180 × 180, the size
 *   iOS expects for a Home Screen icon.
 *
 * Rasterising goes through `sharp`, not a browser: every icon here is a flat
 * shape plus a linear gradient, which `sharp`'s SVG rasteriser renders
 * exactly, so there is no reason to pay for Chromium as
 * generate-mobile-app-icon.mjs and generate-og-image.mjs do.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

export const APP_LOGO = 'libs/web/ui/src/lib/components/AppLogo/AppLogo.tsx';
export const TOKENS = 'libs/design-tokens/src/generated/tokens.ts';
export const ICONS_DIR = 'apps/web/public/icons';

// The shield's bounding box in AppLogo's 32 × 32 viewBox: x 4–28, y 3–31.
const SHIELD = { centerX: 16, centerY: 17, top: 3, right: 28, height: 28 };
// Farthest a shield corner sits from its own centre — the top corners, not
// the pointed base.
const SHIELD_CORNER_RADIUS = Math.hypot(
  SHIELD.right - SHIELD.centerX,
  SHIELD.top - SHIELD.centerY,
);

/** A canvas with nothing but the shield on it, at the favicon's own scale. */
export interface PlainIconSpec {
  filename: string;
  size: number;
  variant: 'plain';
}

/** An opaque full-bleed canvas with the shield kept inside its safe zone. */
export interface PlatedIconSpec {
  filename: string;
  size: number;
  variant: 'plated';
  safeZoneFraction: number;
}

export type IconSpec = PlainIconSpec | PlatedIconSpec;

export const ICONS: IconSpec[] = [
  { filename: 'icon-192.png', size: 192, variant: 'plain' },
  { filename: 'icon-512.png', size: 512, variant: 'plain' },
  // Web App Manifest spec: a maskable icon's safe zone is a centred circle
  // of 40% of the icon's radius. Target 36% to leave margin under that cap.
  {
    filename: 'icon-512-maskable.png',
    size: 512,
    variant: 'plated',
    safeZoneFraction: 0.36,
  },
  // Apple's Home Screen icon size; iOS rounds the corners itself.
  {
    filename: 'apple-touch-icon.png',
    size: 180,
    variant: 'plated',
    safeZoneFraction: 0.4,
  },
];

/** The brand colours read out of the design-token build, keyed by icon part. */
export interface IconBrandColors {
  gradientTop: string;
  gradientBottom: string;
  check: string;
  plate: string;
}

/** Everything `iconSvg` needs, read once from AppLogo and the token build. */
export interface IconSources {
  shieldPath: string;
  checkPath: string;
  checkStrokeWidth: number;
  brand: IconBrandColors;
}

/** Reads the shield constants and colour tokens the icons are drawn from. */
function readSources(root: string): IconSources {
  const readOrFail = (path: string, pattern: RegExp, what: string): string => {
    const match = readFileSync(resolve(root, path), 'utf8').match(pattern);
    const captured = match?.[1];
    if (captured === undefined) {
      throw new Error(`Could not read ${what} from ${path}`);
    }
    return captured;
  };
  const token = (name: string): string =>
    readOrFail(
      TOKENS,
      new RegExp(`export const ${name} = "(#[0-9a-fA-F]{6})"`),
      name,
    );

  // Read by name, not by position, so reordering or restyling AppLogo's JSX
  // can't silently bind these to the wrong path.
  return {
    shieldPath: readOrFail(
      APP_LOGO,
      /export const SHIELD_PATH = '([^']+)';/,
      'the shield path',
    ),
    checkPath: readOrFail(
      APP_LOGO,
      /export const CHECK_PATH = '([^']+)';/,
      'the check path',
    ),
    checkStrokeWidth: Number(
      readOrFail(
        APP_LOGO,
        /export const CHECK_STROKE_WIDTH = (\d+(?:\.\d+)?);/,
        'the check stroke width',
      ),
    ),
    brand: {
      gradientTop: token('colorSecondary'),
      gradientBottom: token('colorTertiary'),
      check: token('colorOnSecondary'),
      plate: token('colorSurface'),
    },
  };
}

/**
 * One icon as SVG.
 * - `plain`: transparent canvas, the shield at the same scale the existing
 *   favicon uses (fills almost the whole square).
 * - `plated`: an opaque full-bleed background, the shield scaled down so its
 *   farthest corner stays inside `safeZoneFraction` of the canvas radius.
 */
function iconSvg(sources: IconSources, icon: IconSpec): string {
  const { size, variant } = icon;
  const { shieldPath, checkPath, checkStrokeWidth, brand } = sources;
  const scale =
    variant === 'plain'
      ? size / 32
      : (size * icon.safeZoneFraction) / SHIELD_CORNER_RADIUS;
  const round = (value: number): number => Number(value.toFixed(3));
  const translateX = round(size / 2 - SHIELD.centerX * scale);
  const translateY = round(size / 2 - SHIELD.centerY * scale);

  const background =
    variant === 'plain'
      ? ''
      : `<rect x="0" y="0" width="${size}" height="${size}" fill="${brand.plate}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="shield" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${brand.gradientTop}"/>
      <stop offset="1" stop-color="${brand.gradientBottom}"/>
    </linearGradient>
  </defs>
  ${background}
  <g transform="translate(${translateX} ${translateY}) scale(${round(scale)})">
    <path d="${shieldPath}" fill="url(#shield)"/>
    <path d="${checkPath}" fill="none" stroke="${brand.check}" stroke-width="${checkStrokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>
`;
}

/** One rendered icon; `path` is repo-relative. */
export interface RenderedIcon {
  path: string;
  png: Buffer;
}

/** Renders every icon from the sources under `root`, in memory. */
export async function renderWebAppIcons({
  root,
}: {
  root: string;
}): Promise<RenderedIcon[]> {
  const sources = readSources(root);
  return Promise.all(
    ICONS.map(async (icon) => ({
      path: `${ICONS_DIR}/${icon.filename}`,
      png: await sharp(Buffer.from(iconSvg(sources, icon)))
        .png()
        .toBuffer(),
    })),
  );
}
