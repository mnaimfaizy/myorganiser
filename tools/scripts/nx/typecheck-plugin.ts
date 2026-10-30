// The local Nx plugin that gives every project an Inferred Target `typecheck`
// (ADR 0141).
//
// Registered in `nx.json` as `./tools/scripts/nx/typecheck-plugin.ts`.
//
// `yarn typecheck:check` used to compile all 73 tsconfigs of all 39 projects
// in one workspace-level script, 200s on every pull request, however small
// the diff. A target per project is a cacheable Nx task instead: `nx affected
// -t typecheck` compiles the projects a change can reach, and the rest are
// restored from the computation cache.
//
// Inferred rather than declared, because ADR 0082 is ratcheting Declared
// Targets down, and because a target 39 `project.json` files declare by hand
// is 39 places a new project can forget one — exactly the Gate Coverage hole
// the workspace script closed. `@nx/js/typescript`'s own inference is not
// usable here: it requires project references and forbids the `paths` aliases
// `tsconfig.base.json` is built on (ADR 0141).
//
// The configs are today's `check-typecheck.ts` rules, unchanged: every
// production config that exists, `tsconfig.json` as a fallback when none do,
// plus the spec config. `tools/scripts` is deliberately outside this plugin.
// Nx does infer a `scripts` node there, from its `package.json` — what it has
// no part of is a committed `project.json` (ADR 0135), which is what this
// plugin keys on, so that node carries no `typecheck` target and
// `tools/scripts/tsconfig.json` stays the fixed job `check-typecheck.ts`
// runs.
//
// Self-contained on purpose: Nx loads this file while it is building the
// project graph, before any workspace tooling is available, so it imports
// nothing but node builtins and types.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { CreateNodesV2, TargetConfiguration } from '@nx/devkit';

/**
 * A project's production programs, in the order they are compiled. Every one
 * that exists is checked.
 *
 * `tsconfig.web.json` is a second production program, not an alias for the app
 * one. apps/mobile targets React Native and react-native-web, and ADR 0103
 * splits its typecheck in two: `tsconfig.app.json` is the native program, with
 * no `dom` and the `.web` Platform Variants excluded, and `tsconfig.web.json`
 * is the only config that compiles those variants (`crypto.web.ts`,
 * `main-web.tsx`) under `moduleSuffixes`.
 */
export const PRODUCTION_CONFIG_NAMES = [
  'tsconfig.lib.json',
  'tsconfig.app.json',
  'tsconfig.web.json',
] as const;

/**
 * The production program of a project that has none of the above. A Next.js
 * app keeps its one program in `tsconfig.json` because that is the file
 * `next build` reads, so apps/web has no `tsconfig.app.json`, and apps/web-e2e
 * has no other config at all. Matching only the suffixed names compiled the
 * web app's specs and nothing else (#1060).
 *
 * It is a fallback, not a fourth name: beside a production config,
 * `tsconfig.json` is the editor's umbrella over the same files.
 */
export const FALLBACK_CONFIG_NAME = 'tsconfig.json';

/**
 * Checked alongside whichever production program a project has, because
 * production code and specs compile under different options. The four type
 * errors #1060 found in `libs/web/pages/groceries` lived only here.
 */
export const SPEC_CONFIG_NAME = 'tsconfig.spec.json';

/** The target name the plugin infers. Overridable for the Contract Suite. */
export const DEFAULT_TARGET_NAME = 'typecheck';

/**
 * The target a project declares when its sources need generated code before
 * they compile. `apps/backend/src/prisma` is gitignored, so a fresh checkout
 * has no `@prisma/client` for the backend's program to compile against and
 * `tsc` reports 33 errors that say nothing about the diff. The backend's
 * `build`, `serve` and `test` targets already declare this dependency by this
 * name; typecheck needs it just as much, so the rule reads the project's own
 * `project.json` rather than naming `backend` here.
 */
export const GENERATED_TYPES_TARGET = 'generate-types';

export interface TypecheckPluginOptions {
  /** Defaults to `typecheck`. */
  targetName?: string;
}

/** Whether a path exists, injected so the Contract Suite can use fixtures. */
export type Exists = (path: string) => boolean;

