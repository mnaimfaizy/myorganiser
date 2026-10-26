#!/usr/bin/env node
// Asserts that an Nx command printed in tracked Markdown names a project, target, and
// configuration the workspace actually has.
//
//   node tools/scripts/check-doc-nx-targets.mjs [graphFile] [--print]
//
// A documented command is a claim about the workspace: "this project has this target." The
// claim rots when a target is renamed or was never there, and nothing notices, because prose is
// not executed. `DEVELOPMENT.md` taught `yarn nx run backend:type-check` and
// `yarn nx run web:type-check`; neither target has ever existed (issue #980). It is the
// fourth time: the `eslint:lint` target name (#426), the TestReviewer false PASS in ADR 0036,
// and a stale Agent Guide command (#830) were each found by somebody running the command by
// hand. `docs:commands:check` reads the same blocks but asserts only that a path exists.
//
// This is an Assertion Gate in the sense of ADR 0043: it compares two artifacts — the Nx
// commands a document names, and the Nx project graph — and names the reference that is wrong.
// It never asks whether a doc was touched. Direction of travel is one way: a named project,
// target, or configuration that the graph does not have fails. The reverse (every target is
// documented) is omitted because no document claims to list them; most targets are not taught.
//
// What it reads: every tracked `*.md` except `docs/research/` (frozen at the date in the
// filename, ADR 0041) and `CHANGELOG.md` (frozen at each release). In those, every fenced
// `bash`/`sh`/`shell`/`console` block, and every inline backtick span that begins with `nx`,
// `yarn nx` (with or without `corepack`), or `npx nx`. A `$ ` prompt and a leading `VAR=value`
// are read past; a trailing `# comment` and a redirect end the command.
// What it asserts, and only these shapes:
//   1. `nx run <project>:<target>[:<configuration>]` — the project exists, carries the target,
//      and the target carries the configuration when one is named. The longest target name is
//      tried first, as Nx does, so a target called `eslint:lint` is not misread as target
//      `eslint`, configuration `lint`.
//   2. `nx <target> <project>` — the project exists and carries the target. A first word that
//      is no project's target fails only when a real project follows it; otherwise the span is
//      prose that happens to start with `nx`.
//   3. `nx run-many` / `nx affected` — each `-t` target exists on at least one project, and
//      each `-p` project exists. A `-p` value that selects by tag (`tag:…`) or by directory
//      (`apps/backend`) is not a project name and is not asserted.
//
// What it deliberately skips, and why:
//   - Whether the command succeeds. Resolving is a fact about the graph; passing is a fact
//     about the code, and the target's own CI step asserts that.
//   - Flags, and `yarn` script aliases such as `yarn start:backend`. `package.json` owns an
//     alias; a flag is a claim about a tool's CLI, not about this workspace.
//   - `yaml`, `json`, and untagged fences. A workflow snippet quotes a file with gates of its
//     own, and an untagged fence holds too much that is not a command to parse safely.
//   - Project names handed to an Nx subcommand (`nx show project <name>`, `nx graph --focus`).
//     The subcommand list below is skipped whole; no dead reference found so far had this shape.
//   - Placeholders — `<project>`, `$APP`, globs. Holes for the reader to fill, same judgement
//     as `docs:commands:check`. An example that is not a placeholder must name a real project.
//
// A reference that must keep a dead name — a merged ADR recording what a command used to be
// (ADR 0104) — lives in tools/config/doc-nx-targets-exemptions.json with a written reason. A
// stale entry fails.
//
// This needs the Nx project graph, so it runs in CI and not in the pre-commit aggregate
// (ADR 0043). Reading `project.json` instead would miss every inferred target.
//
// Exit 0 = every reference resolves, or is exempted. Exit 1 = at least one does not, or an
// exemption is stale. Exit 2 = cannot run, including when the graph cannot be built.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createCheckerFail,
  hasPathPlaceholder,
  listTrackedMarkdown,
} from './lib/doc-paths.ts';
import { GraphUnavailableError, loadProjectGraph } from './lib/nx-graph.ts';
import { tokenize } from './lib/shell-command.ts';

const PREFIX = 'doc-nx-targets';
const EXEMPTIONS_PATH = 'tools/config/doc-nx-targets-exemptions.json';
const SCHEMA_VERSION = 1;

