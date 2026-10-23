import { roleDark, roleLight } from '@myorganiser/design-tokens';
import type { Theme, ThemeColors } from '@myorganiser/mobile/ui';
import { navigationTheme } from './navigationTheme';

/**
 * Build a minimal fixture theme for testing.
 *
 * Sentinel colour values ensure the mapping catches slot errors: the real light
 * theme has `card` and `raisedSurface` both as `#ffffff`, so asserting equality
 * would pass if the implementation wrongly read `card` instead of `raisedSurface`.
 * Distinct fixtures catch that mistake; role correctness itself is covered by
 * `libs/mobile/ui/src/theme.test.ts`.
 *
 * Type scale steps use the real font weights (body 400, labelCaps 600, title 700,
 * display 800) so a step re-weighted in tokens.json fails a test here rather than
 * silently disagreeing with the family it is paired with.
 */
function buildFixtureTheme(mode: 'light' | 'dark'): Theme {
  // Start from the real roles so every Semantic Role has a value, then
  // overwrite the ones the mapping reads with distinct sentinels.
  const colors: ThemeColors = {
    ...(mode === 'light' ? roleLight : roleDark),
    background: '#bg0000',
    foreground: '#fg0000',
    card: '#card000', // distinct from raisedSurface to catch mapping errors
    cardForeground: '#cgf000',
    popover: '#pop000',
    popoverForeground: '#pgf000',
    muted: '#muted00',
    mutedForeground: '#mfg000',
    border: '#border0',
    input: '#input00',
    primary: '#prim00',
    primaryForeground: '#pfg000',
    secondary: '#sec000',
    secondaryForeground: '#sfg000',
    accent: '#accnt00',
    accentForeground: '#afg000',
    destructive: '#destr00',
    destructiveForeground: '#dfg000',
    warning: '#warn00',
    warningForeground: '#wfg000',
    success: '#succ00',
    successForeground: '#sfg00',
    ring: '#ring00',
    brand: '#brand00',
    brandForeground: '#bfg000',
    cyan: '#cyan00',
    cyanForeground: '#cfg000',
    sidebarBackground: '#sbg000',
    sidebarForeground: '#sfg000',
    sidebarPrimary: '#spr00',
    sidebarPrimaryForeground: '#spfg0',
    sidebarAccent: '#sac000',
    sidebarAccentForeground: '#safg0',
    sidebarBorder: '#sbdr00',
    sidebarRing: '#srng00',
    errorText: '#errtxt0', // distinct from destructive to catch mapping errors
    errorEdge: '#erredge', // new role
    focus: '#focus00',
    controlEdge: '#ctrlEdge',
    raisedSurface: '#raised0',
    scrim: '#scrim0',
  };

  const type = {
    body: {
      fontFamily: 'body-font',
      fontSize: 14,
      lineHeight: 20,
      letterSpacing: 0,
    },
    labelCaps: {
      fontFamily: 'labelcaps-font',
      fontSize: 12,
      lineHeight: 16,
      letterSpacing: 0.5,
      textTransform: 'uppercase' as const,
    },
    title: {
      fontFamily: 'title-font',
      fontSize: 28,
      lineHeight: 34,
      letterSpacing: 0,
    },
    display: {
      fontFamily: 'display-font',
      fontSize: 57,
      lineHeight: 64,
      letterSpacing: 0,
    },
    // Placeholder steps not read by navigationTheme
    bodySm: {
      fontFamily: 'bodysm-font',
      fontSize: 12,
      lineHeight: 16,
      letterSpacing: 0.25,
    },
    titleLg: {
      fontFamily: 'titlelg-font',
      fontSize: 32,
      lineHeight: 40,
      letterSpacing: 0,
    },
    caption: {
      fontFamily: 'caption-font',
      fontSize: 12,
      lineHeight: 16,
      letterSpacing: 0.4,
    },
  };

  return {
    mode,
    colors,
    spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, gutter: 16 },
    radii: { sm: 4, md: 8, lg: 12, xl: 16, '2xl': 20, full: 999 },
    type,
    shadows: {
      card: {
        shadowColor: 'rgb(0, 0, 0)',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 1,
      },
      popover: {
        shadowColor: 'rgb(0, 0, 0)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 4,
      },
    },
  };
}

