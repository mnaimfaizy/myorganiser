// @ts-check
/**
 * The Tailwind theme every web config shares: each Semantic Role, the named
 * type scale, the off-scale radii, every shadow and the two font stacks, read
 * from the CSS variables in generated/tokens.css and generated/roles.css. See
 * ADR 0065.
 *
 * It is one module rather than a block copied into apps/web and libs/web/ui so
 * that a new role is wired once. A role missing from one copy compiled to no
 * CSS there, silently — the failure ADR 0065 describes.
 *
 * Radius: Tailwind's own rounded-xl, rounded-2xl and rounded-full resolve to
 * the token scale (16, 24, pill), because generated/tokens.css redefines
 * --radius-xl and --radius-2xl. rounded-sm/md/lg are the shadcn steps each
 * config derives from --radius. So the 12px control radius gets its own name,
 * rounded-control, alongside the off-scale Web v2.0 radii.
 *
 * CommonJS and imported by path, never through the library index (see
 * src/index.ts).
 */
module.exports = {
  fontFamily: {
    display: 'var(--font-display)',
    body: 'var(--font-body)',
  },
  colors: {
    border: {
      DEFAULT: 'hsl(var(--border))',
      strong: 'hsl(var(--border-strong))',
      subtle: 'hsl(var(--border-subtle))',
    },
    input: 'hsl(var(--input))',
    ring: 'hsl(var(--ring))',
    background: 'hsl(var(--background))',
    foreground: {
      DEFAULT: 'hsl(var(--foreground))',
      secondary: 'hsl(var(--foreground-secondary))',
      supporting: 'hsl(var(--foreground-supporting))',
    },
    subtle: {
      DEFAULT: 'hsl(var(--subtle))',
      foreground: 'hsl(var(--subtle-foreground))',
    },
    inactive: 'hsl(var(--inactive))',
    primary: {
      DEFAULT: 'hsl(var(--primary))',
      foreground: 'hsl(var(--primary-foreground))',
      hover: 'hsl(var(--primary-hover))',
      pressed: 'hsl(var(--primary-pressed))',
    },
    secondary: {
      DEFAULT: 'hsl(var(--secondary))',
      foreground: 'hsl(var(--secondary-foreground))',
      hover: 'hsl(var(--secondary-hover))',
      pressed: 'hsl(var(--secondary-pressed))',
    },
    outline: {
      hover: 'hsl(var(--outline-hover))',
      pressed: 'hsl(var(--outline-pressed))',
    },
    ghost: {
      hover: 'hsl(var(--ghost-hover))',
      pressed: 'hsl(var(--ghost-pressed))',
    },
    destructive: {
      DEFAULT: 'hsl(var(--destructive))',
      foreground: 'hsl(var(--destructive-foreground))',
      hover: 'hsl(var(--destructive-hover))',
      pressed: 'hsl(var(--destructive-pressed))',
      soft: 'hsl(var(--destructive-soft))',
      faint: 'hsl(var(--destructive-faint))',
      edge: 'hsl(var(--destructive-edge))',
      text: 'hsl(var(--destructive-text))',
    },
    brand: {
      DEFAULT: 'hsl(var(--brand))',
      foreground: 'hsl(var(--brand-foreground))',
      hover: 'hsl(var(--brand-hover))',
      pressed: 'hsl(var(--brand-pressed))',
      soft: 'hsl(var(--brand-soft))',
      text: 'hsl(var(--brand-text))',
      'text-strong': 'hsl(var(--brand-text-strong))',
    },
    trust: {
      DEFAULT: 'hsl(var(--trust))',
      foreground: 'hsl(var(--trust-foreground))',
      soft: 'hsl(var(--trust-soft))',
      faint: 'hsl(var(--trust-faint))',
      edge: 'hsl(var(--trust-edge))',
      text: 'hsl(var(--trust-text))',
    },
    navy: {
      DEFAULT: 'hsl(var(--navy))',
      raised: 'hsl(var(--navy-raised))',
      foreground: 'hsl(var(--navy-foreground))',
      'muted-foreground': 'hsl(var(--navy-muted-foreground))',
      accent: 'hsl(var(--navy-accent))',
      trust: 'hsl(var(--navy-trust))',
    },
    cyan: {
      DEFAULT: 'hsl(var(--cyan))',
      foreground: 'hsl(var(--cyan-foreground))',
    },
    warning: {
      DEFAULT: 'hsl(var(--warning))',
      foreground: 'hsl(var(--warning-foreground))',
      soft: 'hsl(var(--warning-soft))',
      faint: 'hsl(var(--warning-faint))',
      edge: 'hsl(var(--warning-edge))',
      text: 'hsl(var(--warning-text))',
    },
    success: {
      DEFAULT: 'hsl(var(--success))',
      foreground: 'hsl(var(--success-foreground))',
      soft: 'hsl(var(--success-soft))',
      faint: 'hsl(var(--success-faint))',
      edge: 'hsl(var(--success-edge))',
      text: 'hsl(var(--success-text))',
    },
    muted: {
      DEFAULT: 'hsl(var(--muted))',
      foreground: 'hsl(var(--muted-foreground))',
    },
    accent: {
      DEFAULT: 'hsl(var(--accent))',
      foreground: 'hsl(var(--accent-foreground))',
    },
    popover: {
      DEFAULT: 'hsl(var(--popover))',
      foreground: 'hsl(var(--popover-foreground))',
    },
    card: {
      DEFAULT: 'hsl(var(--card))',
      foreground: 'hsl(var(--card-foreground))',
    },
  },
  borderRadius: {
    control: 'var(--radius-lg)',
    item: 'var(--radius-item)',
    'control-sm': 'var(--radius-control-sm)',
    menu: 'var(--radius-menu)',
    fab: 'var(--radius-fab)',
    panel: 'var(--radius-panel)',
  },
  boxShadow: {
    card: 'var(--shadow-card)',
    popover: 'var(--shadow-popover)',
    dialog: 'var(--shadow-dialog)',
    toast: 'var(--shadow-toast)',
    segment: 'var(--shadow-segment)',
    brand: 'var(--shadow-brand)',
  },
  fontSize: {
    display: [
      'var(--type-display-size)',
      {
        lineHeight: 'var(--type-display-line-height)',
        letterSpacing: 'var(--type-display-tracking)',
        fontWeight: 'var(--type-display-weight)',
      },
    ],
    'title-lg': [
      'var(--type-title-lg-size)',
      {
        lineHeight: 'var(--type-title-lg-line-height)',
        letterSpacing: 'var(--type-title-lg-tracking)',
        fontWeight: 'var(--type-title-lg-weight)',
      },
    ],
    title: [
      'var(--type-title-size)',
      {
        lineHeight: 'var(--type-title-line-height)',
        letterSpacing: 'var(--type-title-tracking)',
        fontWeight: 'var(--type-title-weight)',
      },
    ],
    body: [
      'var(--type-body-size)',
      {
        lineHeight: 'var(--type-body-line-height)',
        letterSpacing: 'var(--type-body-tracking)',
        fontWeight: 'var(--type-body-weight)',
      },
    ],
    'body-sm': [
      'var(--type-body-sm-size)',
      {
        lineHeight: 'var(--type-body-sm-line-height)',
        letterSpacing: 'var(--type-body-sm-tracking)',
        fontWeight: 'var(--type-body-sm-weight)',
      },
    ],
    'label-caps': [
      'var(--type-label-caps-size)',
      {
        lineHeight: 'var(--type-label-caps-line-height)',
        letterSpacing: 'var(--type-label-caps-tracking)',
        fontWeight: 'var(--type-label-caps-weight)',
      },
    ],
    caption: [
      'var(--type-caption-size)',
      {
        lineHeight: 'var(--type-caption-line-height)',
        letterSpacing: 'var(--type-caption-tracking)',
        fontWeight: 'var(--type-caption-weight)',
      },
    ],
    'label-sm': [
      'var(--type-label-sm-size)',
      {
        lineHeight: 'var(--type-label-sm-line-height)',
        letterSpacing: 'var(--type-label-sm-tracking)',
        fontWeight: 'var(--type-label-sm-weight)',
      },
    ],
    'control-sm': [
      'var(--type-control-sm-size)',
      {
        lineHeight: 'var(--type-control-sm-line-height)',
        letterSpacing: 'var(--type-control-sm-tracking)',
        fontWeight: 'var(--type-control-sm-weight)',
      },
    ],
    input: [
      'var(--type-input-size)',
      {
        lineHeight: 'var(--type-input-line-height)',
        letterSpacing: 'var(--type-input-tracking)',
        fontWeight: 'var(--type-input-weight)',
      },
    ],
    value: [
      'var(--type-value-size)',
      {
        lineHeight: 'var(--type-value-line-height)',
        letterSpacing: 'var(--type-value-tracking)',
        fontWeight: 'var(--type-value-weight)',
      },
    ],
  },
};
