/**
 * The declared set of Assertion Gate checkers the aggregate runner executes
 * (`tools/scripts/run-assertion-gates.mjs`, `yarn gates:run`).
 *
 * ADR 0043 requires the manifest to be a checked artifact, not a convenience:
 * a checker silently dropped from it is a gate that runs nowhere, which is
 * the exact defect this PRD treats. `assertManifestAgainstDisk` compares the
 * manifest against package.json in both directions — every declared entry
 * must exist on disk and match what its npm script actually runs, and every
 * invocation an npm script actually performs must be declared here. Deleting
 * a line from `GATE_MANIFEST` therefore fails loudly instead of quietly.
 *
 * Each entry names the npm script it belongs to (for the package.json
 * cross-check) and the exact `node <script> [...args]` invocation that
 * script performs — `agents:sync:check` runs two scripts joined by `&&`, so
 * it contributes two entries sharing one npm script name.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One declared `node <script> [...args]` invocation an npm script must perform. */
export interface GateManifestEntry {
  id: string;
  npmScript: string;
  script: string;
  args: string[];
}

export const GATE_MANIFEST: GateManifestEntry[] = [
  {
    id: 'readme:check',
    npmScript: 'readme:check',
    script: 'tools/scripts/check-readme.mjs',
    args: [],
  },
  {
    id: 'openapi:artifacts',
    npmScript: 'openapi:artifacts',
    script: 'tools/scripts/check-openapi-artifacts.mjs',
    args: [],
  },
  {
    id: 'env:declared:check',
    npmScript: 'env:declared:check',
    script: 'tools/scripts/check-env-declared.mjs',
    args: [],
  },
  {
    id: 'env:deployment:check',
    npmScript: 'env:deployment:check',
    script: 'tools/scripts/check-env-deployment.mjs',
    args: [],
  },
  {
    id: 'feature-index:check',
    npmScript: 'feature-index:check',
    script: 'tools/scripts/check-feature-index.mjs',
    args: [],
  },
  {
    id: 'agents:map:check',
    npmScript: 'agents:map:check',
    script: 'tools/scripts/check-agent-map.mjs',
    args: [],
  },
  {
    id: 'vault:pages:check',
    npmScript: 'vault:pages:check',
    script: 'tools/scripts/check-vault-pages.mjs',
    args: [],
  },
  {
    id: 'auth:pages:check',
    npmScript: 'auth:pages:check',
    script: 'tools/scripts/check-auth-pages.mjs',
    args: [],
  },
  {
    id: 'nx:tags:check',
    npmScript: 'nx:tags:check',
    script: 'tools/scripts/check-nx-project-tags.mjs',
    args: [],
  },
  {
    id: 'nx:targets:check',
    npmScript: 'nx:targets:check',
    script: 'tools/scripts/check-nx-declared-targets.mjs',
    args: [],
  },
  {
    id: 'review:concurrency:check',
    npmScript: 'review:concurrency:check',
    script: 'tools/scripts/check-review-concurrency.mjs',
    args: [],
  },
  {
    id: 'review:pages:check',
    npmScript: 'review:pages:check',
    script: 'tools/scripts/check-review-pages.mjs',
    args: [],
  },
  {
    id: 'review:checklist:check',
    npmScript: 'review:checklist:check',
    script: 'tools/scripts/check-review-checklist.mjs',
    args: [],
  },
  {
    id: 'review:allowlist:check',
    npmScript: 'review:allowlist:check',
    script: 'tools/scripts/check-review-tool-allowlist.mjs',
    args: [],
  },
  {
    id: 'review:golden:check',
    npmScript: 'review:golden:check',
    script: 'tools/scripts/check-review-golden-set.mjs',
    args: [],
  },
  {
    id: 'review:golden:results:check',
    npmScript: 'review:golden:results:check',
    script: 'tools/scripts/check-review-golden-results.mjs',
    args: [],
  },
  {
    id: 'review:rules:check',
    npmScript: 'review:rules:check',
    script: 'tools/scripts/check-review-rules.mjs',
    args: [],
  },
  {
    id: 'deploy:pages:check',
    npmScript: 'deploy:pages:check',
    script: 'tools/scripts/check-deploy-pipeline.mjs',
    args: [],
  },
  {
    id: 'host-apply:workflow:check',
    npmScript: 'host-apply:workflow:check',
    script: 'tools/scripts/check-host-apply-workflow.mjs',
    args: [],
  },
  {
    id: 'runner-image:check',
    npmScript: 'runner-image:check',
    script: 'tools/scripts/check-runner-image.mjs',
    args: [],
  },
  {
    id: 'agents:sync:check (subagents)',
    npmScript: 'agents:sync:check',
    script: 'tools/scripts/sync-subagents.mjs',
    args: ['--check'],
  },
  {
    id: 'agents:sync:check (models)',
    npmScript: 'agents:sync:check',
    script: 'tools/scripts/sync-agent-models.mjs',
    args: ['--check'],
  },
  {
    id: 'adr:numbering:check',
    npmScript: 'adr:numbering:check',
    script: 'tools/scripts/check-adr-numbering.mjs',
    args: [],
  },
  {
    id: 'adr:status:check',
    npmScript: 'adr:status:check',
    script: 'tools/scripts/check-adr-status.mjs',
    args: [],
  },
  {
    id: 'docs:commands:check',
    npmScript: 'docs:commands:check',
    script: 'tools/scripts/check-doc-commands.mjs',
    args: [],
  },
  {
    id: 'docs:file-refs:check',
    npmScript: 'docs:file-refs:check',
    script: 'tools/scripts/check-doc-file-refs.mjs',
    args: [],
  },
  {
    id: 'product-name:check',
    npmScript: 'product-name:check',
    script: 'tools/scripts/check-product-name.mjs',
    args: [],
  },
  {
    id: 'enum:fanout:check',
    npmScript: 'enum:fanout:check',
    script: 'tools/scripts/check-enum-fanout.mjs',
    args: [],
  },
  {
    id: 'tailwind:classes:check',
    npmScript: 'tailwind:classes:check',
    script: 'tools/scripts/check-tailwind-classes.mjs',
    args: [],
  },
  {
    id: 'content-globs:check',
    npmScript: 'content-globs:check',
    script: 'tools/scripts/check-content-globs.mjs',
    args: [],
  },
  {
    id: 'web:app-icons:check',
    npmScript: 'web:app-icons:check',
    script: 'tools/scripts/check-web-app-icons.mjs',
    args: [],
  },
  {
    id: 'mobile:app-icon:check',
    npmScript: 'mobile:app-icon:check',
    script: 'tools/scripts/check-mobile-app-icon.mjs',
    args: [],
  },
  {
    id: 'mobile-platform:check',
    npmScript: 'mobile-platform:check',
    script: 'tools/scripts/check-mobile-platform.mjs',
    args: [],
  },
  // Reads the index, so in the pre-commit hook it refuses what is staged and
  // in CI what is already tracked (PRD #956).
  {
    id: 'signing-material:check',
    npmScript: 'signing-material:check',
    script: 'tools/scripts/check-signing-material.mjs',
    args: [],
  },
  // The file-reading half of the Prisma migration gate (ADR 0094). Whether
  // the history applies and reproduces the schema needs a database, so that
  // half is the `Apply Prisma migrations and check schema drift` step of the
  // `Test` job in .github/workflows/ci.yml, and is
  // deliberately not here — this aggregate is cheap, file-reading checkers.
  {
    id: 'prisma:migrations:check',
    npmScript: 'prisma:migrations:check',
    script: 'tools/scripts/check-prisma-migrations.mjs',
    args: [],
  },
  // The validator this adapter calls ships inside the skill directory, which
  // the Meta-Gate's non-recursive scan of tools/scripts/ cannot see. The
  // adapter is what makes the gate visible (ADR 0084 item 10).
  {
    id: 'upstream:briefs:check',
    npmScript: 'upstream:briefs:check',
    script: 'tools/scripts/check-upstream-briefs.mjs',
    args: [],
  },
  // The meta-gate reads this manifest to resolve one level of indirection, so
  // a checker reached only through the aggregate still counts as wired. It is
  // a file-reading checker itself, which is why it runs here rather than only
  // in CI (ADR 0043).
  {
    id: 'gates:coverage:check',
    npmScript: 'gates:coverage:check',
    script: 'tools/scripts/check-gate-coverage.mjs',
    args: [],
  },
  {
    id: 'checker-contracts:check',
    npmScript: 'checker-contracts:check',
    script: 'tools/scripts/check-checker-contracts.mjs',
    args: [],
  },
  {
    id: 'ts-suppressions:check',
    npmScript: 'ts-suppressions:check',
    script: 'tools/scripts/check-ts-suppressions.mjs',
    args: [],
  },
];

