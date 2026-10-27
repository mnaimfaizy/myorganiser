/**
 * Plans the mobile app icon for iOS and Android from the BrandMark shield.
 * Shared by the generator (tools/scripts/generate-mobile-app-icon.ts), which
 * writes every output and rasterises the PNGs through Chromium, and the check
 * (tools/scripts/check-mobile-app-icon.ts), which compares the text outputs
 * with the committed files — so the check builds exactly what the generator
 * would. Nothing here launches a browser.
 *
 * The icon has one source and it is not in this file: the shield and check
 * paths are read out of libs/mobile/ui/src/components/BrandMark.tsx, and every
 * colour out of the design-token build. This module only decides how the mark
 * sits on each platform's canvas, and throws if it cannot find a value it
 * reads.
 *
 * The outputs:
 * - apps/mobile/app-icon/*.svg — the 1024 × 1024 masters (light, dark, tinted).
 * - iOS AppIcon.appiconset — one 1024 PNG per appearance plus Contents.json;
 *   Xcode derives every size from them.
 * - Android adaptive icon — foreground and monochrome vector drawables, the
 *   background colour, and the mipmap-anydpi-v26 entries.
 * - Android legacy mipmap PNGs, for API 24–25, which predate adaptive icons.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const BRAND_MARK = 'libs/mobile/ui/src/components/BrandMark.tsx';
export const TOKENS = 'libs/design-tokens/src/generated/tokens.ts';
export const ROLES = 'libs/design-tokens/src/generated/roles.ts';
const MASTERS = 'apps/mobile/app-icon';
const APP_ICON_SET =
  'apps/mobile/ios/Mobile/Images.xcassets/AppIcon.appiconset';
const ANDROID_RES = 'apps/mobile/android/app/src/main/res';

// The shield's bounding box in BrandMark's 32 × 32 viewBox: x 4–28, y 3–31.
const SHIELD = { centerX: 16, centerY: 17, top: 3, bottom: 31, height: 28 };

export interface MobileAppIconSources {
  /** The mark, in BrandMark's own 32 × 32 viewBox. */
  shieldPath: string;
  checkPath: string;
  checkStrokeWidth: number;
  brand: {
    gradientTop: string;
    gradientBottom: string;
    check: string;
  };
  lightBackground: string;
  darkBackground: string;
}

/** Reads the shield and the colours the icon is drawn from. */
function readSources(root: string): MobileAppIconSources {
  const readOrFail = (path: string, pattern: RegExp, what: string): string => {
    const match = readFileSync(resolve(root, path), 'utf8').match(pattern);
    if (!match) {
      throw new Error(`Could not read ${what} from ${path}`);
    }
    return match[1];
  };
  const token = (name: string): string =>
    readOrFail(
      TOKENS,
      new RegExp(`export const ${name} = "(#[0-9a-fA-F]{6})"`),
      name,
    );
  const backgroundRole = (mode: string): string =>
    readOrFail(
      ROLES,
      new RegExp(
        `export const ${mode} = \\{\\s*background: "(#[0-9a-fA-F]{6})"`,
      ),
      `${mode}.background`,
    );

  return {
    // The mark, in BrandMark's own 32 × 32 viewBox.
    shieldPath: readOrFail(BRAND_MARK, /d="(M[^"]+Z)"/, 'the shield path'),
    checkPath: readOrFail(BRAND_MARK, /d="(M[^"Z]+)"/, 'the check path'),
    checkStrokeWidth: Number(
      readOrFail(
        BRAND_MARK,
        /strokeWidth=\{(\d+(?:\.\d+)?)\}/,
        'the check width',
      ),
    ),
    brand: {
      gradientTop: token('colorSecondary'),
      gradientBottom: token('colorTertiary'),
      check: token('colorOnSecondary'),
    },
    lightBackground: backgroundRole('roleLight'),
    darkBackground: backgroundRole('roleDark'),
  };
}

export type MobileAppIconAppearance = 'light' | 'dark' | 'tinted';
export type MobileAppIconPlateShape = 'full' | 'rounded' | 'circle';

interface AppearanceStyle {
  plate: string;
  gradient: [string, string];
  check: string;
}

/**
 * How each appearance colours the mark and its plate. The shield keeps the
 * brand gradient in light and dark — it is the logo — and only the plate
 * follows the mode. Tinted is the greyscale image iOS recolours itself: it
 * reads luminance, so the gradient becomes white fading to grey on black.
 */
