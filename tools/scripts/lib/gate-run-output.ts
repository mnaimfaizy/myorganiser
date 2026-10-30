/**
 * Formats one gate's result for `yarn gates:run` (`tools/scripts/run-assertion-gates.ts`).
 *
 * The plain `  ✓ <id>` / `  ✗ <id> (exit N)` lines are what Husky's pre-commit
 * hook has always printed, and stay exactly that outside GitHub Actions — the
 * acceptance bar for this file is that pre-commit's console output is
 * unchanged (ADR 0043). Inside Actions (`GITHUB_ACTIONS=true`), each gate also
 * gets its own collapsible `::group::`/`::endgroup::` pair, and a failing gate
 * raises a named `::error` annotation, so folding ~33 named CI steps into one
 * `gates:run` step does not make a failure any harder to find.
 *
 * Workflow-command escaping follows GitHub's documented rules: `%`, `\r`, and
 * `\n` are escaped in both data and property values, and `:` and `,` are
 * additionally escaped in property values (`title=`) because those characters
 * delimit the command's own properties.
 */
import type { GateManifestEntry, GateSpawnResult } from './gate-manifest.ts';

export function escapeData(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

export function escapeProperty(value: string): string {
  return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

function indent(text: string): string {
  return text
    .trimEnd()
    .split('\n')
    .map((line) => `      ${line}`)
    .join('\n');
}

export interface FormattedGateResult {
  /** `::group::<id>`, present only inside GitHub Actions. */
  groupStart?: string;
  /** `::endgroup::`, present only inside GitHub Actions. */
  groupEnd?: string;
  /** The ✓/✗ line(s), identical to the pre-GitHub-Actions-aware output. */
  body: string[];
  isFailure: boolean;
  /** `::error title=<id>::<message>`, present only for a failing gate inside GitHub Actions. */
  errorAnnotation?: string;
}

export function formatGateResult(
  {
    entry,
    status,
    stdout,
    stderr,
  }: { entry: GateManifestEntry } & GateSpawnResult,
  { inActions }: { inActions: boolean },
): FormattedGateResult {
  const isFailure = status !== 0;
  const body: string[] = [];
  if (!isFailure) {
    body.push(`  ✓ ${entry.id}`);
  } else {
    body.push(`  ✗ ${entry.id} (exit ${status})`);
    if (stdout.trim()) body.push(indent(stdout));
    if (stderr.trim()) body.push(indent(stderr));
  }

  return {
    groupStart: inActions ? `::group::${entry.id}` : undefined,
    groupEnd: inActions ? '::endgroup::' : undefined,
    body,
    isFailure,
    errorAnnotation:
      inActions && isFailure
        ? `::error title=${escapeProperty(entry.id)}::${escapeData(
            `${entry.id} failed (exit ${status})`,
          )}`
        : undefined,
  };
}