const SHELL_FENCES = new Set(['bash', 'sh', 'shell', 'console']);
const FENCE_LINE = /^\s*(`{3,}|~{3,})\s*([\w-]*)/;
const INLINE_CODE = /`([^`\n]+)`/g;
const INLINE_COMMAND = /^(?:(?:corepack\s+)?yarn\s+|npx\s+)?nx\s/;
const CHAINING = /&&|\|\||[;|]/g;
const REDIRECT = /^\d*>|^<$/;
const COMMAND_SEPARATORS = new Set(['&&', '||', ';', '|']);

/**
 * Nx's own subcommands: a first word here is never a target, so nothing after it is asserted.
 * Hand-maintained, and wrong only in the safe direction — a subcommand missing from the list
 * is read as a target, and fails only if a real project name follows it.
 */
const NX_SUBCOMMANDS = new Set([
  'add',
  'configure-ai-agents',
  'connect',
  'daemon',
  'exec',
  'fix-ci',
  'format',
  'format:check',
  'format:write',
  'g',
  'generate',
  'graph',
  'import',
  'init',
  'list',
  'login',
  'logout',
  'mcp',
  'migrate',
  'release',
  'repair',
  'report',
  'reset',
  'show',
  'sync',
  'sync:check',
  'view-logs',
  'watch',
]);

const TARGET_FLAGS = new Set(['-t', '--target', '--targets']);
const PROJECT_FLAGS = new Set(['-p', '--projects']);

const fail = createCheckerFail(PREFIX);

const isPlaceholder = (token) =>
  hasPathPlaceholder(token) || token.includes('...') || token.includes('…');

/** The values of `-t a,b`, `-t a b`, and `--targets=a,b`, keyed by which flag carried them. */
function listFlagValues(args) {
  const values = { targets: [], projects: [] };
  let bucket = null;
  for (const arg of args) {
    if (arg.startsWith('-')) {
      const [flag, inline] = arg.split(/=(.*)/s);
      bucket = TARGET_FLAGS.has(flag)
        ? values.targets
        : PROJECT_FLAGS.has(flag)
          ? values.projects
          : null;
      if (bucket && inline) bucket.push(...inline.split(','));
      continue;
    }
    if (bucket) bucket.push(...arg.split(','));
  }
  // `--targets="lint,test"` inside an inline span keeps its quotes through the tokenizer.
  const concrete = (list) =>
    list
      .map((value) => value.replace(/^["']+|["']+$/g, ''))
      .filter((value) => value && !isPlaceholder(value));
  return {
    targets: concrete(values.targets),
    // `tag:scope:web` selects by tag and `apps/backend` by directory; neither is a project name.
    projects: concrete(values.projects).filter(
      (project) => !project.startsWith('tag:') && !project.includes('/'),
    ),
  };
}

/**
 * The references one `nx …` invocation makes. `args` is everything after `nx`.
 * Each reference carries `claim`, the normalized text an exemption is keyed on.
 */
export function referencesOf(args) {
  const [first, ...rest] = args;
  if (!first || first.startsWith('-') || isPlaceholder(first)) return [];

  if (first === 'run') {
    const spec = rest.find((arg) => !arg.startsWith('-'));
    if (!spec || isPlaceholder(spec) || !spec.includes(':')) return [];
    return [{ kind: 'run', spec, claim: `nx run ${spec}` }];
  }

  if (first === 'run-many' || first === 'affected') {
    const { targets, projects } = listFlagValues(rest);
    return [
      ...targets.map((target) => ({
        kind: 'any-target',
        target,
        claim: `nx ${first} -t ${target}`,
      })),
      ...projects.map((project) => ({
        kind: 'project',
        project,
        claim: `nx ${first} -p ${project}`,
      })),
    ];
  }

  if (NX_SUBCOMMANDS.has(first)) return [];

  const project = rest[0];
  if (!project || project.startsWith('-') || isPlaceholder(project)) return [];
  return [
    {
      kind: 'infix',
      target: first,
      project,
      claim: `nx ${first} ${project}`,
    },
  ];
}

/** Every `nx …` invocation on one command line, split on shell chaining. */
function invocationsOf(line) {
  const invocations = [];
  let command = [];
  const flush = () => {
    const redirect = command.findIndex((token) => REDIRECT.test(token));
    if (redirect >= 0) command = command.slice(0, redirect);
    const at = command.findIndex(
      (token, index) =>
        token === 'nx' &&
        (index === 0 ||
          ['yarn', 'npx', '$'].includes(command[index - 1]) ||
          /^\w+=/.test(command[index - 1])),
    );
    if (at >= 0) invocations.push(command.slice(at + 1));
    command = [];
  };
  // `a; b` and `a|b` chain without a space, so every separator gets a token of its own.
  for (const token of tokenize(line.replace(CHAINING, ' $& '))) {
    if (token.startsWith('#')) break; // the rest of the line is a shell comment
    if (COMMAND_SEPARATORS.has(token)) flush();
    else command.push(token);
  }
  flush();
  return invocations;
}

/**
 * Collect the Nx references one Markdown document makes, each with its 1-based line.
 * A command continued with a trailing backslash is reported at the line it starts on.
 */
export function collectReferences(text) {
  const references = [];
  const push = (line, command) => {
    for (const args of invocationsOf(command)) {
      for (const reference of referencesOf(args)) {
        references.push({ line, ...reference });
      }
    }
  };

  let fence = null; // { marker, shell } while inside a fenced block
  let pending = null; // { line, text } while a shell command continues
  text.split('\n').forEach((raw, index) => {
    const line = index + 1;
    const fenceLine = raw.match(FENCE_LINE);
    if (fence) {
      if (fenceLine && fenceLine[1].startsWith(fence.marker) && !fenceLine[2]) {
        fence = null;
        pending = null;
        return;
      }
      if (!fence.shell) return;
      if (raw.trim().startsWith('#')) return; // a shell comment
      const start = pending?.line ?? line;
      const joined = (pending ? `${pending.text} ` : '') + raw;
      if (joined.trimEnd().endsWith('\\')) {
        pending = { line: start, text: joined.trimEnd().slice(0, -1) };
        return;
      }
      pending = null;
      push(start, joined);
      return;
    }
    if (fenceLine) {
      fence = {
        marker: fenceLine[1],
        shell: SHELL_FENCES.has(fenceLine[2].toLowerCase()),
      };
      return;
    }
    for (const span of raw.matchAll(INLINE_CODE)) {
      const command = span[1].trim();
      if (INLINE_COMMAND.test(`${command} `)) push(line, command);
    }
  });
  return references;
}

/**
 * @param {Record<string, { data?: { targets?: Record<string, { configurations?: object }> } }>} nodes
 * @returns {string | null} Why the reference does not resolve, or null when it does. A first
 * word that is neither a target nor followed by a real project is not a claim, and resolves.
 */
export function unresolvedReason(reference, nodes) {
  const targetsOf = (project) => nodes[project]?.data?.targets ?? {};
  const hasProject = (project) => Object.hasOwn(nodes, project);
  const hasTarget = (project, target) =>
    Object.hasOwn(targetsOf(project), target);
  const anyProjectHas = (target) =>
    Object.keys(nodes).some((project) => hasTarget(project, target));
  const noProject = (project) => `no project named \`${project}\``;
  const noTarget = (project, target) =>
    `project \`${project}\` has no target \`${target}\``;

  switch (reference.kind) {
    case 'project':
      return hasProject(reference.project)
        ? null
        : noProject(reference.project);
    case 'any-target':
      return anyProjectHas(reference.target)
        ? null
        : `no project has a target \`${reference.target}\``;
    case 'infix': {
      const { target, project } = reference;
      if (!hasProject(project)) {
        return anyProjectHas(target) ? noProject(project) : null;
      }
      return hasTarget(project, target) ? null : noTarget(project, target);
    }
    case 'run': {
      const colon = reference.spec.indexOf(':');
      const project = reference.spec.slice(0, colon);
      const rest = reference.spec.slice(colon + 1);
      if (!hasProject(project)) return noProject(project);
      if (hasTarget(project, rest)) return null;
      for (
        let at = rest.lastIndexOf(':');
        at > 0;
        at = rest.lastIndexOf(':', at - 1)
      ) {
        const target = rest.slice(0, at);
        if (!hasTarget(project, target)) continue;
        const configuration = rest.slice(at + 1);
        const configurations = targetsOf(project)[target]?.configurations ?? {};
        return Object.hasOwn(configurations, configuration)
          ? null
          : `target \`${project}:${target}\` has no configuration \`${configuration}\``;
      }
      return noTarget(project, rest);
    }
    default:
      throw new Error(`unknown reference kind: ${reference.kind}`);
  }
}

function readExemptions({ cwd, path = EXEMPTIONS_PATH }) {
  const absolute = join(cwd, path);
  if (!existsSync(absolute)) {
    fail(`${path} not found — the exemption list is a required artifact`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (error) {
    fail(`${path} is not valid JSON: ${error.message}`);
  }
  if (parsed?.schemaVersion !== SCHEMA_VERSION) {
    fail(
      `${path}: expected "schemaVersion": ${SCHEMA_VERSION}, found ${JSON.stringify(parsed?.schemaVersion)}`,
    );
  }
  if (!Array.isArray(parsed?.exemptions)) {
    fail(`${path}: expected an "exemptions" array`);
  }

  const seen = new Set();
  const exemptions = [];
  parsed.exemptions.forEach((entry, index) => {
    const at = `${path}[${index}]`;
    const file = typeof entry?.file === 'string' ? entry.file.trim() : '';
    const claim = typeof entry?.claim === 'string' ? entry.claim.trim() : '';
    const reason = typeof entry?.reason === 'string' ? entry.reason.trim() : '';
    if (!file)
      fail(`${at}: entry names no documenting file (\`file\` is required)`);
    if (!claim) fail(`${at}: exemption for \`${file}\` names no claim`);
    if (!reason) {
      fail(
        `${at}: exemption for \`${file}\` → \`${claim}\` carries no written reason. ` +
          'An exemption is a decision somebody made, not a gap nobody saw.',
      );
    }
    const key = exemptionKey(file, claim);
    if (seen.has(key))
      fail(`${at}: \`${file}\` → \`${claim}\` is exempted twice`);
    seen.add(key);
    exemptions.push({ file, claim, reason });
  });
  return exemptions;
}

export function exemptionKey(file, claim) {
  return `${file}\0${claim}`;
}

const isFrozen = (file) =>
  file.startsWith('docs/research/') || file === 'CHANGELOG.md';

function main({ cwd = process.cwd(), argv = process.argv.slice(2) } = {}) {
  const printOnly = argv.includes('--print');
  const graphArg = argv.find((arg) => !arg.startsWith('--'));

  const files = listTrackedMarkdown({ cwd, fail }).filter(
    (file) => !isFrozen(file),
  );
  if (files.length === 0) fail('no tracked Markdown files found');

  const exemptions = readExemptions({ cwd });

  let nodes;
  try {
    ({ nodes } = loadProjectGraph(graphArg));
  } catch (error) {
    if (error instanceof GraphUnavailableError) fail(error.message);
    throw error;
  }

  const references = [];
  for (const file of files) {
    const absolute = join(cwd, file);
    if (!existsSync(absolute)) continue; // staged-deleted but still tracked
    for (const reference of collectReferences(readFileSync(absolute, 'utf8'))) {
      references.push({
        file,
        ...reference,
        problem: unresolvedReason(reference, nodes),
      });
    }
  }

  const exempted = new Map(
    exemptions.map((entry) => [exemptionKey(entry.file, entry.claim), entry]),
  );
  const used = new Set();
  const findings = [];
  for (const reference of references) {
    if (!reference.problem) continue;
    const key = exemptionKey(reference.file, reference.claim);
    if (exempted.has(key)) used.add(key);
    else findings.push(reference);
  }
  const stale = exemptions.filter(
    (entry) => !used.has(exemptionKey(entry.file, entry.claim)),
  );

  if (printOnly) {
    console.log(
      `${PREFIX}: ${references.length} documented Nx reference(s) across ${files.length} Markdown files, ` +
        `${exemptions.length} exemption(s)`,
    );
    for (const { file, line, claim, problem } of references) {
      console.log(
        `  ${file}:${line} → ${claim}${problem ? ` — ${problem}` : ''}`,
      );
    }
  }

  const errors = [];
  if (findings.length > 0) {
    errors.push(`${findings.length} documented Nx reference(s) do not resolve`);
  }
  if (stale.length > 0) {
    errors.push(
      `${stale.length} exemption(s) are stale (the reference is gone, or it resolves again)`,
    );
  }

  if (errors.length > 0) {
    console.error(`${PREFIX}: ${errors.join('; ')}\n`);
    for (const { file, line, claim, problem } of findings) {
      console.error(`  - ${file}:${line} → ${claim} — ${problem}`);
    }
    for (const { file, claim } of stale) {
      console.error(`  - stale exemption: ${file} → ${claim}`);
    }
    console.error(
      '\nCorrect the doc to a target `yarn nx show project <name>` lists, or — for a merged ADR' +
        `\nrecording what a command used to be — add a written-reason exemption in ${EXEMPTIONS_PATH}.` +
        '\nA stale exemption is removed, not kept.',
    );
    process.exit(1);
  }

  console.log(
    `${PREFIX}: OK — ${references.length} documented Nx reference(s) across ${files.length} Markdown files resolve` +
      (exemptions.length ? `, ${exemptions.length} exempted` : ''),
  );
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) main();
