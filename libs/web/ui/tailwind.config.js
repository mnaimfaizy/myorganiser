const { join } = require('node:path');

// The shared theme lives in libs/design-tokens and is required by a path built
// at runtime: a relative import specifier across projects is what
// `@nx/enforce-module-boundaries` refuses (the same reason apps/web/next.config.js
// reads the workspace package.json by path).
const theme = require(
  join(__dirname, '..', '..', 'design-tokens', 'tailwind-theme.cjs'),
);

/** @type {import('tailwindcss').Config} */
module.exports = {
  // Every source the Storybook in .storybook/main.ts loads stories from. A
  // class used only in a vault-ui, usage-locations or page-library story
  // generates no CSS otherwise, and the story renders unstyled.
  content: [
    './src/**/*.{ts,tsx,js,jsx,html}',
    './.storybook/**/*.{ts,tsx,js,jsx,html}',
    '../vault-ui/src/**/*.{ts,tsx,js,jsx,html}',
    '../usage-locations/src/**/*.{ts,tsx,js,jsx,html}',
    '../pages/*/src/**/*.{ts,tsx,js,jsx,html}',
  ],
  theme: {
    extend: {
      ...theme,
      fontFamily: {
        sans: ['system-ui', 'sans-serif'],
        ...theme.fontFamily,
      },
      borderRadius: {
        lg: `var(--radius)`,
        md: `calc(var(--radius) - 2px)`,
        sm: 'calc(var(--radius) - 4px)',
        ...theme.borderRadius,
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