const appearances = ({
  brand,
  lightBackground,
  darkBackground,
}: MobileAppIconSources): Record<MobileAppIconAppearance, AppearanceStyle> => ({
  light: {
    plate: lightBackground,
    gradient: [brand.gradientTop, brand.gradientBottom],
    check: brand.check,
  },
  dark: {
    plate: darkBackground,
    gradient: [brand.gradientTop, brand.gradientBottom],
    check: brand.check,
  },
  tinted: {
    plate: '#000000',
    gradient: ['#ffffff', '#9ca3af'],
    check: '#000000',
  },
});

// The shield's height as a share of the plate it sits on.
const SHIELD_SHARE = 0.57;

interface IconSvgOptions {
  size: number;
  appearance: MobileAppIconAppearance;
  plateShape: MobileAppIconPlateShape;
}

/**
 * One icon as SVG. `plateShape` is `full` (iOS, which masks the corners
 * itself), or `rounded` / `circle` for the Android legacy icons, which carry
 * their own shape on a transparent canvas.
 */
function iconSvg(
  sources: MobileAppIconSources,
  { size, appearance, plateShape }: IconSvgOptions,
): string {
  const { shieldPath, checkPath, checkStrokeWidth } = sources;
  const { plate, gradient, check } = appearances(sources)[appearance];
  const inset = plateShape === 'full' ? 0 : size / 24;
  const plateSize = size - inset * 2;
  const scale = (plateSize * SHIELD_SHARE) / SHIELD.height;
  const round = (value: number): number => Number(value.toFixed(3));
  const plateAttributes = {
    full: '',
    rounded: ` rx="${round(plateSize * 0.2)}"`,
    circle: ` rx="${round(plateSize / 2)}"`,
  }[plateShape];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="shield" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${gradient[0]}"/>
      <stop offset="1" stop-color="${gradient[1]}"/>
    </linearGradient>
  </defs>
  <rect x="${round(inset)}" y="${round(inset)}" width="${round(plateSize)}" height="${round(plateSize)}"${plateAttributes} fill="${plate}"/>
  <g transform="translate(${round(size / 2 - SHIELD.centerX * scale)} ${round(size / 2 - SHIELD.centerY * scale)}) scale(${round(scale)})">
    <path d="${shieldPath}" fill="url(#shield)"/>
    <path d="${checkPath}" fill="none" stroke="${check}" stroke-width="${checkStrokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>
`;
}

// ---------------------------------------------------------------- Android --

// An adaptive icon layer is 108dp; only the centre 66dp circle is guaranteed
// to survive the launcher's mask. At 1.5 the shield is 36 × 42dp and its
// corners sit 27.7dp from the centre, inside that circle's 33dp radius.
const ADAPTIVE = { viewport: 108, scale: 1.5 };

function vectorDrawable(paths: string): string {
  const { viewport, scale } = ADAPTIVE;
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by tools/scripts/generate-mobile-app-icon.mjs from the
     BrandMark shield. Do not edit; re-run yarn mobile:app-icon:generate. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="${viewport}dp"
    android:height="${viewport}dp"
    android:viewportWidth="${viewport}"
    android:viewportHeight="${viewport}">
    <group
        android:scaleX="${scale}"
        android:scaleY="${scale}"
        android:translateX="${viewport / 2 - SHIELD.centerX * scale}"
        android:translateY="${viewport / 2 - SHIELD.centerY * scale}">
${paths}
    </group>
</vector>
`;
}

const strokeAttributes = (
  width: number,
): string => `android:strokeWidth="${width}"
            android:strokeLineCap="round"
            android:strokeLineJoin="round"`;

const foregroundDrawable = ({
  shieldPath,
  checkPath,
  checkStrokeWidth,
  brand,
}: MobileAppIconSources): string =>
  vectorDrawable(`        <path android:pathData="${shieldPath}">
            <aapt:attr name="android:fillColor">
                <gradient
                    android:type="linear"
                    android:startX="${SHIELD.centerX}"
                    android:startY="${SHIELD.top}"
                    android:endX="${SHIELD.centerX}"
                    android:endY="${SHIELD.bottom}"
                    android:startColor="${brand.gradientTop.toUpperCase()}"
                    android:endColor="${brand.gradientBottom.toUpperCase()}" />
            </aapt:attr>
        </path>
        <path
            android:pathData="${checkPath}"
            android:strokeColor="${brand.check.toUpperCase()}"
            ${strokeAttributes(checkStrokeWidth)} />`);