/** A single `node <script> [...args]` invocation. */
export interface NodeSegment {
  script: string;
  args: string[];
}

const formatInvocation = (script: string, args: readonly string[]): string =>
  args.length ? `node ${script} ${args.join(' ')}` : `node ${script}`;

/**
 * Splits a package.json script command into its `node <script> [...args]`
 * invocations. Segments that are not a bare `node` call (e.g. `nx format:check`)
 * are dropped — nothing in the manifest ever points at one, so there is
 * nothing for the reverse-direction assertion to reconcile them against.
 */
export function parseNodeSegments(command: string): NodeSegment[] {
  return command
    .split('&&')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.match(/^node\s+(\S+)(.*)$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => {
      const [, script, rest] = match;
      const trimmedRest = rest.trim();
      return { script, args: trimmedRest ? trimmedRest.split(/\s+/) : [] };
    });
}

const sameInvocation = (a: NodeSegment, b: NodeSegment): boolean =>
  a.script === b.script &&
  a.args.length === b.args.length &&
  a.args.every((value, index) => value === b.args[index]);

/**
 * Compares `manifest` against package.json in both directions.
 *
 *   1. Every declared entry's script file exists on disk.
 *   2. Every declared entry's npm script exists in package.json, and its
 *      command contains that entry's exact invocation.
 *   3. Every `node` invocation an npm script named in the manifest actually
 *      performs is declared by some entry — an npm script gaining a second
 *      invocation without a matching manifest entry is caught here.
 *
 * Returns `{ ok, findings }` rather than throwing, so a caller can print
 * every mismatch instead of stopping at the first.
 */