describe('navigationTheme', () => {
  describe('dark mode indicator', () => {
    it('sets dark=true when theme mode is dark', () => {
      const darkTheme = buildFixtureTheme('dark');
      const result = navigationTheme(darkTheme, 'ios');
      expect(result.dark).toBe(true);
    });

    it('sets dark=false when theme mode is light', () => {
      const lightTheme = buildFixtureTheme('light');
      const result = navigationTheme(lightTheme, 'ios');
      expect(result.dark).toBe(false);
    });
  });

  describe('colour mapping', () => {
    it('maps brand to primary', () => {
      const theme = buildFixtureTheme('light');
      const result = navigationTheme(theme, 'ios');
      expect(result.colors.primary).toBe('#brand00');
    });

    it('maps background to background', () => {
      const theme = buildFixtureTheme('light');
      const result = navigationTheme(theme, 'ios');
      expect(result.colors.background).toBe('#bg0000');
    });

    it('maps raisedSurface to card (not the card role)', () => {
      const theme = buildFixtureTheme('light');
      const result = navigationTheme(theme, 'ios');
      expect(result.colors.card).toBe('#raised0');
      expect(result.colors.card).not.toBe('#card000');
    });

    it('maps foreground to text', () => {
      const theme = buildFixtureTheme('light');
      const result = navigationTheme(theme, 'ios');
      expect(result.colors.text).toBe('#fg0000');
    });

    it('maps border to border', () => {
      const theme = buildFixtureTheme('light');
      const result = navigationTheme(theme, 'ios');
      expect(result.colors.border).toBe('#border0');
    });

    it('maps destructive to notification (not the errorText role)', () => {
      const theme = buildFixtureTheme('light');
      const result = navigationTheme(theme, 'ios');
      expect(result.colors.notification).toBe('#destr00');
      expect(result.colors.notification).not.toBe('#errtxt0');
    });

    it('returns exactly six colour slots with no undefined values', () => {
      const theme = buildFixtureTheme('light');
      const result = navigationTheme(theme, 'ios');
      const colorKeys = Object.keys(result.colors);
      expect(colorKeys).toEqual([
        'primary',
        'background',
        'card',
        'text',
        'border',
        'notification',
      ]);
      expect(
        colorKeys.every(
          (key) =>
            result.colors[key as keyof typeof result.colors] !== undefined,
        ),
      ).toBe(true);
    });
  });

  describe('font mapping', () => {
    it('maps body to regular with fontWeight="400"', () => {
      const theme = buildFixtureTheme('light');
      const result = navigationTheme(theme, 'ios');
      expect(result.fonts.regular.fontFamily).toBe(theme.type.body.fontFamily);
      expect(result.fonts.regular.fontWeight).toBe('400');
    });

    it('maps labelCaps to medium with fontWeight="600"', () => {
      const theme = buildFixtureTheme('light');
      const result = navigationTheme(theme, 'ios');
      expect(result.fonts.medium.fontFamily).toBe(
        theme.type.labelCaps.fontFamily,
      );
      expect(result.fonts.medium.fontWeight).toBe('600');
    });

    it('maps title to bold with fontWeight="700" on iOS', () => {
      const theme = buildFixtureTheme('light');
      const result = navigationTheme(theme, 'ios');
      expect(result.fonts.bold.fontFamily).toBe(theme.type.title.fontFamily);
      expect(result.fonts.bold.fontWeight).toBe('700');
    });

    it('maps title to bold with fontWeight="400" on Android', () => {
      const theme = buildFixtureTheme('light');
      const result = navigationTheme(theme, 'android');
      expect(result.fonts.bold.fontFamily).toBe(theme.type.title.fontFamily);
      expect(result.fonts.bold.fontWeight).toBe('400');
    });

    it('maps display to heavy with fontWeight="800" on iOS', () => {
      const theme = buildFixtureTheme('light');
      const result = navigationTheme(theme, 'ios');
      expect(result.fonts.heavy.fontFamily).toBe(theme.type.display.fontFamily);
      expect(result.fonts.heavy.fontWeight).toBe('800');
    });

    it('maps display to heavy with fontWeight="400" on Android', () => {
      const theme = buildFixtureTheme('light');
      const result = navigationTheme(theme, 'android');
      expect(result.fonts.heavy.fontFamily).toBe(theme.type.display.fontFamily);
      expect(result.fonts.heavy.fontWeight).toBe('400');
    });
  });

  describe('platform-specific weight behavior', () => {
    const theme = buildFixtureTheme('light');

    it('uses real weights (700, 800) on iOS for bold and heavy', () => {
      const iosResult = navigationTheme(theme, 'ios');
      expect(iosResult.fonts.bold.fontWeight).toBe('700');
      expect(iosResult.fonts.heavy.fontWeight).toBe('800');
    });

    it('uses weight 400 on Android for bold and heavy to avoid the React Native bold lookup', () => {
      const androidResult = navigationTheme(theme, 'android');
      expect(androidResult.fonts.bold.fontWeight).toBe('400');
      expect(androidResult.fonts.heavy.fontWeight).toBe('400');
    });

    it('keeps fontFamily the same on both platforms for bold and heavy', () => {
      const iosResult = navigationTheme(theme, 'ios');
      const androidResult = navigationTheme(theme, 'android');
      expect(iosResult.fonts.bold.fontFamily).toBe(
        androidResult.fonts.bold.fontFamily,
      );
      expect(iosResult.fonts.heavy.fontFamily).toBe(
        androidResult.fonts.heavy.fontFamily,
      );
    });
  });

  describe('immutability', () => {
    it('does not mutate the input theme', () => {
      const theme = buildFixtureTheme('light');
      const themeBefore = JSON.stringify(theme);
      navigationTheme(theme, 'ios');
      const themeAfter = JSON.stringify(theme);
      expect(themeAfter).toBe(themeBefore);
    });
  });

  describe('end-to-end mapping consistency across modes', () => {
    it('applies the same colour and font mappings in both light and dark modes on the same platform', () => {
      const lightTheme = buildFixtureTheme('light');
      const darkTheme = buildFixtureTheme('dark');
      const lightResult = navigationTheme(lightTheme, 'ios');
      const darkResult = navigationTheme(darkTheme, 'ios');

      // Colours should map identically (same sentinel values)
      expect(lightResult.colors).toEqual(darkResult.colors);

      // Fonts should map identically (except weights on Android)
      expect(lightResult.fonts.regular).toEqual(darkResult.fonts.regular);
      expect(lightResult.fonts.medium).toEqual(darkResult.fonts.medium);
      expect(lightResult.fonts.bold).toEqual(darkResult.fonts.bold);
      expect(lightResult.fonts.heavy).toEqual(darkResult.fonts.heavy);

      // Only dark flag should differ
      expect(lightResult.dark).toBe(false);
      expect(darkResult.dark).toBe(true);
    });
  });
});
