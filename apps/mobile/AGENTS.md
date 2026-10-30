# Mobile App Agent Guide

## Scope

React Native app shell. Feature screens, hooks, UI, and platform adapters live under `libs/mobile/*`. Shares the vault format and auth contract with the web client.

Root-level React Native rules (package-root imports, edge-to-edge via `react-native-safe-area-context`, `StyleSheet` over the token theme) live in the root [Agent Guide](../../AGENTS.md#react-native) and are not restated here.

## Commands

- Start Metro: `yarn nx start mobile`.
- iOS: `yarn nx run-ios mobile`.
- Android: `yarn nx run-android mobile`.
- Test: `yarn nx test mobile`.
- Lint: `yarn nx lint mobile`.
- Typecheck: `yarn nx run mobile:typecheck` — runs three programs: `tsconfig.app.json` (native, no `dom`, Platform Variants excluded), `tsconfig.web.json` (react-native-web, `dom`, `.web` Platform Variants resolved first), and `tsconfig.spec.json`. Neither production program has Node types; `src/runtime-globals.assert.ts` and its `.web` counterpart fail the target if they return. The target is inferred for every project, not declared here (ADR 0141). See ADR 0103 and ADR 0120.

The autonomous verification gate for mobile is lint + typecheck + format. Do not use `nx run mobile:bundle` (ADR 0005).

## Do

- Keep this app thin: native wiring, root providers, and navigation entry.
- Put feature code in `libs/mobile/*`.
- Store the refresh token in the OS keychain and send it in the refresh body (ADR 0006).
- Keep vault plaintext and the Master Key on the device.
- Reach the API and the web app only through `MOBILE_ENVIRONMENT` from `@myorganiser/mobile/core`; never hard-code a host. Debug builds resolve to the development machine, release builds to Production over HTTPS, and `MYORGANISER_MOBILE_BACKEND=production` at Metro start points a debug build at Production (`metro.config.js`).
- Keep plain-HTTP local networking Debug-only. Android gets it from the React Native Gradle plugin's `usesCleartextTraffic` placeholder; iOS from the "Allow local networking in Debug" build phase. Never add `NSAllowsLocalNetworking` to `ios/Mobile/Info.plist`.
- Clear a User's local data through `clearUserLocalData` (`src/app/userLocalData.ts`), the one function Logout and the backend origin guard share. It must never reach Device Settings.
- Keep the home-screen name and the registered component name separate. The home-screen name is **MyOrganiser** (iOS `CFBundleDisplayName`, Android `app_name`, `app.json` `displayName`); the registered component name stays **Mobile** (`AppDelegate` `withModuleName`, `MainActivity.getMainComponentName`, `app.json` `name`), and renaming it breaks startup for no visible gain.
- Keep one copy of each bundled font, in `src/assets/fonts`. Android reaches it through the asset source set in `android/app/build.gradle`; iOS through `UIAppFonts` plus the Xcode Resources phase. Adding a weight means all three plus the Type Scale table — see [src/assets/fonts/README.md](src/assets/fonts/README.md).
- Change the app icon by re-running `yarn mobile:app-icon:generate` and committing its output, never by editing an icon file. The generator reads the shield out of `BrandMark.tsx` and its colours out of the design tokens, and writes the masters in `app-icon/`, the iOS `AppIcon.appiconset` (light, dark, tinted), and the Android adaptive icon layers plus the legacy mipmaps.
- Run `yarn nx run mobile:pod-install` after adding a native dependency, and commit the lockfile.
- Keep `GestureHandlerRootView` as the outermost element of `App`, and `import 'react-native-gesture-handler'` as the first line of `src/main.tsx`. Both are ordering requirements rather than style: the gesture handler installs its touch pipeline at import time, and a tree mounted outside its root view receives no gesture at all on Android — which looks like a broken component, not like missing wiring.

## Do Not

- Do not put feature screens or domain logic in this app beyond the shell.
- Do not add an Operational README here; how to run mobile lives in `DEVELOPMENT.md`.
- Do not run `nx run mobile:bundle` as a slice or PR gate.
- Do not treat mobile refresh as an httpOnly cookie.
- Do not add NativeWind or `className` styling.
