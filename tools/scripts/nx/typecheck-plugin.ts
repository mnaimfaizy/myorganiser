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
import { dirname, join, relative, resolve } from 'node:path';

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
 * Always an input, whether or not a config's `extends` chain reaches it. It
 * holds every `paths` alias and the global `types`, so no program in this
 * workspace is independent of it, and {@link outsideRootExtends} failing to
 * read one link of one chain must not be able to drop it.
 */
export const BASE_CONFIG_PATH = 'tsconfig.base.json';

/** Reads a file, or returns null when it cannot be read. */
export type ReadConfig = (path: string) => string | null;

const readOrNull: ReadConfig = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

/**
 * Reads the config an `extends` path names, trying the forms TypeScript
 * accepts: the path as written, the path with `.json` appended, and the path
 * as a directory holding a `tsconfig.json`. Every `extends` in this workspace
 * currently spells the `.json`, but the two shorter forms are legal, and a
 * config this function failed to read is a config whose `extends` link would
 * silently leave the cache key — the defect the caller exists to prevent.
 *
 * @returns the path that read and its text, or null when none of them read
 */
function readConfigLink(
  base: string,
  readConfig: ReadConfig,
): { path: string; text: string } | null {
  for (const candidate of [base, `${base}.json`, join(base, 'tsconfig.json')]) {
    const text = readConfig(candidate);
    if (text !== null) return { path: candidate, text };
  }
  return null;
}

/**
 * Parses a tsconfig, which is JSON with comments and trailing commas.
 *
 * `JSON.parse` rejects both, and most tsconfigs in this workspace carry a
 * comment explaining an option — so a plain parse would silently treat the
 * common case as an unreadable config and drop its `extends` link from the
 * cache key, which is the one failure this whole function exists to avoid.
 * The scan tracks string literals rather than stripping `//` everywhere,
 * because a config value is often a path.
 *
 * @returns the parsed value, or null when it is not JSON even after stripping
 */
export function parseTsconfig(text: string): unknown {
  let out = '';
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      const start = index;
      index += 1;
      while (index < text.length) {
        if (text[index] === '\\') {
          index += 2;
          continue;
        }
        if (text[index] === '"') {
          index += 1;
          break;
        }
        index += 1;
      }
      out += text.slice(start, index);
      continue;
    }
    if (char === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end === -1 ? text.length : end + 2;
      continue;
    }
    // A trailing comma is dropped here rather than by a regex over the
    // finished text, for the same reason the comments are: `out` holds whole
    // string literals, so a closer reached outside one can only ever strip a
    // comma that is itself outside one. A regex pass would rewrite
    // `{"x": "a,]"}` to `{"x": "a]"}` — a path value quietly altered.
    if (char === '}' || char === ']') out = out.replace(/,\s*$/, '');
    out += char;
    index += 1;
  }
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

/**
 * Every config a project's programs `extends`, transitively, that sits
 * outside the project root — as workspace-relative paths, sorted.
 *
 * A config's options are not all written in the file the target compiles.
 * `libs/mobile/core/tsconfig.lib.json` extends `./tsconfig.json`, which
 * extends `../tsconfig.mobile.json`, which is where ADR 0120's `types: []`
 * and ADR 0103's `lib: ["esnext"]` are actually enforced for all seven
 * `libs/mobile/*` programs — and `libs/mobile` is under no project root, so
 * `default` does not reach it. Without this, editing that file left every
 * mobile library's result in the cache and the gate those two ADRs name
 * passed without ever applying the new options.
 *
 * A link inside the project root is left out: `default` already covers it.
 * A link that is a bare package specifier (`@tsconfig/node22/tsconfig.json`)
 * is left out too — it resolves into `node_modules`, which `yarn.lock`
 * pins.
 *
 * A link that reads under none of the three forms is skipped rather than
 * guessed at, which leaves it out of the cache key — safely, because `tsc`
 * rejects a config whose `extends` resolves to nothing, so that run fails and
 * Nx caches no result for it. The day the file appears there is no green
 * entry to restore, and the target recompiles.
 *
 * @param workspaceRoot absolute path to the workspace root
 * @param projectRoot project root, relative to the workspace root
 * @param configs config file names, relative to the project root
 * @param readConfig file reader, injected so the Contract Suite uses fixtures
 */
