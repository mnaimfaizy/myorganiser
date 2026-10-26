# Mobile testing (`apps/mobile`, `libs/mobile/*`)

> **`libs/mobile/ui` renders components; the other mobile projects run pure logic.** Read this
> before writing a mobile spec. See the Mobile Test Toolchain Note in
> [`TECH_STACK.md`](../../../TECH_STACK.md) and the mobile lane in
> [`unit-test-delegation-workflow`](../../../.agents/skills/unit-test-delegation-workflow/SKILL.md).

## Current state

Five mobile libraries have a Jest project:

| Project             | Config                                  | Environment                 | Covers                                                                                                                             |
| ------------------- | --------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `mobile-ui`         | `libs/mobile/ui/jest.config.ts`         | `@react-native/jest-preset` | the UI Primitives, the theme, the Type Scale conversion, the shadow conversion                                                     |
| `mobile-core`       | `libs/mobile/core/jest.config.ts`       | `node`                      | the Device Settings read back out of storage, and the Auto-Lock decision                                                           |
| `mobile-screens`    | `libs/mobile/screens/jest.config.ts`    | `node`                      | the tab vocabulary, the stored last used tab, the projection of the theme onto React Navigation, and the entry screens' error copy |
| `mobile-feat-vault` | `libs/mobile/feat/vault/jest.config.ts` | `node`                      | the pure halves of Vault Unlock: unwrapping a Master Key, and the Biometric Unlock policy over a fake keystore                     |
| `mobile-feat-auth`  | `libs/mobile/feat/auth/jest.config.ts`  | `node`                      | refreshing the Session over a fake keychain: which refresh failures end it, and refresh-on-401                                     |

`@nx/jest` infers a `test` target from each config, so `yarn nx test mobile-core` resolves without
a declared target and CI's `nx affected -t test` runs all five.

`apps/mobile/jest.config.ts` also exists, wired to `yarn nx test mobile`, and still holds no test
files. Its `passWithNoTests: true` means that target reports success by finding nothing, which is
not evidence of anything.

## Rendering, in `mobile-ui`

`@testing-library/react-native` **14** and `test-renderer@1` replaced RNTL 13 and the deprecated
`react-test-renderer` in #910, which is what unblocked this. Three details of the project are
load-bearing:

- **`render` is async.** `await render(<X />)`. Without the `await`, `screen` throws
  "`render` function has not been called", which reads as a broken component rather than as a
  missing keyword.
- **The resolver is chained**, in `libs/mobile/ui/jest.resolver.js`. Reanimated 4 and
  `react-native-worklets` publish a Jest resolver that picks their plain implementations over the
  `.native` ones, which throw on import with no native module behind them. It ends in Jest's
  default resolver, and this workspace needs the Nx one there for path aliases, so the file runs
  one into the other. With the Nx resolver alone, every spec that imports Reanimated fails to load.
- **Native modules are stubbed once**, in `libs/mobile/ui/jest.setup.ts`, each with the double its
  own package publishes. A new native dependency is added there, not in a spec, so every spec sees
  the same device.

Every component needs a `ThemeProvider` around it: `useTheme` throws outside one on purpose, so
that a missing provider reads as the wiring mistake it is rather than as a light-mode app.

## What a spec in `mobile-core` or `mobile-screens` may import

**Nothing that reaches a renderer.** Neither project configures one, so a spec there must not
import `react-native`, `react`, `@testing-library/react-native`, the library's own barrel, or any
component.

A type-only import (`import type { TextStyle } from 'react-native'`) is fine: it is erased before
Jest sees it. That is how `libs/mobile/ui/src/typeScale.ts` and
`libs/mobile/screens/src/navigationTheme.ts` are testable while naming React Native types.

The practical consequence is a design one: keep the logic worth asserting reachable without a
renderer and the cheapest lane stays open. Theme resolution, the Type Scale conversion, the shadow
conversion, and the Device Settings parsing are all pure for that reason.

`mobile-feat-vault` is the sharpest case, because the alternative there is a device. Both halves of
the Biometric Unlock feature are written to be reachable from this environment:
`libs/mobile/feat/vault/src/biometric/keystore.ts` is the interface and the outcome vocabulary and
imports nothing, while `nativeKeystore.ts` beside it is the only file that names
`react-native-keychain`. The policy imports the first and never the second, so every rule about
when the stored key is deleted is exercised against a fake
([ADR 0108](../../adr/0108-a-mobile-device-may-hold-the-master-key-behind-a-biometric-gate.md)
decision 7). A spec here must still import the modules it tests by relative path: the library barrel
reaches `react-native-quick-crypto` and stops the suite.

## Running one

```bash
node node_modules/.bin/jest --config=libs/mobile/ui/jest.config.ts --no-coverage --forceExit
```

The mobile verification gate is **lint + typecheck + format** (ADR 0005) plus
`yarn mobile-platform:check`, and mobile work takes no specialist hop for the implementation (see
the gate matrix in [`AGENTS.md`](../../../AGENTS.md)). Tests still go through
`TestScaffold → TestReviewer → TestRunner`.

Note that `tools/scripts/check-mobile-platform.test.ts` is **not** a Jest test — it is a
`node --test` sibling of its checker, like every other `tools/scripts/check-*.mjs`, and it runs
through `yarn gates:run` rather than through Jest.
