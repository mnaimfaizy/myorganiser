# Testing `libs/core`

Jest unit · `ts-jest` or `babel-jest` · `yarn nx test core`

## Config summary

Read `libs/core/jest.config.ts` for the active transformer. `libs/core` holds framework-free
utilities (currency formatting, geo, time, account settings, ids), so tests are plain unit tests
with no module mocking. Most of it still has no specs — the Vault record shapes and merges it used
to carry moved to `libs/vault-core` with their specs (#164) — but `formatUsd` (currency) and
`localDateKey` (time) each have one, so the config keeps `passWithNoTests` rather than requiring
every remaining helper to carry a test.

`jest.config.ts` also points `globalSetup` at `jest.global-setup.js`, which pins the process
timezone to a fixed, non-UTC zone before any worker touches a `Date`. `localDateKey`'s test needs a
real local/UTC-day split to mean anything, and reassigning `process.env.TZ` from inside a test or
`setupFiles` does not reliably affect a worker's already-initialized `Date` behavior — see that
file's own comment for why `globalSetup` is the one hook that does.

## Patterns

- Test pure functions directly — no `jest.mock()` should be needed inside this library.
- Assert exact values (`toBe` / `toEqual`), not shape checks.
- Non-deterministic helpers (`randomId`, timestamp generators) are the exception: assert the
  contract (format, uniqueness, length), not a fixed value.

## Note for consumers

`@myorganiser/core` is lazy-loaded, so **downstream** libraries mocking it must place
`jest.mock('@myorganiser/core', ...)` before every import — see the
[Nx lazy-loading & `jest.mock()` ordering rule](../README.md#nx-lazy-loading--jestmock-ordering).

## Commands

```bash
yarn nx test core
yarn nx lint core
```