export function outsideRootExtends({
  workspaceRoot,
  projectRoot,
  configs,
  readConfig = readOrNull,
}: {
  workspaceRoot: string;
  projectRoot: string;
  configs: string[];
  readConfig?: ReadConfig;
}): string[] {
  const projectDir = resolve(workspaceRoot, projectRoot);
  const seen = new Set<string>();
  const outside = new Set<string>();
  // `isLink` is false for the project's own compiled configs, which `default`
  // covers, and true for everything reached through an `extends`. `seen`
  // bounds the walk: a config that extends one already visited — a cycle, or
  // two of a project's programs sharing a base — stops here rather than
  // looping, and a hang would wedge every `nx` command, because this runs
  // while the project graph is being built.
  const queue = configs.map((config) => ({
    base: resolve(projectDir, config),
    isLink: false,
  }));

  for (let item = queue.shift(); item; item = queue.shift()) {
    if (seen.has(item.base)) continue;
    seen.add(item.base);

    const read = readConfigLink(item.base, readConfig);
    if (read === null) continue;

    if (item.isLink && relative(projectDir, read.path).startsWith('..')) {
      outside.add(relative(workspaceRoot, read.path).replace(/\\/g, '/'));
    }

    const parsed = parseTsconfig(read.text);
    if (parsed === null || typeof parsed !== 'object') continue;

    const raw = (parsed as { extends?: unknown }).extends;
    const links = (Array.isArray(raw) ? raw : [raw]).filter(
      (link): link is string => typeof link === 'string' && link.length > 0,
    );
    for (const link of links) {
      if (!link.startsWith('.')) continue;
      queue.push({ base: resolve(dirname(read.path), link), isLink: true });
    }
  }

  outside.delete(BASE_CONFIG_PATH);
  return [...outside].sort();
}

/**
 * The `typecheck` target for a project, or `undefined` when it has no config
 * to compile.
 *
 * The inputs are the project's own files (`default`, not `production`: the
 * spec program is in scope, and `production` excludes exactly the spec
 * sources, spec config and test setup it compiles), its dependencies'
 * production files (`^production`, because a type error can arrive from a
 * dependency's public surface), and the files outside the project root that a
 * program's meaning depends on without importing: `tsconfig.base.json`, which
 * holds every `paths` alias and the global `types`; every other config the
 * programs `extends` from outside the root (`extendsOutsideRoot`, from
 * {@link outsideRootExtends}); and `yarn.lock`, which pins the TypeScript
 * version and every `@types` package. None of them is under a project root,
 * so none reaches the cache key through `default`.
 *
 * The list is built in a fixed order, and `extendsOutsideRoot` arrives
 * sorted, because the input list is itself part of the cache key: a set
 * whose order moved between two runs would miss every cache entry the other
 * run wrote.
 *
 * @param projectRoot project root, relative to the workspace root
 * @param configs config file names from `typecheckConfigsFor`
 * @param extendsOutsideRoot workspace-relative configs from
 *   {@link outsideRootExtends}
 * @param declaredTargets the project.json `targets` block, read for
 *   {@link GENERATED_TYPES_TARGET}
 */
export function typecheckTargetFor({
  projectRoot,
  configs,
  extendsOutsideRoot = [],
  declaredTargets = {},
}: {
  projectRoot: string;
  configs: string[];
  extendsOutsideRoot?: string[];
  declaredTargets?: Record<string, unknown>;
}): TargetConfiguration | undefined {
  if (configs.length === 0) return undefined;

  const target: TargetConfiguration = {
    cache: true,
    executor: 'nx:run-commands',
    inputs: [
      'default',
      '^production',
      `{workspaceRoot}/${BASE_CONFIG_PATH}`,
      ...extendsOutsideRoot.map((path) => `{workspaceRoot}/${path}`),
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
        extendsOutsideRoot: outsideRootExtends({
          workspaceRoot: context.workspaceRoot,
          projectRoot,
          configs,
        }),
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