export interface AssertManifestResult {
  ok: boolean;
  findings: string[];
}

export function assertManifestAgainstDisk(
  manifest: readonly GateManifestEntry[],
  {
    cwd = process.cwd(),
    pkg,
  }: { cwd?: string; pkg?: { scripts?: Record<string, string> } } = {},
): AssertManifestResult {
  const packageJson: { scripts?: Record<string, string> } =
    pkg ?? JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
  const scripts = packageJson.scripts ?? {};
  const findings: string[] = [];

  for (const entry of manifest) {
    if (!existsSync(join(cwd, entry.script))) {
      findings.push(
        `${entry.id}: declared script ${entry.script} does not exist`,
      );
    }
  }

  const segmentsByNpmScript = new Map<string, NodeSegment[]>();
  for (const npmScript of new Set(manifest.map((entry) => entry.npmScript))) {
    const command = scripts[npmScript];
    if (command === undefined) {
      findings.push(
        `${npmScript}: declared in the gate manifest but package.json has no such script`,
      );
      continue;
    }
    segmentsByNpmScript.set(npmScript, parseNodeSegments(command));
  }

  for (const entry of manifest) {
    const segments = segmentsByNpmScript.get(entry.npmScript);
    if (!segments) continue; // already reported: npm script itself is missing
    if (!segments.some((segment) => sameInvocation(segment, entry))) {
      findings.push(
        `${entry.id}: manifest says \`${entry.npmScript}\` runs ` +
          `\`${formatInvocation(entry.script, entry.args)}\`, but package.json's ` +
          `script does not contain that invocation`,
      );
    }
  }

  for (const [npmScript, segments] of segmentsByNpmScript) {
    for (const segment of segments) {
      const declared = manifest.some(
        (entry) =>
          entry.npmScript === npmScript && sameInvocation(segment, entry),
      );
      if (!declared) {
        findings.push(
          `${npmScript}: package.json runs \`${formatInvocation(segment.script, segment.args)}\`, ` +
            `which is not declared in the gate manifest`,
        );
      }
    }
  }

  return { ok: findings.length === 0, findings };
}

/**
 * Runs every manifest entry as its own `node` subprocess and collects every
 * result — a failing checker must never stop the others from reporting.
 * Subprocesses (not an in-process import) are deliberate: several checkers
 * call `process.exit` directly, which would kill the aggregate itself.
 *
 * `spawn` is injectable so contract tests can exercise the "keep going after
 * a failure" behavior against fixture entries without spawning real checkers.
 */
export interface GateSpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export type GateSpawn = (
  entry: GateManifestEntry,
  cwd: string,
) => GateSpawnResult;

export function runGateManifest(
  manifest: readonly GateManifestEntry[],
  {
    cwd = process.cwd(),
    spawn = defaultSpawn,
  }: { cwd?: string; spawn?: GateSpawn } = {},
): Array<{ entry: GateManifestEntry } & GateSpawnResult> {
  return manifest.map((entry) => ({ entry, ...spawn(entry, cwd) }));
}

function defaultSpawn(entry: GateManifestEntry, cwd: string): GateSpawnResult {
  const result = spawnSync(process.execPath, [entry.script, ...entry.args], {
    cwd,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}
