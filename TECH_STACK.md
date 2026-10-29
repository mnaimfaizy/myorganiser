# Tech Stack

> **Single source of truth** for installed package versions and canonical technology choices.
> All agent instruction files and documentation must reference this file rather than declaring versions inline.
> Owned and kept current by the **DepSync** agent/skill — do not edit versions manually.
> Last synced from `package.json` on 2026-10-24.

> **Reading this file as an agent:** it is a lookup table, not a briefing. Read
> the one section you need. Component work needs
> [Frontend — Web App](#frontend--web-app) at most; the rules that actually
> govern a component live in [`docs/ui/GUIDELINES.md`](docs/ui/GUIDELINES.md).
> Reading all 23 KB to write one component spends roughly 6k tokens on backend,
> database, mobile, and CI versions that cannot affect the outcome.

---

## Runtime Environment

| Tool       | Version   | Notes                                                                                                          |
| ---------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| Node.js    | ≥ 22.18.0 | Enforced via `engines` in `package.json`; the first Node 22 that strips TypeScript types by default (ADR 0135) |
| Yarn       | 4.13.0    | Package manager — pinned via `packageManager` field                                                            |
| TypeScript | 5.9.3     | Used across all apps and libraries                                                                             |

---

## Frontend — Web App

### Framework

| Package     | Version | Purpose                                                |
| ----------- | ------- | ------------------------------------------------------ |
| `next`      | 16.4.2  | App framework — App Router, server components, routing |
| `react`     | 19.2.3  | UI rendering                                           |
| `react-dom` | 19.2.3  | DOM renderer for React                                 |

### UI Primitives

| Package                         | Version | Purpose                                    |
| ------------------------------- | ------- | ------------------------------------------ |
| `@radix-ui/react-avatar`        | 1.1.11  | Accessible avatar component primitive      |
| `@radix-ui/react-checkbox`      | 1.3.3   | Accessible checkbox primitive              |
| `@radix-ui/react-collapsible`   | 1.1.12  | Accessible collapsible/accordion primitive |
| `@radix-ui/react-dialog`        | 1.1.15  | Accessible modal dialog primitive          |
| `@radix-ui/react-dropdown-menu` | 2.1.16  | Accessible dropdown menu primitive         |
| `@radix-ui/react-label`         | 2.1.8   | Accessible label primitive                 |
| `@radix-ui/react-popover`       | 1.1.15  | Accessible popover primitive               |
| `@radix-ui/react-select`        | 2.2.6   | Accessible select primitive                |
| `@radix-ui/react-separator`     | 1.1.8   | Accessible separator primitive             |
| `@radix-ui/react-slot`          | 1.2.4   | Render delegation (`asChild` pattern)      |
| `@radix-ui/react-toast`         | 1.2.15  | Accessible toast notification primitive    |
| `@radix-ui/react-tooltip`       | 1.2.8   | Accessible tooltip primitive               |
| `cmdk`                          | 1.1.1   | Command palette component                  |
| `lucide-react`                  | 0.562.0 | Icon library                               |
| `react-day-picker`              | 9.13.0  | Date picker component                      |
| `@tanstack/react-table`         | 8.21.3  | Headless table logic                       |

### Styling

| Package                    | Version | Purpose                                                                |
| -------------------------- | ------- | ---------------------------------------------------------------------- |
| `tailwindcss`              | 4.1.18  | Utility-first CSS framework                                            |
| `@tailwindcss/postcss`     | 4.1.18  | PostCSS integration for Tailwind 4                                     |
| `class-variance-authority` | 0.7.1   | Component variant system (CVA) — used in all `libs/web/ui/` components |
| `tailwind-merge`           | 3.4.0   | Merges conflicting Tailwind classes at runtime                         |
| `tailwindcss-animate`      | 1.0.7   | Animation utilities for Tailwind                                       |
| `postcss`                  | 8.5.6   | CSS transformation pipeline                                            |
| `autoprefixer`             | 10.4.23 | Adds vendor prefixes via PostCSS                                       |

### Design Tokens

| Package            | Version | Purpose                                                            |
| ------------------ | ------- | ------------------------------------------------------------------ |
| `style-dictionary` | ^4      | Transforms design token definitions into platform-specific outputs |

### Forms & Validation

| Package               | Version | Purpose                                           |
| --------------------- | ------- | ------------------------------------------------- |
| `react-hook-form`     | 7.71.1  | Form state management                             |
| `@hookform/resolvers` | 5.2.2   | Adapter connecting React Hook Form to Zod schemas |
| `zod`                 | 4.6.6   | Schema declaration and runtime validation         |

### Date Utilities

| Package    | Version | Purpose                          |
| ---------- | ------- | -------------------------------- |
| `date-fns` | 4.1.0   | Date formatting and manipulation |

### HTTP Client

| Package | Version | Purpose                                      |
| ------- | ------- | -------------------------------------------- |
| `axios` | 1.20.0  | HTTP client used by the generated API client |

---

## Frontend — Mobile App

> Bare React Native via `@nx/react-native` (ADR-0005). Styling uses React Native
> `StyleSheet` over a `@myorganiser/design-tokens`-derived theme (ADR-0008) — no
> NativeWind/Tailwind on mobile (incompatible with the repo's Tailwind v4).

| Package                                  | Version  | Purpose                                                               |
| ---------------------------------------- | -------- | --------------------------------------------------------------------- |
| `react-native`                           | ~0.87.1  | Mobile app runtime                                                    |
| `@nx/react-native`                       | 22.7.12  | Nx plugin for React Native apps/libs                                  |
| `@react-navigation/native`               | 7.2.5    | Navigation core                                                       |
| `@react-navigation/native-stack`         | 7.16.0   | Native stack navigator                                                |
| `@react-navigation/bottom-tabs`          | 7.16.2   | Bottom tab navigator (the app's five-tab shell)                       |
| `react-native-screens`                   | 4.28.0   | Native screen primitives                                              |
| `react-native-safe-area-context`         | 5.10.0   | Safe-area insets                                                      |
| `react-native-keychain`                  | 10.0.0   | Secure token storage (mobile auth)                                    |
| `react-native-mmkv`                      | 3.3.3    | Per-device settings storage (appearance, last used tab)               |
| `react-native-quick-base64`              | 3.0.1    | Base64 helpers (peer dep of quick-crypto)                             |
| `react-native-quick-crypto`              | 1.1.7    | JSI WebCrypto-compatible crypto (vault adapter)                       |
| `react-native-nitro-modules`             | 0.37.1   | Nitro modules runtime (peer dep of quick-crypto)                      |
| `@craftzdog/react-native-buffer`         | 6.1.2    | Buffer used by the mobile vault crypto (quick-crypto's own)           |
| `react-native-url-polyfill`              | 3.0.0    | URL polyfill for fetch/API client on RN                               |
| `react-native-svg`                       | ~15.15.5 | SVG rendering — the UI Primitives' icon set is drawn in it            |
| `react-native-gesture-handler`           | 2.33.0   | Native-thread gestures (the swipeable list row)                       |
| `react-native-reanimated`                | 4.7.0    | UI-thread animation (row swipe, skeleton pulse)                       |
| `react-native-worklets`                  | 0.13.0   | Worklets runtime and Babel plugin (required peer of Reanimated 4)     |
| `@react-native-community/datetimepicker` | 8.6.0    | Native date/time pickers (iOS UIDatePicker, Android DatePickerDialog) |
| `@react-native-community/netinfo`        | 12.0.1   | Connectivity, read by the offline banner                              |
| `react-native-haptic-feedback`           | 3.0.0    | Tick and untick haptics                                               |

### Metro & React Native Tooling

| Package                                        | Version | Purpose                                                            |
| ---------------------------------------------- | ------- | ------------------------------------------------------------------ |
| `@react-native-community/cli`                  | ~20.2.0 | React Native CLI                                                   |
| `@react-native-community/cli-platform-android` | ~20.2.0 | Android platform tooling                                           |
| `@react-native-community/cli-platform-ios`     | ~20.2.0 | iOS platform tooling                                               |
| `@react-native/babel-preset`                   | ~0.87.1 | Babel preset for React Native                                      |
| `@react-native/jest-preset`                    | ~0.87.1 | Jest preset for React Native (split out of `react-native` at 0.85) |
| `@react-native/metro-config`                   | ~0.87.1 | Default Metro configuration                                        |
| `metro-config`                                 | ~0.87.1 | Metro bundler configuration                                        |
| `metro-resolver`                               | ~0.87.1 | Metro module resolver                                              |
| `react-native-svg-transformer`                 | ~1.5.3  | SVG import transformer for Metro                                   |

### Web Target (Nx Vite)

| Package                | Version | Purpose                                |
| ---------------------- | ------- | -------------------------------------- |
| `react-native-web`     | ~0.20.0 | Web rendering target for RN components |
| `react-native-svg-web` | ~1.0.9  | SVG web shim for `react-native-svg`    |

---

## Backend — API Server

### Framework & Middleware

| Package              | Version | Purpose                               |
| -------------------- | ------- | ------------------------------------- |
| `express`            | 5.2.1   | HTTP server framework                 |
| `body-parser`        | 2.4.0   | Request body parsing                  |
| `compression`        | 1.8.2   | Response compression                  |
| `cookie-parser`      | 1.4.7   | Cookie parsing middleware             |
| `cors`               | 2.8.5   | Cross-origin resource sharing headers |
| `express-rate-limit` | 8.3.2   | Request rate limiting                 |
| `helmet`             | 8.1.0   | HTTP security headers                 |

### Authentication

| Package          | Version | Purpose                                 |
| ---------------- | ------- | --------------------------------------- |
| `passport`       | 0.7.0   | Authentication middleware               |
| `passport-jwt`   | 4.0.1   | JWT strategy for Passport               |
| `passport-local` | 1.0.0   | Username/password strategy for Passport |
| `bcrypt`         | 6.0.0   | Password hashing                        |

### API Documentation & Client Generation

| Package                               | Version | Purpose                                                                   |
| ------------------------------------- | ------- | ------------------------------------------------------------------------- |
| `tsoa`                                | 6.6.0   | Generates OpenAPI spec from TypeScript decorators                         |
| `swagger-jsdoc`                       | 6.2.8   | Supplementary JSDoc-based OpenAPI annotations                             |
| `swagger-ui-express`                  | 5.0.1   | Serves the Swagger UI from Express                                        |
| `@openapitools/openapi-generator-cli` | 2.27.0  | Generates typed API client (`libs/app-api-client/`) from the OpenAPI spec |

### Logging

| Package   | Version | Purpose                        |
| --------- | ------- | ------------------------------ |
| `winston` | 3.19.0  | Structured application logging |

### Email

| Package      | Version | Purpose        |
| ------------ | ------- | -------------- |
| `nodemailer` | 10.0.10 | Email delivery |

### Google Integration

| Package      | Version | Purpose                                                |
| ------------ | ------- | ------------------------------------------------------ |
| `googleapis` | 171.4.0 | Google Drive API — used for cloud vault backup feature |

### Utilities

| Package            | Version | Purpose                                          |
| ------------------ | ------- | ------------------------------------------------ |
| `dotenv`           | 17.2.3  | Loads environment variables from `.env` files    |
| `reflect-metadata` | 0.2.2   | Decorator metadata — required by tsoa            |
| `archiver`         | 7.0.1   | File archiving — used for vault export packaging |

---

## Database

| Package              | Version | Purpose                                       |
| -------------------- | ------- | --------------------------------------------- |
| `@prisma/client`     | 7.2.0   | Generated Prisma ORM client                   |
| `prisma`             | 7.2.0   | Prisma CLI — schema management and migrations |
| `@prisma/adapter-pg` | 7.2.0   | PostgreSQL adapter for Prisma                 |

---

## Monorepo

| Package                      | Version | Purpose                                                             |
| ---------------------------- | ------- | ------------------------------------------------------------------- |
| `nx`                         | 22.7.12 | Monorepo build system and task orchestration                        |
| `@nx/next`                   | 22.7.12 | Nx plugin for Next.js                                               |
| `@nx/react`                  | 22.7.12 | Nx plugin for React libraries                                       |
| `@nx/react-native`           | 22.7.12 | Nx plugin for React Native apps and libraries                       |
| `@nx/express`                | 22.7.12 | Nx plugin for Express                                               |
| `@nx/node`                   | 22.7.12 | Nx plugin for Node.js                                               |
| `@nx/js`                     | 22.7.12 | Nx plugin for plain TypeScript libraries                            |
| `@nx/webpack`                | 22.7.12 | Nx plugin for Webpack builds                                        |
| `@nx/web`                    | 22.7.12 | Nx plugin for web applications                                      |
| `@nx/eslint`                 | 22.7.12 | Nx plugin for ESLint integration                                    |
| `@nx/playwright`             | 22.7.12 | Nx plugin for Playwright                                            |
| `@nx/storybook`              | 22.7.12 | Nx plugin for Storybook                                             |
| `@nx/vite`                   | 22.7.12 | Nx plugin for Vite (used by Storybook)                              |
| `@nx/vitest`                 | 22.7.12 | Nx plugin for Vitest (available but Jest is the active test runner) |
| `@nx/eslint-plugin`          | 22.7.12 | Nx ESLint rules, including module boundary enforcement              |
| `@nx/workspace`              | 22.7.12 | Nx workspace generators and migrations                              |
| `@driimus/nx-plugin-openapi` | 3.1.2   | Nx plugin for OpenAPI code generation tasks                         |

---

## Testing

| Package                         | Version | Purpose                                                                           |
| ------------------------------- | ------- | --------------------------------------------------------------------------------- |
| `jest`                          | 30.2.0  | Unit and integration test runner — canonical choice                               |
| `@nx/jest`                      | 22.7.12 | Nx/Jest integration                                                               |
| `jest-environment-jsdom`        | 30.2.0  | DOM environment for React component tests                                         |
| `jest-environment-node`         | 30.2.0  | Node environment for backend tests                                                |
| `ts-jest`                       | 29.4.9  | TypeScript preprocessor for Jest                                                  |
| `babel-jest`                    | 30.2.0  | Babel transform for Jest                                                          |
| `@testing-library/react`        | 16.3.1  | React component testing utilities                                                 |
| `@testing-library/react-native` | 14.0.1  | React Native component testing utilities                                          |
| `@testing-library/dom`          | 10.4.1  | DOM testing utilities                                                             |
| `test-renderer`                 | 1.3.0   | React test renderer RNTL 14 uses in place of the deprecated `react-test-renderer` |
| `jsdom`                         | ~22.1.0 | DOM environment for Jest tests                                                    |
| `vitest`                        | 4.1.8   | Vite-native test runner (via `@nx/vitest`)                                        |
| `@vitest/ui`                    | 4.1.8   | Vitest browser UI                                                                 |
| `@playwright/test`              | 1.57.0  | End-to-end test runner                                                            |
| `supertest`                     | 7.2.2   | HTTP assertion library for Express integration tests                              |

> **Note**: Jest is the canonical unit test runner for web and mobile. Vitest is installed for Vite-based projects via `@nx/vitest`.

> **Mobile Test Toolchain Note**: **Rendering a mobile component in a test works**, as of #910. It was blocked by `react-test-renderer` — a package React deprecated outright, pinned at `19.0.0` against React `19.2.3`, and declared as a peer by `@testing-library/react-native` 13. RNTL **14** is the line that drops it, for `test-renderer@1`, and that is the version installed; `react-test-renderer` is gone from the tree.
>
> `libs/mobile/ui` is the project that renders: `preset: '@react-native/jest-preset'`, the native modules stubbed once in its `jest.setup.ts`, and Reanimated 4's Jest resolver chained into the Nx one in `jest.resolver.js`, because Reanimated and `react-native-worklets` otherwise load `.native` files that throw with no native module behind them. **`render` is async in RNTL 14** — `await` it, or `screen` throws "`render` function has not been called", which reads as a broken component rather than a missing `await`. See [the Mobile UI Agent Guide](libs/mobile/ui/AGENTS.md).
>
> `libs/mobile/core` and `libs/mobile/screens` still run pure logic in a `node` environment and have no renderer configured, so a spec in either must still import neither `react-native`, `react`, nor `@testing-library/react-native`.

---

## Storybook & Visual Testing

| Package                         | Version | Purpose                                                                                                           |
| ------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `storybook`                     | 8.6.19  | UI component development environment                                                                              |
| `@storybook/react`              | 8.6.19  | React renderer for Storybook                                                                                      |
| `@storybook/react-vite`         | 8.6.19  | Vite-based bundler for Storybook                                                                                  |
| `@storybook/addon-essentials`   | 8.6.19  | Storybook core addon bundle (docs, controls, actions, viewport, backgrounds) — registered in `.storybook/main.ts` |
| `@storybook/addon-interactions` | 8.6.19  | Interactions panel for `play` function tests — registered in `.storybook/main.ts`                                 |
| `@storybook/core-server`        | 8.6.19  | Storybook server core                                                                                             |
| `@storybook/test`               | 8.6.19  | Storybook testing utilities (interaction tests)                                                                   |
| `@storybook/test-runner`        | 0.23.0  | Runs Storybook stories as tests via Playwright                                                                    |
| `chromatic`                     | 13.3.5  | Visual regression testing and Storybook hosting                                                                   |
| `vite`                          | 6.4.4   | Build tool — used by Storybook and mobile web                                                                     |

---

## Build & Transpilation

| Package               | Version | Purpose                                                             |
| --------------------- | ------- | ------------------------------------------------------------------- |
| `@swc/core`           | 1.15.8  | SWC transpiler — faster alternative to Babel for Nx builds          |
| `@swc-node/register`  | 1.11.1  | SWC integration for Node.js require hooks                           |
| `@swc/helpers`        | 0.5.18  | SWC runtime helpers                                                 |
| `@babel/core`         | 7.28.6  | Babel — used by babel-jest for test transforms                      |
| `@babel/preset-react` | 7.28.5  | Babel React preset for test transforms                              |
| `webpack-cli`         | 6.0.1   | Webpack CLI — used by `@nx/webpack` builds                          |
| `esbuild`             | 0.25.12 | JS/TS bundler — builds the standalone Escape Copy reader (ADR 0064) |

---

## Code Quality

| Package                        | Version | Purpose                                           |
| ------------------------------ | ------- | ------------------------------------------------- |
| `eslint`                       | 9.39.2  | Linter                                            |
| `typescript-eslint`            | 8.53.0  | TypeScript-aware ESLint rules                     |
| `eslint-config-next`           | 16.1.2  | Next.js ESLint config                             |
| `eslint-config-prettier`       | 10.1.8  | Disables ESLint rules that conflict with Prettier |
| `eslint-plugin-import`         | 2.32.0  | Import order and resolution rules                 |
| `eslint-plugin-jsx-a11y`       | 6.10.2  | Accessibility linting for JSX                     |
| `eslint-plugin-react`          | 7.37.5  | React-specific ESLint rules                       |
| `eslint-plugin-react-hooks`    | 7.0.1   | Enforces Rules of Hooks                           |
| `eslint-plugin-unused-imports` | 4.3.0   | Detects and removes unused imports                |
| `prettier`                     | 3.8.0   | Code formatter                                    |
| `husky`                        | 9.1.7   | Git hooks — runs lint and format checks on commit |

---

## AI Orchestration

| Package               | Version | Purpose                                                                      |
| --------------------- | ------- | ---------------------------------------------------------------------------- |
| `@ai-hero/sandcastle` | 0.12.0  | Runs Claude Code agents in Docker sandboxes — used by `yarn dispatch-agents` |

---

## Security Patches & Resolutions

These transitive dependencies are explicitly resolved to patched versions via Yarn resolutions, npm overrides, and pnpm overrides.

| Package                     | Resolved Version       | Reason                                                                                                                                                                                                                                                                                                                | Vulnerability ID                                     |
| --------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `adm-zip`                   | 0.6.1                  | Patches DoS via uncontrolled memory allocation from declared uncompressed size (GHSA-7q85-xj36-vmfc); pulled by `@module-federation/dts-plugin`                                                                                                                                                                       | 1239030                                              |
| `basic-ftp`                 | 6.2.1                  | Patches quadratic-time DoS in the `Client.list()` directory-listing parser (GHSA-c475-qrg2-pj4r); pulled by `get-uri@6.0.4`, which declares `^5.0.2`. The only breaking change in 6.0.0 is that separate transfer hosts are off by default                                                                            | 1240853                                              |
| `shell-quote`               | 1.11.0                 | Patches `quote()` command injection via a line terminator in a token after a `{ comment }` token (GHSA-pqg4-j6r4-53mv)                                                                                                                                                                                                | 1241332                                              |
| `browserslist`              | 4.28.8                 | Patches unbounded cache growth and untrusted custom-stats crash (GHSA-c83g-rgw3-j3cx, GHSA-73wf-gq98-2v4g)                                                                                                                                                                                                            | 1153171, 1153172                                     |
| `fast-uri`                  | 3.1.8                  | Patches authority injection via unvalidated port (GHSA-qw65-cvwx-89v3), host confusion via unclosed bracket (GHSA-58mr-gqgx-xq4g), and SSRF via URI normalization (GHSA-5jgf-p345-68v8, GHSA-f65p-4m7j-42xc, GHSA-fph4-wmhf-6fwf, GHSA-jqff-g426-hqxp)                                                                | 1239943, 1239946, 1158521, 1158524, 1158527, 1158530 |
| `mysql2`                    | 3.23.1                 | Patches auth downgrade credential leakage and compressed-protocol decompression DoS (GHSA-3f6p-5ww8-9rcr, GHSA-rgwj-5xj2-c3m3); Prisma 7.2.0 still pins 3.15.3                                                                                                                                                        | 1153173                                              |
| `fast-xml-parser`           | 5.7.3                  | Patches XMLBuilder comment/CDATA injection (GHSA-gh4j-gqv2-49f6)                                                                                                                                                                                                                                                      | CVE-2026-41650                                       |
| `deepmerge-ts`              | 8.0.1                  | Patches stack exhaustion in schema merging (pulled by @prisma/config@7.2.0)                                                                                                                                                                                                                                           | GHSA-ggr8-5vv4-36mx                                  |
| `react-native-quick-base64` | 3.0.1                  | Resolution keeps transitive copies aligned with direct dep (peer of quick-crypto)                                                                                                                                                                                                                                     | —                                                    |
| `nanoid`                    | 3.3.17                 | Patches infinite loops on negative and zero `size` (GHSA-28wg-ghj8-5hjv, GHSA-2v37-7h3g-55p8)                                                                                                                                                                                                                         | 1138811, 1138813                                     |
| `js-yaml`                   | 3.15.2, 4.3.2          | Patches unbounded CPU use from empty merge sources despite `maxTotalMergeKeys` (GHSA-2883-xcg3-v3hh)                                                                                                                                                                                                                  | 1193726, 1193727                                     |
| `sharp`                     | 0.35.5                 | Patches bundled librsvg vulnerability CVE-2026-96889 (GHSA-wq5f-xc86-pv6w); pulled by `next`                                                                                                                                                                                                                          | 1241331                                              |
| `smol-toml`                 | 1.8.0                  | Patches DoS via malformed TOML documents (GHSA-7w5x-hrqm-74c2); `nx@22.7.12` pins 1.6.1 exactly                                                                                                                                                                                                                       | 1193945                                              |
| `svgo`                      | 3.3.5, 4.1.0           | Patches `removeScripts` bypass via namespace and control characters (GHSA-w27v-7q3p-w38r)                                                                                                                                                                                                                             | 1193735, 1193736                                     |
| `brace-expansion`           | 1.1.21, 2.1.7, 5.0.12  | Patches stack exhaustion from uncontrolled recursion on nested brace groups and in `parseCommaParts` (GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p); pulled by `minimatch` 3.x/9.x and `nx@22.7.12`, which pins 5.0.8 exactly                                                                                             | 1240104, 1240105, 1240107, 1240108, 1240109, 1240111 |
| `nodemailer`                | 10.0.10 (direct)       | Patches quadratic backtracking in the addressparser free-text fallback (GHSA-v53p-9fqp-m79j); the only breaking change in 10.0.0 is Node ≥ 20, and the repo runs Node 22                                                                                                                                              | 1240114                                              |
| `joi`                       | 17.13.8                | Patches quadratic ReDoS in `Joi.string().isoDate()` (GHSA-6h2x-m376-mqjq); pulled by `@react-native-community/cli-config@20.2.0`                                                                                                                                                                                      | 1240057                                              |
| `undici`                    | 7.30.1                 | Patches WebSocket subprotocol DoS, BalancedPool TLS validation bypass, and DoS via an unhandled error on excessive content-encodings (GHSA-rfgv-xxqx-mfg5, GHSA-w293-vg96-wgc3, GHSA-xjj6-f33q-929c); pulled by `@module-federation/dts-plugin@2.8.1`                                                                 | 1240041, 1240050, 1243113                            |
| `webpack-dev-middleware`    | 7.4.6                  | Patches path traversal via non-slash-terminated `publicPath` (GHSA-g84c-rxfj-3j2c); pulled by `webpack-dev-server@5.2.3`                                                                                                                                                                                              | 1240027                                              |
| `proxy-addr`                | 2.0.8                  | Patches IP spoofing via IPv4-mapped IPv6 trust subnet (GHSA-jqcg-44mw-7w3h); pulled by `express` 4.22.1 and 5.2.1                                                                                                                                                                                                     | 1241210                                              |
| `source-map-js`             | 1.2.2                  | Patches event-loop DoS through indexed source-map section offsets (GHSA-68fv-2mgg-jv7q); pulled by `postcss`, `css-tree` and `@tailwindcss/node`                                                                                                                                                                      | 1241209                                              |
| `compression`               | 1.8.2 (direct)         | Patches DoS via memory leak on premature response close (GHSA-vc2v-76pw-4v95); the resolution lifts the transitive copies under `webpack-dev-server@5.2.3` and `@react-native-community/cli-server-api@20.2.0`                                                                                                        | 1241221                                              |
| `handlebars`                | 4.7.10                 | Patches JavaScript injection via AST type confusion in `compile` and via the own-property check bypass (GHSA-8r5x-fm3f-whwj, GHSA-p8wg-vrv2-v86f); pinned at 4.7.9 by `@tsoa/cli@6.6.0` and `ts-jest@29.4.9`. Listed in `npmPreapprovedPackages` because it was published inside the 7-day `npmMinimalAgeGate` window | 1241677, 1241678                                     |
| `http-cache-semantics`      | 4.3.0                  | Patches cross-user cached response disclosure through `max-stale` handling (GHSA-ch52-4w7c-c8xp); pulled by `make-fetch-happen@15.0.5` under `node-gyp`. Listed in `npmPreapprovedPackages` because it was published inside the 7-day `npmMinimalAgeGate` window                                                      | 1240991                                              |
| `body-parser`               | 1.20.9, 2.4.0 (direct) | Patches DoS via trailing bytes after a compressed request body (GHSA-27r3-jxmh-p828); the resolutions lift the copies under `express` 4.22.1 and `@react-native-community/cli-server-api@20.2.0`. Listed in `npmPreapprovedPackages` because both were published inside the 7-day `npmMinimalAgeGate` window          | 1243073, 1243074                                     |
| `zod`                       | 4.6.6 (direct)         | Patches memory exhaustion while validating oversized constrained collections (GHSA-mrhx-c7xc-m3w5); the `eslint-plugin-react-hooks@7.0.1` copy is deduped onto it                                                                                                                                                     | 1243066                                              |

> **Note**: `shell-quote` is a transitive dependency of `concurrently@9.2.1` (pulled in by `@openapitools/openapi-generator-cli@2.27.0`) and `launch-editor@2.9.1` (pulled in by `webpack-dev-server@5.2.3`). Upstream packages are pinned to versions that contain vulnerable `shell-quote`, so we use resolutions to force the patched version globally.

> **Note**: `nanoid` reaches the tree through `postcss@8.5.18` (`^3.3.11`) and `@react-navigation/native@7.2.5` (`^3.3.12`). Both are resolved to `3.3.17`, the first release patching both advisories. It is also listed in `npmPreapprovedPackages` because it was published inside the 7-day `npmMinimalAgeGate` window.

> **Note**: `js-yaml` 3.x reaches the tree through `cosmiconfig@5.2.1` and 4.x through `@eslint/eslintrc`. `sharp` comes from `next`, `svgo` 3.x from `@svgr/plugin-svgo@8.1.0` and 4.x from `postcss-svgo@7.1.3`. `smol-toml` is pinned exactly at `1.6.1` by `nx@22.7.12`, so the `1.8.0` resolution overrides a declared exact version — drop it when Nx takes a patched release. The patched versions named in this note are all older than the 7-day `npmMinimalAgeGate`.

> **Note**: `browserslist` reaches the tree through `@babel/helper-compilation-targets` and `@nx/webpack@22.7.12`. `fast-uri` is pulled by `ajv@8.17.1`. `mysql2` is pinned at `3.15.3` by `prisma@7.2.0` (this app uses the Postgres adapter; the resolution still has to lift the CLI's unused MySQL driver so `yarn npm audit --severity high` can pass). The patched versions named in this note are all older than the 7-day `npmMinimalAgeGate`.

> **Note**: `handlebars` 4.7.10, `http-cache-semantics` 4.3.0, and `body-parser` 1.20.9 and 2.4.0 were published inside the 7-day `npmMinimalAgeGate` window, so all are listed in `npmPreapprovedPackages`. `handlebars` is pinned at 4.7.9 by `@tsoa/cli@6.6.0` and `ts-jest@29.4.9`; `http-cache-semantics` reaches the tree through `make-fetch-happen@15.0.5` under `node-gyp`.

### Accepted audit exceptions

Advisories deliberately ignored via `npmAuditIgnoreAdvisories` in `.yarnrc.yml`. Each needs a reachability argument, a revisit condition, and an open tracking issue — an exception with no issue behind it has no way of being reconsidered.

| Advisory IDs | Package           | Why it is not fixable now                   | Revisit when | Tracking |
| ------------ | ----------------- | ------------------------------------------- | ------------ | -------- |
| 1124334      | `brace-expansion` | Superseded ReDoS variant; kept for history. | —            | —        |
