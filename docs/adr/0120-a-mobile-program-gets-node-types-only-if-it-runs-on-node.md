# A mobile program gets Node types only if it runs on Node, and a missing global is imported before it is declared

## Status

accepted

## Context

[ADR 0103](0103-mobile-native-code-is-typechecked-without-dom-and-reaches-shared-libraries-through-a-portable-entry-point.md) removed `dom` from the Mobile App's native typecheck program and left `types: ["node"]` in place. `@types/node` declares a global `process`, `Buffer`, and `crypto`. Hermes provides none of them, so the native program accepted code that fails on a device. Issue #892 tracked that.

When #892 was filed, removing `node` cost about 75 errors, all in `libs/core`, `libs/vault-core`, and the generated `libs/app-api-client`. The issue therefore expected the fix to need a hand-written declaration of the globals the native runtime has. Re-measured at `31dffd52`, after ADR 0103's Portable Entry Points landed, the facts were different:

- With `types: []`, the native program (`apps/mobile/tsconfig.app.json`), the react-native-web program (`apps/mobile/tsconfig.web.json`), and all seven `libs/mobile/**/tsconfig.lib.json` programs compile with no errors. The native program no longer reaches the files that raised the 75.
- Mobile source uses no Node global ambiently. `Buffer` in `libs/mobile/feat/vault` is imported from `@craftzdog/react-native-buffer`, and the crypto functions from `react-native-quick-crypto`.
- Without Node types, React Native's own types still declare `URL`, `URLSearchParams`, `fetch`, the timers, `AbortController`, `Blob`, `FormData`, `WebSocket`, `__DEV__`, and `require`. They do not declare `TextEncoder`, `atob`, `btoa`, `structuredClone`, `queueMicrotask`, `performance`, or `navigator`. No mobile source uses any of those.
- The issue recorded that React Native's built-in `URL` throws "not implemented" on `pathname` and `search`. At the installed React Native (`~0.87.1`) it does not: `Libraries/Blob/URL.js` implements those members by regular expression. The `react-native-url-polyfill/auto` import in `apps/mobile/src/main.tsx` replaces that implementation with `whatwg-url`; the types and the runtime agree either way.

## Decision

1. **A mobile program gets Node types only if it runs on Node.** `types: []` is set in `apps/mobile/tsconfig.app.json`, `apps/mobile/tsconfig.web.json`, and `libs/mobile/tsconfig.mobile.json`, which every `libs/mobile/**/tsconfig.lib.json` inherits; the seven per-library `types: ["node"]` overrides are deleted. The spec programs keep `["jest", "node"]` because Jest runs on Node. The web program is included because a browser has no `process` or `Buffer` either.
2. **Nothing is declared up front.** There is no ambient list of Hermes globals. The programs are stricter than the runtime: a global Hermes has and the types lack is a compile error until its first consumer arrives.
3. **A missing global is imported before it is declared.** In order:
   1. Import the binding from a package that provides it, as `Buffer` already is.
   2. Only for a global Hermes itself provides, declare it in `libs/mobile/native-globals.d.ts`. The file is created with its first entry, in the same change as the first consumer, and an entry declares only the members used.
   3. Never restore `node`, and never add `dom`, to make a name resolve.
4. **The compiler asserts it.** `apps/mobile/src/runtime-globals.assert.ts` carries a `@ts-expect-error` directive over each of `void process`, `void Buffer`, and `void crypto`, and the native program compiles it. `apps/mobile/src/runtime-globals.assert.web.ts` carries `process` and `Buffer` and is named in `tsconfig.web.json`'s `files`; it omits `crypto` because `dom` declares it. If Node types return, the directives are unused and `mobile:typecheck` fails. Nothing imports either file, so no bundler includes them.

## Considered Options

- **Declare the Hermes globals now.** Rejected. The list would have no consumer, nothing would check it, and it would go stale at the next React Native upgrade ([ADR 0085](0085-an-artifact-states-no-claim-it-does-not-assert.md)). Being stricter than the runtime fails at compile time with an obvious fix; being looser fails on a device.
- **Leave the web program on `node`.** Rejected. It costs nothing to include, and leaving it out would let a `.web` Platform Variant use `Buffer` and compile.
- **A config rule in `yarn mobile-platform:check`** that fails a mobile tsconfig whose `types` is missing or names `node`. Rejected in favour of the fixture. A config rule catches a re-added entry and a deleted key. It does not catch a dependency whose declarations carry `/// <reference types="node" />`, and it asserts the setting rather than the outcome.
- **No guard.** Rejected. Seven library configs carried the same override, so the next library copied from one of them would bring `node` back.

## Consequences

- A mobile file that uses `process`, `Buffer`, or a global `crypto` fails `mobile:typecheck` in both programs' graphs, whichever library it lives in.
- The seven library configs are not individually guarded. A library that re-adds `types: ["node"]` to its own `tsconfig.lib.json` compiles under `yarn typecheck:check`, but its source is also compiled through the app's two programs, which are guarded.
- The first mobile use of `TextEncoder`, `atob`, or another Hermes global the types lack is a compile error. Decision 3 says what to do; the fixture's header repeats it at the place the error sends a reader looking.
- The fixture asserts three names, not the whole of `@types/node`. A route that admitted some other Node global while leaving these three unresolved would pass. No such route is known: `@types/node` declares all three together.
- Whether the Mobile App still needs `react-native-url-polyfill` is not decided here. The import stays, with a comment saying what it replaces.
