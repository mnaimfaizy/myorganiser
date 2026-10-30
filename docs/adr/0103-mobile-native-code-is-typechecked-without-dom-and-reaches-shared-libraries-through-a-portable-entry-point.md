# Mobile native code is typechecked without `dom` and reaches shared libraries through a Portable Entry Point

## Status

accepted. Amended 2026-09-26 (issue #740): the `libs/mobile/*` tsconfigs no longer inherit `dom` — see the last Consequence. Amended 2026-10-03 (issue #892): the Node-types Consequence now points at ADR 0120.

## Context

`apps/mobile/tsconfig.json` put `dom` in `lib`, so `tsc` accepted browser globals in the Mobile App's native code, where they don't exist. Issue #882 measured what removing it costs: 40 errors. One was in `apps/mobile/src/main-web.tsx`. The other 39 were in shared libraries: `libs/auth/src/lib/auth-session-storage-adapter.ts` (`window`), `libs/core/src/lib/apiBaseUrl.ts`, `settings/accountSettings.ts`, and `currency/fxRates.ts` (`window`, `document`, `StorageEvent`), and `libs/vault-core/src/lib/vaultCrypto.ts` and `escapeCopyReader.ts` (`CryptoKey`).

The grilling session for #882 found four facts that changed the question:

- **The Mobile App targets two runtimes.** `apps/mobile` also builds for react-native-web through Vite (`main-web.tsx`, with `.web.*` files resolved first). That makes the `main-web.tsx` error correct code for the runtime it runs in. `libs/mobile/feat/vault/src/crypto.web.ts` is the same case, and it was typechecked by nothing: the app program resolved `./crypto` to `crypto.ts`, and the `libs/mobile/*` projects have no typecheck target.
- **Barrel reachability caused all 39 shared-library errors.** Mobile used none of the code that raised them. It imports four functions from `libs/auth/src/lib/refresh-client-contract.ts`, whose only imports are types, and `import type { VaultCrypto }` from `libs/vault-core`. `libs/core` is never imported by mobile. It arrived through the transport adapter in `libs/auth`.
- **`typeof window` guards do not guard on native.** React Native sets `global.window = global` (`react-native/Libraries/Core/setUpGlobals.js`), so on Hermes `isBrowser()` in the storage adapter returns true and the adapter then reads `window.localStorage`, which is undefined.
- **Metro does not tree-shake.** Importing the `@myorganiser/auth` barrel meant native ran `createBrowserAuthSessionStorageAdapter()` at module load.

## Decision

1. **The constraint covers the native graph.** `mobile:typecheck` runs two programs, overridden in `apps/mobile/project.json`:
   - `tsconfig.app.json` is the native program. It uses `lib: ["esnext"]` and excludes `src/main-web.tsx` and `src/**/*.web.ts(x)`.
   - `tsconfig.web.json` is the react-native-web program. It uses `lib: ["dom", "esnext"]`, starts from `main-web.tsx`, and sets `moduleSuffixes: [".web", ""]`, which is TypeScript's form of Vite's `resolve.extensions`. It therefore typechecks each Platform Variant in the runtime that actually loads it.

   `dom` moves out of the shared `apps/mobile/tsconfig.json`, so the spec program no longer gets it either. That matches the `react-native` Jest preset, which does not run in jsdom.

2. **Portable Entry Points** (CONTEXT.md). `@myorganiser/auth/portable` (`libs/auth/src/portable.ts`) re-exports the refresh-token contract. `@myorganiser/vault-core/portable` (`libs/vault-core/src/portable.ts`) re-exports `interfaces.ts` and `types.ts`. Mobile code imports these libraries only through their Portable Entry Points. The main barrels, and every web and backend consumer, are unchanged. `libs/core` has no Portable Entry Point because mobile needs nothing from it.
3. **`yarn mobile-platform:check` enforces the import.** In `apps/mobile` and `libs/mobile`, outside exempted Platform Variants, naming `@myorganiser/<lib>` in any specifier form fails the check when `tsconfig.base.json` declares `@myorganiser/<lib>/portable`. The check derives its library list from those aliases, so adding a Portable Entry Point opts its library in without editing the checker.

## Considered Options

- **Platform-guard each site in place.** Rejected. Because React Native defines `window`, the guards are already true on native, and more guards would not make the types accurate.
- **Put each browser-dependent site behind an interface with a mobile implementation.** Rejected. The auth storage already sits behind `AuthSessionStorageAdapter`, and mobile already uses the Keychain instead. The problem was the barrel, not a missing seam. Writing mobile implementations of `accountSettings`, `fxRates`, or `apiBaseUrl` for code mobile never calls would produce interfaces with no real mobile consumer, which CONTEXT.md says is not a Platform Adapter.
- **Keep `dom` and rely on `yarn mobile-platform:check`.** Rejected. That check scans `apps/mobile` and `libs/mobile` only. The compiler follows the import graph into shared libraries, which is where 39 of the 40 errors were.
- **Move the browser code out of the shared libraries into web libraries.** Deferred, not rejected. It may be the cleaner end state for the localStorage helpers in `libs/core`. It is a larger move, though, and `vault-core` would still need a Portable Entry Point, because `vaultCrypto.ts` has to stay there for web and the Escape Copy reader ([ADR 0064](0064-an-escape-copy-is-opened-by-a-tool-that-needs-nothing-of-ours.md)).
- **Name each entry point by its content (`/refresh-contract`, `/interfaces`).** Rejected in favour of one `/portable` per library. The name states the promise a contributor would otherwise break, and new mobile needs extend `portable.ts` rather than adding a new alias for each feature, which would rebuild the barrel problem one alias at a time.

## Consequences

- The native program has no `lib.dom.d.ts`, and it fails if mobile imports a main barrel that reaches browser globals. Restoring the one `@myorganiser/auth` import in `libs/mobile/feat/auth/src/api/client.ts` brings back 32 errors.
- `crypto.web.ts` is typechecked for the first time, in the web program.
- [ADR 0039](0039-web-and-mobile-vaults-share-one-crypto-suite.md) and ADR 0064 hold unchanged. `vaultCrypto.ts` stays in `vault-core`, and mobile reaches the shared suite through the `VaultCrypto` interface, as `libs/vault-core/AGENTS.md` already required.
- Native no longer loads `libs/auth/src/lib/auth.ts` at runtime, so the browser storage adapter is not constructed on Hermes.
- `@myorganiser/<lib>/portable` is the first slash alias in `tsconfig.base.json` that does not name its own Nx project. The `/portable` suffix marks an entry point into an existing library, not a new project.
- **Node types are gone too.** This ADR left `types: ["node"]` on the native program, which admitted Node's global `crypto`, `Buffer`, and `process`. [ADR 0120](0120-a-mobile-program-gets-node-types-only-if-it-runs-on-node.md) removed it from every non-spec mobile program (issue #892).
- `mobile-platform:check` also fails a bare `react-native/…` subpath import (excluding the separate
  `@react-native/*` scope), across all four call forms — `from '...'`, `require('...')`,
  `require.resolve('...')`, and dynamic `import('...')`. Deep imports are deprecated at React Native
  0.80 with removal planned, and nothing else in this repo catches them: `@react-native/eslint-config`
  is not installed, so ESLint has no opinion on the subpath, and the compiler only reaches files a
  program actually includes, while this check scans every mobile source file regardless.
- Each `libs/mobile/*` project carries the inferred `typecheck` target every project does ([ADR 0141](0141-typecheck-is-a-cached-per-project-inferred-target.md)), which compiles its own `tsconfig.lib.json`, and its `tsconfig.spec.json` where it has one; its source is compiled through the app's two programs as well, and `yarn typecheck:check` runs the whole set. Until ADR 0141 the per-library compile was `tools/scripts/check-typecheck.ts` enumerating the configs itself, and these projects had no target of their own; the browser-globals rule of `mobile-platform:check` still scans their source. Since issue #740 they extend `libs/mobile/tsconfig.mobile.json`, which sets `lib: ["esnext"]`, so they no longer inherit `dom` from `tsconfig.base.json`. That makes a library's `tsconfig.lib.json` a native program too, so a `.web` Platform Variant inside one must be excluded there — `libs/mobile/feat/vault/tsconfig.lib.json` excludes `crypto.web.ts`, or `typecheck:check` fails on `CryptoKey` — and is checked by the app's web program instead.
