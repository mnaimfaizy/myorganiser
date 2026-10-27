import * as React from 'react';

// The shield and check mark, in AppLogo's own 32 × 32 viewBox. Exported so a
// build script (e.g. tools/scripts/generate-web-app-icons.ts) can read the
// mark by name instead of pattern-matching this component's JSX.
export const SHIELD_PATH = 'M4 3 L28 3 L28 19 Q28 30 16 31 Q4 30 4 19 Z';
export const CHECK_PATH = 'M8 17 L13.5 22.5 L24 11';
export const CHECK_STROKE_WIDTH = 3;

export type AppLogoVariant = 'full' | 'icon';

export interface AppLogoProps {
  /** 'full' renders icon + wordmark; 'icon' renders the shield only. */
  variant?: AppLogoVariant;
  /** Height in pixels. Width scales proportionally. Defaults to 32. */
  height?: number;
  className?: string;
  'aria-hidden'?: boolean;
}

/**
 * MyOrganiser brand logo.
 *
 * - `variant="icon"` → shield only (square, suitable for favicons / collapsed sidebars)
 * - `variant="full"` → shield + "MyOrganiser" wordmark (default)
 *
 * Uses the brand gradient (purple → teal) and is fully accessible.
 */
export function AppLogo({
  variant = 'full',
  height = 32,
  className,
  'aria-hidden': ariaHidden,
}: AppLogoProps) {
  const uid = React.useId().replace(/:/g, '');
  const gradId = `mo-shield-grad-${uid}`;
  const shineId = `mo-shield-shine-${uid}`;

  const shieldIcon = (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      fill="none"
      role={ariaHidden ? undefined : 'img'}
      aria-label={ariaHidden ? undefined : 'MyOrganiser shield icon'}
      aria-hidden={ariaHidden}
      style={{ height, width: height, flexShrink: 0, display: 'block' }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7C3AED" />
          <stop offset="100%" stopColor="#0F766E" />
        </linearGradient>
        <radialGradient id={shineId} cx="35%" cy="25%" r="55%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={0.22} />
          <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
        </radialGradient>
      </defs>
      {/* Classic heraldic shield: flat top, straight sides, pointed base */}
      <path d={SHIELD_PATH} fill={`url(#${gradId})`} />
      <path d={SHIELD_PATH} fill={`url(#${shineId})`} />
      {/* Bold single checkmark – legible down to 16 × 16 */}
      <path
        d={CHECK_PATH}
        stroke="white"
        strokeWidth={CHECK_STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );

  if (variant === 'icon') {
    return (
      <span
        className={className}
        style={{ display: 'inline-flex', alignItems: 'center' }}
      >
        {shieldIcon}
      </span>
    );
  }

  // Calculate wordmark font size proportionally to the icon height
  const fontSize = Math.round(height * 0.6);
  const wordmarkHeight = height;

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: Math.round(height * 0.28),
      }}
      role={ariaHidden ? undefined : 'img'}
      aria-label={ariaHidden ? undefined : 'MyOrganiser'}
    >
      <span aria-hidden="true" style={{ display: 'inline-flex' }}>
        {React.cloneElement(shieldIcon, {
          'aria-hidden': true,
          role: undefined,
          'aria-label': undefined,
        } as React.SVGProps<SVGSVGElement>)}
      </span>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 140 ${wordmarkHeight}`}
        aria-hidden="true"
        style={{
          height: wordmarkHeight,
          width: 'auto',
          overflow: 'visible',
          display: 'block',
        }}
      >
        <text
          y={wordmarkHeight * 0.72}
          fontFamily="'Plus Jakarta Sans', 'Inter', ui-sans-serif, system-ui, sans-serif"
          fontSize={fontSize}
          letterSpacing="-0.4"
        >
          <tspan fontWeight="600" fill="#0F172A">
            My
          </tspan>
          <tspan fontWeight="800" fill="#0F172A">
            Organiser
          </tspan>
        </text>
      </svg>
    </span>
  );
}