// A themed icon is drawn by the launcher in one colour from this layer's
// alpha, so a filled shield would swallow the check. The shield is outlined
// instead, slightly lighter than the check it carries.
const monochromeDrawable = ({
  shieldPath,
  checkPath,
  checkStrokeWidth,
}: MobileAppIconSources): string =>
  vectorDrawable(`        <path
            android:pathData="${shieldPath}"
            android:strokeColor="#FFFFFF"
            ${strokeAttributes(2.5)} />
        <path
            android:pathData="${checkPath}"
            android:strokeColor="#FFFFFF"
            ${strokeAttributes(checkStrokeWidth)} />`);

const ADAPTIVE_ICON = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
`;

const launcherBackground = ({
  lightBackground,
}: Pick<
  MobileAppIconSources,
  'lightBackground'
>): string => `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- The light background Semantic Role, written by
         tools/scripts/generate-mobile-app-icon.mjs. It has no values-night
         twin on purpose: a launcher icon does not follow the colour mode. -->
    <color name="ic_launcher_background">${lightBackground.toUpperCase()}</color>
</resources>
`;

const LEGACY_DENSITIES: Record<string, number> = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};

// -------------------------------------------------------------------- iOS --

const IOS_SIZE = 1024;
const IOS_IMAGES: Array<{
  appearance: MobileAppIconAppearance;
  filename: string;
}> = [
  { appearance: 'light', filename: 'AppIcon.png' },
  { appearance: 'dark', filename: 'AppIcon-Dark.png' },
  { appearance: 'tinted', filename: 'AppIcon-Tinted.png' },
];

const appIconContents = (): string =>
  `${JSON.stringify(
    {
      images: IOS_IMAGES.map(({ appearance, filename }) => ({
        ...(appearance !== 'light' && {
          appearances: [{ appearance: 'luminosity', value: appearance }],
        }),
        filename,
        idiom: 'universal',
        platform: 'ios',
        size: `${IOS_SIZE}x${IOS_SIZE}`,
      })),
      info: { author: 'xcode', version: 1 },
    },
    null,
    2,
  )}\n`;

// ------------------------------------------------------------------- plan --

export interface MobileAppIconFile {
  path: string;
  content: string;
}

export interface MobileAppIconRaster {
  path: string;
  svg: string;
  size: number;
  opaque: boolean;
}

export interface MobileAppIconPlan {
  /** The text outputs, written as is. */
  files: MobileAppIconFile[];
  /**
   * The PNGs the generator renders through Chromium; `opaque` ones must
   * carry no alpha channel (App Store Connect rejects an iOS icon that
   * does). Paths are repo-relative.
   */
  rasters: MobileAppIconRaster[];
}

/** Every output, built from the sources under `root`, without a browser. */
export function planMobileAppIcon({
  root,
}: {
  root: string;
}): MobileAppIconPlan {
  const sources = readSources(root);
  const files: MobileAppIconFile[] = [];
  const rasters: MobileAppIconRaster[] = [];

  for (const { appearance, filename } of IOS_IMAGES) {
    const svg = iconSvg(sources, {
      size: IOS_SIZE,
      appearance,
      plateShape: 'full',
    });
    files.push({ path: `${MASTERS}/app-icon-${appearance}.svg`, content: svg });
    rasters.push({
      path: `${APP_ICON_SET}/${filename}`,
      svg,
      size: IOS_SIZE,
      opaque: true,
    });
  }
  files.push({
    path: `${APP_ICON_SET}/Contents.json`,
    content: appIconContents(),
  });

  files.push(
    {
      path: `${ANDROID_RES}/drawable/ic_launcher_foreground.xml`,
      content: foregroundDrawable(sources),
    },
    {
      path: `${ANDROID_RES}/drawable/ic_launcher_monochrome.xml`,
      content: monochromeDrawable(sources),
    },
    {
      path: `${ANDROID_RES}/values/ic_launcher_background.xml`,
      content: launcherBackground(sources),
    },
  );
  for (const name of ['ic_launcher', 'ic_launcher_round']) {
    files.push({
      path: `${ANDROID_RES}/mipmap-anydpi-v26/${name}.xml`,
      content: ADAPTIVE_ICON,
    });
  }
  for (const [density, size] of Object.entries(LEGACY_DENSITIES)) {
    for (const [name, plateShape] of [
      ['ic_launcher', 'rounded'],
      ['ic_launcher_round', 'circle'],
    ] as const satisfies ReadonlyArray<[string, MobileAppIconPlateShape]>) {
      rasters.push({
        path: `${ANDROID_RES}/mipmap-${density}/${name}.png`,
        svg: iconSvg(sources, { size, appearance: 'light', plateShape }),
        size,
        opaque: false,
      });
    }
  }

  return { files, rasters };
}
