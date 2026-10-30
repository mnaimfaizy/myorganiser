# Tooling scripts are TypeScript, run by Node and tested by `node --test`

Every script under `tools/scripts` moves from `.mjs` to strict TypeScript, which Node runs directly by stripping types. Its tests stay on `node --test` and are reached by one glob target instead of one `package.json` script per suite.

## Status

accepted

## Context

`tools/scripts` is the one part of the workspace outside TypeScript: 273 `.mjs` files and 104 `.test.mjs` Contract Suites, with about 220 hard-coded `tools/scripts/*.mjs` paths across `package.json`, Husky, and eight workflows. No type checker reaches any of it (no `@ts-check`, no `checkJs`), so a wrong argument, a missing field, or a renamed export in tooling is found when a gate misbehaves rather than when it compiles. The convention was never chosen: three suite headers still say "node --test, no jest project covers tools/", which stopped being true when the `tools` Jest project was added ([#406](https://github.com/mnaimfaizy/myorganiser/issues/406)).

The per-suite wiring had a second cost. Each Contract Suite reached CI only if someone added a step for its script, and five did not (`ai:commit:test`, `product-name:test`, `nx:targets:test`, `graphify:project-edges:test`, and two copilot-hooks suites no script ran at all). The Meta-Gate ([ADR 0043](0043-gates-assert-facts.md)) asserts that checkers are wired, not that their suites are.

TypeScript 7 is not the motive. It speeds type checking, not the scripts; it is not adopted here, and its real blockers are in `tsconfig.base.json` (`moduleResolution: "node"`, `baseUrl`), outside this decision.

## Decision

- **Wiring first, separately.** Before any file moves, the five unwired suites are wired into CI and the Meta-Gate also fails on a Contract Suite no wired script runs.
- **Strict TypeScript, run by Node.** Scripts become `.ts` and run as `node script.ts` through Node's type stripping, so `engines` rises to `>=22.18`. Their tsconfig sets `module`/`moduleResolution: nodenext`, `allowImportingTsExtensions`, `noEmit`, `erasableSyntaxOnly`, and `strict`, and `yarn typecheck:check` reaches it. A migrated file carries no `@ts-nocheck`, `@ts-ignore`, or bare `any`; `@ts-expect-error` needs a written reason. A file that cannot pass stays `.mjs` until it can.
- **One runner.** Contract Suites stay on `node --test` as `*.test.ts`, including the six copilot-hooks Jest specs. One `tools:test` script runs `node --test` over the whole glob, and CI runs it in place of the per-suite steps, now in the path-gated `Tool Suites` job ([ADR 0140](0140-a-heavy-assertion-gate-is-path-gated-and-a-covering-gate-is-a-trigger-superset.md)). Husky runs only the staged suites and the suite paired with each staged script, because the full set takes about 34 seconds. `tools/jest.config.ts` is deleted; `tools/testing/web-crypto-test-setup.ts` stays for its consumers.
- **Expand, migrate, contract.** Expand adds the tsconfig, typecheck reach, `engines`, and a Meta-Gate and checker-header convention that accept `check-*.ts` beside `check-*.mjs`. Migrate goes `lib/` first, then each `check-*` script in the same change as its Contract Suite, then `review/`, `ai/`, `ci/`, and `copilot-hooks/`. Contract adds a gate failing any `.mjs` under `tools/scripts`, drops `check-*.mjs` from the Meta-Gate, and updates the docs that name it.

## Considered Options

- **Keep `.mjs` and wire the suites.** Rejected: it fixes the wiring gap but leaves tooling with no type checking, which is the regression risk this decision exists to remove.
- **Keep `.mjs` with `@ts-check` and JSDoc.** Rejected: types in comments are weaker and noisier than the language the rest of the workspace is written in, and it keeps two styles of TypeScript.
- **New scripts in `.ts`, old ones left as they are.** Rejected: two conventions with no end date, and the Meta-Gate and checker headers would have to describe both forever.
- **Run through `tsx`, or compile to `dist/`.** Rejected: `tsx` is a dependency and a slower start for every gate; compiling adds a build step before any hook can run. Type stripping needs neither.
- **Move the suites to Jest.** Rejected: it rewrites every suite's API and reintroduces the CommonJS/ESM interop that made a ts-jest spec unable to import an `.mjs` module under the `tools` Jest project's `module: commonjs`.

## Consequences

- `erasableSyntaxOnly` rules out enums, namespaces, and parameter properties in tooling; a value set is an `as const` object.
- A Contract Suite is wired by existing, once the glob target is the only runner, so the Meta-Gate's suite check reduces to asserting that target is wired.
- `.sandcastle/*.mts` and the `.mjs` files under `.agents/skills` and `libs/email-shell` are out of scope and keep their current form.
- Until contract lands, `docs/agents/repository-conventions.md` and `AGENTS.md` still say `check-*.mjs`; the expand step widens them to both extensions.