/**
 * The tsconfigs of one project, in compile order: every production config that
 * exists, or `tsconfig.json` when none do, then the spec config.
 *
 * @param projectRoot absolute path to the project's root
 * @param exists existence probe, defaulting to the real filesystem
 * @returns config file names relative to `projectRoot`; empty when the project
 *   has no tsconfig this plugin compiles
 */
export function typecheckConfigsFor(
  projectRoot: string,
  exists: Exists = existsSync,
): string[] {
  const has = (config: string) => exists(join(projectRoot, config));
  const production = PRODUCTION_CONFIG_NAMES.filter(has);
  const configs: string[] = [...production];
  if (production.length === 0 && has(FALLBACK_CONFIG_NAME)) {
    configs.push(FALLBACK_CONFIG_NAME);
  }
  if (has(SPEC_CONFIG_NAME)) configs.push(SPEC_CONFIG_NAME);
  return configs;
}

/**
 * The `typecheck` target for a project, or `undefined` when it has no config
 * to compile.
 *
 * The inputs are the project's own files (`default`, not `production`: the
 * spec program is in scope, and `production` excludes exactly the spec
 * sources, spec config and test setup it compiles), its dependencies'
 * production files (`^production`, because a type error can arrive from a
 * dependency's public surface), and the two workspace files a program's
 * meaning depends on without importing: `tsconfig.base.json`, which holds
 * every `paths` alias and the global `types`, and `yarn.lock`, which pins the
 * TypeScript version and every `@types` package. Neither is under a project
 * root, so neither reaches the cache key through `default`.
 *
 * @param projectRoot project root, relative to the workspace root
 * @param configs config file names from `typecheckConfigsFor`
 * @param declaredTargets the project.json `targets` block, read for
 *   {@link GENERATED_TYPES_TARGET}
 */
export function typecheckTargetFor({
  projectRoot,
  configs,
  declaredTargets = {},
}: {
  projectRoot: string;
  configs: string[];
  declaredTargets?: Record<string, unknown>;
}): TargetConfiguration | undefined {
  if (configs.length === 0) return undefined;

  const target: TargetConfiguration = {
    cache: true,
    executor: 'nx:run-commands',
    inputs: [
      'default',
      '^production',
      '{workspaceRoot}/tsconfig.base.json',
      '{workspaceRoot}/yarn.lock',
      { externalDependencies: ['typescript'] },
    ],
    outputs: [],
    options: {
      cwd: projectRoot,
      command: configs
        .map((config) => `tsc --noEmit -p ${config}`)
        .join(' && '),
    },
    metadata: {
      technologies: ['typescript'],
      description: `Type-checks ${configs.join(' and ')}.`,
    },
  };

  if (Object.hasOwn(declaredTargets, GENERATED_TYPES_TARGET)) {
    target.dependsOn = [GENERATED_TYPES_TARGET];
  }

  return target;
}

/** Reads a project.json `targets` block, treating an unreadable file as none. */
function declaredTargetsOf(configFile: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(configFile, 'utf8')) as {
      targets?: Record<string, unknown> | null;
    };
    return parsed.targets ?? {};
  } catch {
    return {};
  }
}

/**
 * Keyed on `project.json`, not on the tsconfigs themselves. A tsconfig is not
 * what makes a directory a project: globbing them would reach
 * `tools/scripts/tsconfig.json`, which ADR 0135 keeps as a fixed job, and
 * would invent a project node at any other root that merely has one. Every
 * project in this workspace is defined by a committed `project.json`,
 * including every one Nx's generators produce, so this reaches all of them
 * and nothing else.
 */
export const createNodesV2: CreateNodesV2<TypecheckPluginOptions> = [
  '**/project.json',
  (configFiles, options, context) => {
    const targetName = options?.targetName ?? DEFAULT_TARGET_NAME;

    return configFiles.map((configFile) => {
      const projectRoot = dirname(configFile);
      const configs = typecheckConfigsFor(
        join(context.workspaceRoot, projectRoot),
      );
      const target = typecheckTargetFor({
        projectRoot,
        configs,
        declaredTargets: declaredTargetsOf(
          join(context.workspaceRoot, configFile),
        ),
      });

      if (!target) return [configFile, {}] as const;

      return [
        configFile,
        { projects: { [projectRoot]: { targets: { [targetName]: target } } } },
      ] as const;
    });
  },
];
