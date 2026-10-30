# Typecheck is a cached per-project Inferred Target

## Status

accepted

## Context

`yarn typecheck:check` was one workspace-level script that compiled every tsconfig in the
repository: 73 configs across 39 projects, about 200s, on every pull request however small the
diff. Measured over 100 pull request runs (2026-10-17 → 10-29) a successful CI run took 11.3 min at
the median, and typecheck was the single largest step in the `Test` job
([#1374](https://github.com/mnaimfaizy/myorganiser/issues/1374)). Almost all of that work was
spent on projects the diff could not reach: a change to `libs/web/pages/legal` compiled all 73.

The script's own header recorded why it was a script in the first place, and the reason has
expired. It said that 30-odd new `project.json` targets would prejudge
[#420](https://github.com/mnaimfaizy/myorganiser/issues/420)'s open decision between
executor-based Declared Targets and plugin-Inferred Targets. That decision is settled:
[ADR 0082](0082-nx-targets-are-inferred-and-a-declared-target-is-migration-debt.md) ratchets Declared Targets down toward
Inferred ones, and `yarn nx:declared-targets:check` is the ratchet. So the choice is no longer
"script or 39 hand-declared targets"; it is "script or inference".

Inference is also what keeps the Gate Coverage the script bought. The script's real virtue was
that it needed no per-project wiring: a newly generated project was compiled the moment its
tsconfig existed, with nobody remembering to add anything. Thirty-nine hand-written targets would
give that up — prose asking contributors to add one has already lost once in this repo, which is
why ADR 0082's ratchet exists. A plugin keeps the property: the rule lives in one file and applies
to every project, including the next one.

`@nx/js/typescript`, Nx's own typecheck inference, cannot be used. It requires TypeScript project
references between projects and it does not support the `paths` aliases every import in this
workspace resolves through (`tsconfig.base.json`). Adopting it means migrating the whole workspace
off path aliases onto project references, which is a far larger change than this one and is out of
scope for [#1387](https://github.com/mnaimfaizy/myorganiser/issues/1387).

One TypeScript program has no project to attach to. `tools/scripts` carries no committed
`project.json` on purpose ([ADR 0135](0135-tooling-scripts-are-typescript-run-by-node-and-tested-by-node-test.md)).
Nx does infer a `scripts` node there from its `package.json` — what the directory has no part of
is the `project.json` the decision below keys inference on, so no node in the graph is going to
carry a `typecheck` target that owns `tools/scripts/tsconfig.json`.

## Decision

1. **A local Nx plugin infers a `typecheck` target for every project.** It lives at
   `tools/scripts/nx/typecheck-plugin.ts` and is registered in `nx.json`. The target is
   `cache: true`, so Nx can restore a result instead of recompiling.

2. **The configs are the previous checker's rules, moved rather than rewritten.** Every production
   config that exists (`tsconfig.lib.json`, `tsconfig.app.json`, `tsconfig.web.json`),
   `tsconfig.json` as a fallback when a project has none of them, plus `tsconfig.spec.json`. Each
   is compiled with `tsc --noEmit -p <config>` from the project root. `tsconfig.web.json` is a
   second production program and not an alias for the app one
   ([ADR 0103](0103-mobile-native-code-is-typechecked-without-dom-and-reaches-shared-libraries-through-a-portable-entry-point.md));
   the spec config is in scope because four of the type errors that motivated the original gate
   lived only there ([#1060](https://github.com/mnaimfaizy/myorganiser/issues/1060)).

3. **Inference is keyed on `project.json`, not on tsconfigs.** A tsconfig is not what makes a
   directory a project. Globbing tsconfigs would reach `tools/scripts/tsconfig.json`, which item 6
   keeps as a fixed job, and would invent a project node at any other root that merely has one.
   Every project in this workspace is defined by a committed `project.json`, including every one
   Nx's generators produce, so the glob reaches all of them and nothing else.

4. **The cache inputs are the project's own files, its dependencies' production files, and every
   file outside the project root that its programs' meaning depends on.** `default` rather than
   `production`, because `production` excludes exactly the spec sources, spec config and test
   setup that item 2 compiles. `^production`, because a type error can arrive from a dependency's
   public surface. `{workspaceRoot}/tsconfig.base.json`, which holds every `paths` alias and the
   global `types`, and `{workspaceRoot}/yarn.lock`, which pins the TypeScript version and every
   `@types` package — neither sits under a project root, so neither reaches the cache key any
   other way.

   So does every other config the compiled programs `extends` from outside the root, resolved
   transitively by the plugin. `tsconfig.base.json` is not the only such file:
   `libs/mobile/core/tsconfig.lib.json` extends `./tsconfig.json`, which extends
   `../tsconfig.mobile.json`, and that is where ADR 0120's `types: []` and ADR 0103's
   `lib: ["esnext"]` are actually enforced for all seven `libs/mobile/*` programs.
   `libs/mobile` is under no project root, so an edit there would otherwise leave every mobile
   library's result in the cache and let the gate those two ADRs name pass without applying the
   new options — and `main` is no backstop, because the push run restores from the same cache
   keys. A link inside the project root is left out, since `default` covers it; a link that is a
   bare package specifier is left out, since it resolves into `node_modules`, which `yarn.lock`
   pins. An `extends` is resolved through all three forms TypeScript accepts — as written, with
   `.json` appended, and as a directory holding a `tsconfig.json` — and the file that actually
   read is what becomes the input, because a link the plugin fails to read is a link that leaves
   the cache key silently.

   What this does not resolve is a file a program reaches through `include`, `files` or `types`
   rather than `extends`. Bounding that means reimplementing the compiler's file resolution, and
   the one case this repo anticipates — the Hermes-globals declaration
   [ADR 0120](0120-a-mobile-program-gets-node-types-only-if-it-runs-on-node.md) asks for under
   `libs/mobile/`, with its first entry — arrives by editing `tsconfig.mobile.json`, which is an
   input.

   The input list is built in a fixed order, and the resolved configs arrive sorted, because the
   list is itself part of the cache key: an order that moved between two runs would miss every
   entry the other wrote.

5. **A project whose `project.json` declares `generate-types` gets `dependsOn: ['generate-types']`.**
   `apps/backend/src/prisma` is generated and gitignored, so a fresh checkout has no
   `@prisma/client` for the backend's program to compile against and `tsc` reports 33 errors that
   say nothing about the diff. The rule reads the project's own targets rather than naming
   `backend`, because the backend's `build`, `serve` and `test` targets already declare that
   dependency by that name.

6. **`tools/scripts` stays a fixed job.** The `scripts` node Nx infers from its `package.json` has
   no `project.json`, so item 3 gives it no `typecheck` target and `run-many` cannot reach its
   config. `yarn typecheck:check` becomes `nx run-many -t typecheck`
   plus `tsc -p tools/scripts/tsconfig.json --noEmit`, and keeps its name: it is still the one
   whole-tree typecheck command, for `main` and for a local run.
   `yarn typecheck:tools-scripts` runs just that half — `typecheck:check --tools-scripts-only`
   under its own script name, because `tools/config/gate-triggers.json` requires every suite id
   to be a runnable script — and that is what CI's path-gated step invokes. Before any script migrates to a different home, that config's `include` can match
   nothing and `tsc` reports TS18003 ("no inputs were found"); that is a vacuous pass rather than a
   type error, so it is normalised to a pass — but only when it is the sole diagnostic.

7. **A pull request typechecks what it can break; `main` typechecks everything.** The `Test` job
   runs `nx affected -t typecheck` on `pull_request` and `nx run-many -t typecheck` otherwise, the
   same split Lint and the Jest step already use. The `tools/scripts` step is path-gated on the
   `typecheck:tools-scripts` triggers in `tools/config/gate-triggers.json`
   ([ADR 0140](0140-a-heavy-assertion-gate-is-path-gated-and-a-covering-gate-is-a-trigger-superset.md)),
   whose `run_all` fallback is set on every push and on any resolver error, so `main` keeps its
   whole-tree guarantee.

8. **`mobile` loses its Declared Target.** `apps/mobile/project.json` declared a `typecheck`
   command that overrode the `typecheck` target `@nx/vite/plugin` infers from
   `apps/mobile/vite.config.mts`, and it compiled the native and web programs but not the spec
   one. The declaration is removed and the inferred target covers all three. This plugin is
   registered after `@nx/vite/plugin` in `nx.json` so that its target wins the merge, and the
   plugin's Contract Suite asserts both that ordering and the resulting command.

## Consequences

- A pull request that changes one library typechecks that library and its dependents. On the
  baseline `libs/web/pages/legal` diff that is `web-pages-legal`, `web` and `web-e2e`; the other
  34 projects are not compiled at all, rather than compiled and cached.
- The `Test` job's Nx computation cache is restored before the typecheck steps rather than before
  the Jest step, or a cacheable typecheck would have nothing to restore from.
- `yarn typecheck:check` no longer takes an Nx graph file. CI builds one graph for the two
  checkers in the `Test` job that still read it (`lint:coverage:check`, `docs:nx-targets:check`).
- `check-typecheck.ts` shrinks to the two halves of item 6 and asserts one direction: a config
  that does not compile fails. It no longer asserts that a project _has_ a target — that is a fact
  about inference, asserted against the live workspace by the plugin's Contract Suite — but it
  does still exit 2 when no project carries the target at all, because `run-many` over a target
  nobody has is a green result meaning "nothing was looked at".
- A new project needs no typecheck wiring. A project with no tsconfig of any of item 2's names
  gets no target, which is why `libs/api-specs` and `libs/app-api-client` — generated and synced
  outputs — have none.
- The cache can now be wrong in a way a script could not be: a compile result is reused when
  nothing in item 4's inputs changed. A global `@types` package or a TypeScript bump invalidates
  every project's result through `yarn.lock`, and an alias change through `tsconfig.base.json`.
- [ADR 0082](0082-nx-targets-are-inferred-and-a-declared-target-is-migration-debt.md)'s baseline does not move. `mobile`'s
  removed `typecheck` block declared no `executor`, so it was never counted as debt; the ratchet
  neither shrinks nor grows here.
- Issue: [#1395](https://github.com/mnaimfaizy/myorganiser/issues/1395). PRD:
  [#1387](https://github.com/mnaimfaizy/myorganiser/issues/1387). Decision:
  [#1379](https://github.com/mnaimfaizy/myorganiser/issues/1379).
