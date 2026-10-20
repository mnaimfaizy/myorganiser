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
  content: [
    './src/**/*.{ts,tsx,js,jsx,html}',
    './.storybook/**/*.{ts,tsx,js,jsx,html}',
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
